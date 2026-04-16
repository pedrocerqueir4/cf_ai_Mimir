import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
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

      // ── Step 2: generate-lessons ────────────────────────────────────────────
      // Fetches roadmap from D1, generates per-node lessons, writes to D1.
      // Uses deterministic lesson IDs for idempotency on retry.
      const lessonIds = await step.do(
        "generate-lessons",
        {
          retries: {
            limit: 2,
            delay: "10 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const db = drizzle(this.env.DB, { schema });

          // Fetch roadmap from D1 (step 1 already wrote it)
          const roadmapRows = await db
            .select()
            .from(schema.roadmaps)
            .where(eq(schema.roadmaps.id, roadmapId!))
            .limit(1);

          if (roadmapRows.length === 0) {
            throw new Error(`Roadmap ${roadmapId} not found in D1`);
          }

          const roadmap = roadmapRows[0];
          const nodes = JSON.parse(roadmap.nodesJson) as Array<{
            id: string;
            title: string;
            description?: string;
            order: number;
            prerequisites: string[];
          }>;

          const generatedIds: string[] = [];

          for (const node of nodes) {
            // Deterministic ID — idempotent on retry
            const lessonId = `${roadmapId}-lesson-${node.id}`;

            const aiResponse = await this.env.AI.run(
              "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              {
                messages: [
                  {
                    role: "system",
                    content: buildLessonSystemPrompt(
                      roadmap.topic,
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
                id: lessonId,
                roadmapId: roadmapId!,
                nodeId: node.id,
                title: validated.title,
                content: validated.content,
                order: node.order,
                createdAt: new Date(),
              })
              .onConflictDoNothing();

            generatedIds.push(lessonId);
          }

          // Return ONLY IDs — never return full content from step.do()
          return generatedIds;
        },
      );

      // ── Step 3: generate-quizzes ────────────────────────────────────────────
      // For each lesson: fetches content from D1, generates quiz, writes quiz
      // and quiz_questions rows with deterministic IDs for retry idempotency.
      await step.do(
        "generate-quizzes",
        {
          retries: {
            limit: 2,
            delay: "10 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const db = drizzle(this.env.DB, { schema });

          for (const lessonId of lessonIds) {
            const lessonRows = await db
              .select()
              .from(schema.lessons)
              .where(eq(schema.lessons.id, lessonId))
              .limit(1);

            if (lessonRows.length === 0) continue;

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
                  // correctOptionId stored server-side only — NEVER sent to client before submission
                  correctOptionId: question.correctOptionId,
                  explanation: question.explanation,
                  order: i,
                })
                .onConflictDoNothing();
            }
          }

          // Void step — all data written to D1, nothing returned
        },
      );

      // ── Step 4: embed-content ───────────────────────────────────────────────
      // For each lesson: chunks content, generates bge-large embeddings,
      // upserts to Vectorize, then marks roadmap status as "complete".
      await step.do(
        "embed-content",
        {
          retries: {
            limit: 3,
            delay: "15 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const db = drizzle(this.env.DB, { schema });

          for (const lessonId of lessonIds) {
            const lessonRows = await db
              .select()
              .from(schema.lessons)
              .where(eq(schema.lessons.id, lessonId))
              .limit(1);

            if (lessonRows.length === 0) continue;

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
          }

          // Mark roadmap as complete — status transitions: generating → complete
          await db
            .update(schema.roadmaps)
            .set({ status: "complete", updatedAt: new Date() })
            .where(eq(schema.roadmaps.id, roadmapId!));
        },
      );
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
