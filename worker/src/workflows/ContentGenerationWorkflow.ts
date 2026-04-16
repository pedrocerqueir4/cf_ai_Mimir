import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  RoadmapOutputSchema,
  LessonOutputSchema,
  QuizOutputSchema,
} from "../validation/content-schemas";
import {
  buildRoadmapSystemPrompt,
  buildLessonSystemPrompt,
  buildQuizSystemPrompt,
  ROADMAP_JSON_SCHEMA,
  LESSON_JSON_SCHEMA,
  QUIZ_JSON_SCHEMA,
} from "../validation/roadmap-prompts";
import { chunkText } from "../services/chunk-text";

// ─── Payload ──────────────────────────────────────────────────────────────────

type ContentPayload = {
  topic: string;
  userId: string;
  conversationId: string;
  workflowRunId: string;
};

// ─── Workflow ─────────────────────────────────────────────────────────────────

export class ContentGenerationWorkflow extends WorkflowEntrypoint<Env, ContentPayload> {
  async run(event: WorkflowEvent<ContentPayload>, step: WorkflowStep) {
    const { topic, userId, conversationId, workflowRunId } = event.payload;
    let roadmapId: string | null = null;

    try {
      // ── Step 1: generate-roadmap ────────────────────────────────────────────
      // Generates the roadmap structure via Llama 3.3, validates with Zod,
      // writes to D1, and returns ONLY the roadmapId (1MiB limit compliance).
      roadmapId = await step.do(
        "generate-roadmap",
        {
          retries: {
            limit: 3,
            delay: "5 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const db = drizzle(this.env.DB, { schema });

          // Call Workers AI — NEVER combine response_format with stream: true
          const aiResponse = await this.env.AI.run(
            "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
            {
              messages: [
                { role: "system", content: buildRoadmapSystemPrompt() },
                { role: "user", content: `Create a learning roadmap for: ${topic}` },
              ],
              response_format: {
                type: "json_schema",
                json_schema: ROADMAP_JSON_SCHEMA,
              },
            } as any,
          );

          // Parse and Zod-validate AI output before D1 write
          const rawText =
            typeof aiResponse === "string"
              ? aiResponse
              : (aiResponse as { response?: string }).response ?? JSON.stringify(aiResponse);

          const parsed = JSON.parse(rawText);
          const validated = RoadmapOutputSchema.parse(parsed);

          const id = crypto.randomUUID();
          const now = new Date();

          await db.insert(schema.roadmaps).values({
            id,
            userId,
            title: validated.title,
            topic,
            complexity: validated.complexity,
            status: "generating",
            workflowRunId,
            nodesJson: JSON.stringify(validated.nodes),
            createdAt: now,
            updatedAt: now,
          });

          // Return ONLY the ID — never return full content from step.do()
          return id;
        },
      );

      // ── Step 2a: fetch-roadmap-nodes ────────────────────────────────────────
      // Fetches roadmap from D1 and extracts the node list for lesson generation.
      // Separated from lesson generation so node data is available for per-lesson steps.
      const nodes = await step.do(
        "fetch-roadmap-nodes",
        {
          retries: {
            limit: 2,
            delay: "5 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const db = drizzle(this.env.DB, { schema });

          const roadmapRows = await db
            .select()
            .from(schema.roadmaps)
            .where(eq(schema.roadmaps.id, roadmapId!))
            .limit(1);

          if (roadmapRows.length === 0) {
            throw new Error(`Roadmap ${roadmapId} not found in D1`);
          }

          const roadmap = roadmapRows[0];
          return JSON.parse(roadmap.nodesJson) as Array<{
            id: string;
            title: string;
            description?: string;
            order: number;
            prerequisites: string[];
          }>;
        },
      );

      // ── Step 2b: generate-lesson-{nodeId} (per lesson) ─────────────────────
      // Each lesson is its own step — if lesson 5 of 8 fails, only lesson 5 retries.
      // Previously all lessons were in one step.do, so a failure on any lesson
      // would restart ALL lesson generation from scratch.
      const lessonIds: string[] = [];

      for (const node of nodes) {
        const lessonId = await step.do(
          `generate-lesson-${node.id}`,
          {
            retries: {
              limit: 2,
              delay: "10 seconds",
              backoff: "exponential",
            },
          },
          async () => {
            const db = drizzle(this.env.DB, { schema });
            const id = `${roadmapId}-lesson-${node.id}`;

            // Fetch roadmap topic (needed for prompt context)
            const roadmapRows = await db
              .select({ topic: schema.roadmaps.topic })
              .from(schema.roadmaps)
              .where(eq(schema.roadmaps.id, roadmapId!))
              .limit(1);

            const roadmapTopic = roadmapRows[0]?.topic ?? topic;

            const aiResponse = await this.env.AI.run(
              "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              {
                messages: [
                  {
                    role: "system",
                    content: buildLessonSystemPrompt(
                      roadmapTopic,
                      node.title,
                      node.description ?? "",
                    ),
                  },
                  {
                    role: "user",
                    content: `Write the lesson for: ${node.title}`,
                  },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: LESSON_JSON_SCHEMA,
                },
              } as any,
            );

            const rawText =
              typeof aiResponse === "string"
                ? aiResponse
                : (aiResponse as { response?: string }).response ?? JSON.stringify(aiResponse);

            const parsed = JSON.parse(rawText);
            const validated = LessonOutputSchema.parse(parsed);

            await db
              .insert(schema.lessons)
              .values({
                id,
                roadmapId: roadmapId!,
                nodeId: node.id,
                title: validated.title,
                content: validated.content,
                order: node.order,
                createdAt: new Date(),
              })
              .onConflictDoNothing();

            // Return ONLY the ID — never return full content from step.do()
            return id;
          },
        );

        lessonIds.push(lessonId);
      }

      // ── Step 3: generate-quiz-{lessonId} (per lesson) ──────────────────────
      // Each lesson's quiz is its own step — if quiz for lesson 8 fails,
      // only that quiz retries. Previously all quizzes were in one step.do,
      // so a failure on any quiz would restart ALL quiz generation.
      for (const lessonId of lessonIds) {
        await step.do(
          `generate-quiz-${lessonId}`,
          {
            retries: {
              limit: 2,
              delay: "10 seconds",
              backoff: "exponential",
            },
          },
          async () => {
            const db = drizzle(this.env.DB, { schema });

            const lessonRows = await db
              .select()
              .from(schema.lessons)
              .where(eq(schema.lessons.id, lessonId))
              .limit(1);

            if (lessonRows.length === 0) return;

            const lesson = lessonRows[0];

            const aiResponse = await this.env.AI.run(
              "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              {
                messages: [
                  {
                    role: "system",
                    content: buildQuizSystemPrompt(lesson.content),
                  },
                  {
                    role: "user",
                    content: "Generate comprehension quiz questions for this lesson.",
                  },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: QUIZ_JSON_SCHEMA,
                },
              } as any,
            );

            const rawText =
              typeof aiResponse === "string"
                ? aiResponse
                : (aiResponse as { response?: string }).response ?? JSON.stringify(aiResponse);

            const parsed = JSON.parse(rawText);
            const validated = QuizOutputSchema.parse(parsed);

            // Deterministic quiz ID — idempotent on retry
            const quizId = `${lessonId}-quiz`;

            await db
              .insert(schema.quizzes)
              .values({
                id: quizId,
                lessonId,
                createdAt: new Date(),
              })
              .onConflictDoNothing();

            for (let i = 0; i < validated.questions.length; i++) {
              const question = validated.questions[i];
              const questionId = `${quizId}-q${i}`;

              await db
                .insert(schema.quizQuestions)
                .values({
                  id: questionId,
                  quizId,
                  questionText: question.questionText,
                  questionType: question.questionType,
                  optionsJson: JSON.stringify(question.options),
                  correctOptionId: question.correctOptionId,
                  explanation: question.explanation,
                  order: i,
                })
                .onConflictDoNothing();
            }
          },
        );
      }

      // ── Step 4: embed-content-{lessonId} (per lesson) ──────────────────────
      // Each lesson's embedding is its own step for the same resilience reason.
      for (const lessonId of lessonIds) {
        await step.do(
          `embed-content-${lessonId}`,
          {
            retries: {
              limit: 3,
              delay: "15 seconds",
              backoff: "exponential",
            },
          },
          async () => {
            const db = drizzle(this.env.DB, { schema });

            const lessonRows = await db
              .select()
              .from(schema.lessons)
              .where(eq(schema.lessons.id, lessonId))
              .limit(1);

            if (lessonRows.length === 0) return;

            const lesson = lessonRows[0];

            // Strip Markdown syntax before chunking for cleaner embeddings
            const plainText = lesson.content
              .replace(/#+\s/g, "")
              .replace(/\*\*(.+?)\*\*/g, "$1")
              .replace(/\*(.+?)\*/g, "$1")
              .replace(/`{1,3}[^`]*`{1,3}/g, "")
              .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
              .replace(/^\s*[-*+]\s/gm, "")
              .replace(/^\s*\d+\.\s/gm, "")
              .trim();

            // 300-word chunks, 50-word overlap — safe margin below bge-large 512-token limit
            const chunks = chunkText(plainText, 300, 50);

            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];

              const embeddingResponse = await this.env.AI.run(
                "@cf/baai/bge-large-en-v1.5",
                { text: [chunk] } as any,
              );

              const embedding = embeddingResponse as { data: number[][] };

              if (!embedding.data || embedding.data.length === 0) {
                throw new Error(`Empty embedding response for lessonId=${lessonId} chunk=${i}`);
              }

              await this.env.VECTORIZE.upsert([
                {
                  id: `${lessonId}-chunk-${i}`,
                  values: embedding.data[0],
                  metadata: {
                    lessonId,
                    roadmapId: roadmapId!,
                    userId,
                    chunkIndex: i,
                    text: chunk,
                    lessonTitle: lesson.title,
                  },
                },
              ]);
            }
          },
        );
      }

      // ── Step 5: mark-complete ──────────────────────────────────────────────
      // All lessons, quizzes, and embeddings are done — mark roadmap as complete.
      await step.do("mark-complete", async () => {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.roadmaps)
          .set({ status: "complete", updatedAt: new Date() })
          .where(eq(schema.roadmaps.id, roadmapId!));
      });
    } catch (error) {
      // On any unhandled error: mark roadmap as failed
      // Step-level retries (configured above) run first — this catches exhausted retries
      if (roadmapId) {
        try {
          const db = drizzle(this.env.DB, { schema });
          await db
            .update(schema.roadmaps)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(schema.roadmaps.id, roadmapId));
        } catch {
          // Best-effort status update — do not mask the original error
        }
      }
      throw error;
    }
  }
}
