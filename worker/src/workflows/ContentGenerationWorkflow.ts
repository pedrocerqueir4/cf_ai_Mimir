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

// ─── Model Selection ─────────────────────────────────────────────────────────
// 70B for roadmap structure (json_schema, quality matters for node organization)
// 8B-fast for lessons (raw Markdown output, no JSON — avoids escaping issues entirely)
// 8B-fast for quizzes (json_schema supported on -fast variant, short structured output)
// Note: llama-3.1-8b-instruct-fast IS on the official JSON mode list;
//       llama-3.1-8b-instruct-fp8 is NOT — that's why json_object was broken.
const MODEL_ROADMAP = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;
const MODEL_LESSON = "@cf/meta/llama-3.1-8b-instruct-fast";  // raw Markdown, no JSON
const MODEL_QUIZ = "@cf/meta/llama-3.1-8b-instruct-fast";    // json_schema supported
const MODEL_EMBED = "@cf/baai/bge-large-en-v1.5" as const;

// ─── Lesson Markdown Parser ──────────────────────────────────────────────────
// Lessons are generated as raw Markdown (no JSON wrapper) to avoid the
// fundamental problem of LLMs escaping Markdown inside JSON strings.
// Parse title from first # heading, rest is content.

function parseLessonMarkdown(raw: string): { title: string; content: string } {
  const text = raw.trim();

  // Try to find first # heading
  const headingMatch = text.match(/^#\s+(.+)$/m);

  if (headingMatch) {
    const title = headingMatch[1].trim();
    // Content is everything after the heading line
    const headingEnd = text.indexOf(headingMatch[0]) + headingMatch[0].length;
    const content = text.slice(headingEnd).trim();
    return { title, content: content || text };
  }

  // No heading found — use first line as title, rest as content
  const lines = text.split("\n");
  const title = lines[0].replace(/^#+\s*/, "").trim() || "Untitled Lesson";
  const content = lines.slice(1).join("\n").trim() || text;
  return { title, content };
}

// ─── AI Response Parser ──────────────────────────────────────────────────────
// Workers AI returns different shapes depending on model and response_format:
// - string (raw text)
// - { response: string } (chat completion)
// - { response: object } (json_schema mode — already parsed)
// - object directly (some json_schema modes)
// This normalizes all cases to a parsed JS object.

/**
 * Attempt to repair broken JSON from LLM output.
 * Common issues: triple-quoted strings ("""), unescaped newlines in values,
 * unescaped control characters, trailing commas.
 */
function repairJson(raw: string): string {
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  // Try parsing as-is first
  try { JSON.parse(s); return s; } catch { /* needs repair */ }

  // Fix triple-quoted strings: """ -> "
  s = s.replace(/"""/g, '"');

  // Fix unescaped newlines inside JSON string values.
  // Strategy: find string boundaries and escape raw newlines within them.
  // Walk char by char to handle this properly.
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && ch === "\n") {
      result += "\\n";
      continue;
    }
    if (inString && ch === "\r") {
      result += "\\r";
      continue;
    }
    if (inString && ch === "\t") {
      result += "\\t";
      continue;
    }
    result += ch;
  }

  // Fix trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, "$1");

  return result;
}

function parseAIResponse(aiResponse: unknown): unknown {
  console.log(`[Workflow] parseAIResponse type=${typeof aiResponse}`,
    typeof aiResponse === "object" ? JSON.stringify(aiResponse).slice(0, 200) : String(aiResponse).slice(0, 200));

  // Case 1: already a string — repair and parse
  if (typeof aiResponse === "string") {
    return JSON.parse(repairJson(aiResponse));
  }

  // Case 2: object with .response field
  if (aiResponse && typeof aiResponse === "object" && "response" in aiResponse) {
    const resp = (aiResponse as Record<string, unknown>).response;
    // .response can be a string (needs parsing) or already an object (json_schema mode)
    if (typeof resp === "string") {
      return JSON.parse(repairJson(resp));
    }
    if (typeof resp === "object" && resp !== null) {
      return resp;
    }
  }

  // Case 3: object without .response — might be the parsed JSON directly
  if (aiResponse && typeof aiResponse === "object") {
    return aiResponse;
  }

  throw new Error(`Unexpected AI response type: ${typeof aiResponse}`);
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export class ContentGenerationWorkflow extends WorkflowEntrypoint<Env, ContentPayload> {
  async run(event: WorkflowEvent<ContentPayload>, step: WorkflowStep) {
    const { topic, userId, conversationId, workflowRunId } = event.payload;
    let roadmapId: string | null = null;

    console.log(`[Workflow] START topic="${topic}" userId="${userId}" workflowRunId="${workflowRunId}"`);

    try {
      // ── Step 1: generate-roadmap ────────────────────────────────────────────
      // On insert we stamp `currentStep: 1` — the row becoming visible IS the
      // signal to the /chat GenerationProgressBubble that "analyzing topic"
      // (icon 1) is now the active step. Before this insert the status GET
      // returns 404 and the UI's local state keeps icon 1 spinning anyway.
      console.log(`[Workflow] Step 1: generate-roadmap — calling AI for topic="${topic}"`);
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

          const aiResponse = await this.env.AI.run(
            MODEL_ROADMAP,
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

          const parsed = parseAIResponse(aiResponse);
          const validated = RoadmapOutputSchema.parse(parsed);

          console.log(`[Workflow] Step 1: validated — title="${validated.title}" complexity="${validated.complexity}" nodes=${validated.nodes.length}`);

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
            // Icon 1 ("Analyzing topic...") is the initial active step.
            // We advance to 2 once lesson generation actually begins below.
            currentStep: 1,
            nodesJson: JSON.stringify(validated.nodes),
            createdAt: now,
            updatedAt: now,
          });

          console.log(`[Workflow] Step 1: DONE — roadmapId="${id}"`);
          return id;
        },
      );

      // ── Step 2a: fetch-roadmap-nodes ────────────────────────────────────────
      console.log(`[Workflow] Step 2a: fetch-roadmap-nodes — roadmapId="${roadmapId}"`);
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
          const parsed = JSON.parse(roadmap.nodesJson) as Array<{
            id: string;
            title: string;
            description?: string;
            order: number;
            prerequisites: string[];
          }>;

          console.log(`[Workflow] Step 2a: DONE — ${parsed.length} nodes found`);
          return parsed;
        },
      );

      // ── Advance progress to 2: "Building roadmap..." complete, now lessons ──
      // This is a cheap dedicated step so Cloudflare Workflows can idempotently
      // skip it on replay. We don't roll this into the lesson loop because the
      // loop body is one step per lesson — we want the UI to tick over to icon 2
      // exactly once, at the START of lesson generation, regardless of how many
      // nodes there are.
      await step.do("advance-step-to-lessons", async () => {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.roadmaps)
          .set({ currentStep: 2, updatedAt: new Date() })
          .where(eq(schema.roadmaps.id, roadmapId!));
        console.log(`[Workflow] Progress: currentStep=2 (lessons phase)`);
      });

      // ── Step 2b: generate-lesson-{nodeId} (per lesson) ─────────────────────
      const lessonIds: string[] = [];

      for (const node of nodes) {
        console.log(`[Workflow] Step 2b: generate-lesson-${node.id} — "${node.title}" (${lessonIds.length + 1}/${nodes.length})`);
        const lessonId = await step.do(
          `generate-lesson-${node.id}`,
          {
            retries: {
              limit: 3,
              delay: "15 seconds",
              backoff: "exponential",
            },
          },
          async () => {
            try {
              const db = drizzle(this.env.DB, { schema });
              const id = `${roadmapId}-lesson-${node.id}`;

              const roadmapRows = await db
                .select({ topic: schema.roadmaps.topic })
                .from(schema.roadmaps)
                .where(eq(schema.roadmaps.id, roadmapId!))
                .limit(1);

              const roadmapTopic = roadmapRows[0]?.topic ?? topic;

              // Raw Markdown output — no JSON wrapper.
              // The 8B model cannot reliably escape Markdown inside JSON strings.
              // Instead: output raw Markdown starting with # Title, parse it ourselves.
              const lessonSystemPrompt = buildLessonSystemPrompt(
                roadmapTopic,
                node.title,
                node.description ?? "",
              ).replace(
                "Respond ONLY with valid JSON matching the provided schema. No prose, no markdown fences.",
                "Start your response with a # heading containing the lesson title, then write the full lesson content in Markdown. Do NOT wrap the output in JSON — write raw Markdown only."
              );

              const aiResponse = await (this.env.AI.run as any)(
                MODEL_LESSON,
                {
                  messages: [
                    { role: "system", content: lessonSystemPrompt },
                    { role: "user", content: `Write the lesson for: ${node.title}` },
                  ],
                },
              );

              // Extract raw text from AI response
              const rawMarkdown =
                typeof aiResponse === "string"
                  ? aiResponse
                  : typeof (aiResponse as any)?.response === "string"
                    ? (aiResponse as any).response
                    : JSON.stringify(aiResponse);

              console.log(`[Workflow] Step 2b: raw Markdown length=${rawMarkdown.length}`);

              const { title, content } = parseLessonMarkdown(rawMarkdown);
              const validated = LessonOutputSchema.parse({ title, content });

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

              console.log(`[Workflow] Step 2b: DONE — lessonId="${id}" title="${validated.title}"`);
              return id;
            } catch (err) {
              console.error(`[Workflow] Step 2b: FAILED lesson "${node.title}" nodeId="${node.id}"`, err);
              throw err;
            }
          },
        );

        lessonIds.push(lessonId);
      }

      console.log(`[Workflow] All lessons generated: ${lessonIds.length} lessons`);

      // ── Advance progress to 3: lessons done, quizzes + embeddings running ──
      // Icon 3 ("Generating lessons..." per UI GENERATION_STEPS) lights up as
      // active. From here on, the user sees all three icons engaged; the final
      // transition to "complete" flips the bubble into its success state with
      // the "View roadmap" button.
      await step.do("advance-step-to-quizzes", async () => {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.roadmaps)
          .set({ currentStep: 3, updatedAt: new Date() })
          .where(eq(schema.roadmaps.id, roadmapId!));
        console.log(`[Workflow] Progress: currentStep=3 (quizzes + embeddings phase)`);
      });

      // ── Step 3: generate-quiz-{lessonId} (per lesson) ──────────────────────
      for (let idx = 0; idx < lessonIds.length; idx++) {
        const lessonId = lessonIds[idx];
        console.log(`[Workflow] Step 3: generate-quiz — lessonId="${lessonId}" (${idx + 1}/${lessonIds.length})`);

        await step.do(
          `generate-quiz-${lessonId}`,
          {
            retries: {
              limit: 3,
              delay: "15 seconds",
              backoff: "exponential",
            },
          },
          async () => {
            try {
              const db = drizzle(this.env.DB, { schema });

              const lessonRows = await db
                .select()
                .from(schema.lessons)
                .where(eq(schema.lessons.id, lessonId))
                .limit(1);

              if (lessonRows.length === 0) {
                console.warn(`[Workflow] Step 3: lesson "${lessonId}" not found in D1, skipping quiz`);
                return;
              }

              const lesson = lessonRows[0];

              // 8B-fast variant supports json_schema (on official JSON mode list).
              // Quiz JSON is short/structured — no long Markdown in string values.
              const aiResponse = await (this.env.AI.run as any)(
                MODEL_QUIZ,
                {
                  messages: [
                    { role: "system", content: buildQuizSystemPrompt(lesson.content) },
                    { role: "user", content: "Generate comprehension quiz questions for this lesson." },
                  ],
                  response_format: {
                    type: "json_schema",
                    json_schema: QUIZ_JSON_SCHEMA,
                  },
                },
              );

              const parsed = parseAIResponse(aiResponse);
              const validated = QuizOutputSchema.parse(parsed);

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

              console.log(`[Workflow] Step 3: DONE — quizId="${quizId}" questions=${validated.questions.length}`);
            } catch (err) {
              console.error(`[Workflow] Step 3: FAILED quiz for lessonId="${lessonId}"`, err);
              throw err;
            }
          },
        );
      }

      console.log(`[Workflow] All quizzes generated for ${lessonIds.length} lessons`);

      // ── Step 4: embed-content-{lessonId} (per lesson) ──────────────────────
      for (let idx = 0; idx < lessonIds.length; idx++) {
        const lessonId = lessonIds[idx];
        console.log(`[Workflow] Step 4: embed-content — lessonId="${lessonId}" (${idx + 1}/${lessonIds.length})`);

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
            try {
              const db = drizzle(this.env.DB, { schema });

              const lessonRows = await db
                .select()
                .from(schema.lessons)
                .where(eq(schema.lessons.id, lessonId))
                .limit(1);

              if (lessonRows.length === 0) {
                console.warn(`[Workflow] Step 4: lesson "${lessonId}" not found in D1, skipping embed`);
                return;
              }

              const lesson = lessonRows[0];

              const plainText = lesson.content
                .replace(/#+\s/g, "")
                .replace(/\*\*(.+?)\*\*/g, "$1")
                .replace(/\*(.+?)\*/g, "$1")
                .replace(/`{1,3}[^`]*`{1,3}/g, "")
                .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
                .replace(/^\s*[-*+]\s/gm, "")
                .replace(/^\s*\d+\.\s/gm, "")
                .trim();

              const chunks = chunkText(plainText, 300, 50);
              console.log(`[Workflow] Step 4: lesson "${lesson.title}" — ${chunks.length} chunks to embed`);

              for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];

                const embeddingResponse = await this.env.AI.run(
                  MODEL_EMBED,
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

              console.log(`[Workflow] Step 4: DONE — lessonId="${lessonId}" embedded ${chunks.length} chunks`);
            } catch (err) {
              console.error(`[Workflow] Step 4: FAILED embed for lessonId="${lessonId}"`, err);
              throw err;
            }
          },
        );
      }

      console.log(`[Workflow] All embeddings complete for ${lessonIds.length} lessons`);

      // ── Step 5: mark-complete ──────────────────────────────────────────────
      // Leave currentStep=3 (icon 3 done); the UI's `status === "complete"`
      // branch force-sets activeStep=3 and swaps to the "View roadmap" button,
      // so currentStep's final value no longer matters once status flips.
      console.log(`[Workflow] Step 5: mark-complete — roadmapId="${roadmapId}"`);
      await step.do("mark-complete", async () => {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.roadmaps)
          .set({ status: "complete", updatedAt: new Date() })
          .where(eq(schema.roadmaps.id, roadmapId!));
      });

      console.log(`[Workflow] COMPLETE — roadmapId="${roadmapId}" topic="${topic}" lessons=${lessonIds.length}`);
    } catch (error) {
      console.error(`[Workflow] FATAL ERROR — roadmapId="${roadmapId}" topic="${topic}"`, error);

      if (roadmapId) {
        try {
          const db = drizzle(this.env.DB, { schema });
          await db
            .update(schema.roadmaps)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(schema.roadmaps.id, roadmapId));
          console.log(`[Workflow] Marked roadmap "${roadmapId}" as failed`);
        } catch (statusErr) {
          console.error(`[Workflow] Failed to mark roadmap as failed`, statusErr);
        }
      }
      throw error;
    }
  }
}
