import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  BATTLE_QUIZ_CHUNK_COUNT,
  BATTLE_QUIZ_CHUNK_SIZE,
  BATTLE_QUIZ_CHUNK_THEMES,
  BattleQuizChunkOutputSchema,
  BattleQuizOutputSchema,
  buildBattleQuizChunkJsonSchema,
  buildBattleQuizChunkSystemPrompt,
} from "../validation/battle-prompts";
import { BATTLE_TOPICS_NAMESPACE } from "../services/battle-pool";

// ─── Payload ──────────────────────────────────────────────────────────────────

export type BattlePoolPayload = {
  topic: string;           // normalized (lowercase, trimmed)
  poolTopicId: string;     // UUID — also used as workflow instance id
  topicEmbedding: number[]; // 1024-dim, produced upstream in findOrQueueTopic
};

// ─── Model Selection ─────────────────────────────────────────────────────────
// 8B-fast supports json_schema response_format (the -fp8 variant does not).
// Short, structured quiz output — no long Markdown inside string values.
const MODEL_QUIZ = "@cf/meta/llama-3.1-8b-instruct-fast" as const;

// Workers AI defaults max_tokens to 256 for llama-3.1-8b-instruct-fast, which
// truncates a 5-question json_schema payload mid-string (root cause of debug
// session battle-qgen-parse-and-504). 2048 leaves ~2× headroom per chunk.
const BATTLE_QUIZ_MAX_TOKENS = 2048;

// ─── AI Response Parser ──────────────────────────────────────────────────────
// Copied from ContentGenerationWorkflow.ts (lines 80-162) so the battle
// workflow is self-contained. Extract to a shared module in a future cleanup.

function repairJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

  try { JSON.parse(s); return s; } catch { /* needs repair */ }

  s = s.replace(/"""/g, '"');

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
    if (inString && ch === "\n") { result += "\\n"; continue; }
    if (inString && ch === "\r") { result += "\\r"; continue; }
    if (inString && ch === "\t") { result += "\\t"; continue; }
    result += ch;
  }

  result = result.replace(/,\s*([}\]])/g, "$1");
  return result;
}

function parseAIResponse(aiResponse: unknown): unknown {
  if (typeof aiResponse === "string") {
    return JSON.parse(repairJson(aiResponse));
  }
  if (aiResponse && typeof aiResponse === "object" && "response" in aiResponse) {
    const resp = (aiResponse as Record<string, unknown>).response;
    if (typeof resp === "string") {
      return JSON.parse(repairJson(resp));
    }
    if (typeof resp === "object" && resp !== null) {
      return resp;
    }
  }
  if (aiResponse && typeof aiResponse === "object") {
    return aiResponse;
  }
  throw new Error(`Unexpected AI response type: ${typeof aiResponse}`);
}

// ─── Step Body Helpers (Option B — directly testable without workflow runtime) ─
// Each helper mirrors one `step.do` invocation. Tests exercise them against a
// mock env; the workflow's `run()` composes them so the production behavior
// and the test behavior share the exact same code.

async function generateQuestionChunk(
  env: Env,
  topic: string,
  count: number,
  chunkLabel: string,
): Promise<unknown[]> {
  const aiResp = await (env.AI.run as any)(MODEL_QUIZ, {
    messages: [
      {
        role: "system",
        content: buildBattleQuizChunkSystemPrompt(topic, count, chunkLabel),
      },
      {
        role: "user",
        content: `Generate ${count} quiz questions about: ${topic}`,
      },
    ],
    max_tokens: BATTLE_QUIZ_MAX_TOKENS,
    response_format: {
      type: "json_schema",
      json_schema: buildBattleQuizChunkJsonSchema(count),
    },
  });

  const parsed = parseAIResponse(aiResp);
  const validated = BattleQuizChunkOutputSchema.parse(parsed);
  return validated.questions;
}

/**
 * Step 1 body — generate 20 questions and persist each row.
 *
 * Store-in-step pattern (D-10): writes individual rows inside the step and
 * returns only the question ids to keep the step output payload under the
 * 1MiB Workflows limit.
 *
 * Generation uses chunked fan-out (4 × 5 questions in parallel) because a
 * single 20-question call to @cf/meta/llama-3.1-8b-instruct-fast hits the
 * default `max_tokens=256` ceiling and truncates mid-string. See debug
 * session battle-qgen-parse-and-504 (2026-04-23).
 */
export async function generateAndStoreBattleQuestions(
  env: Env,
  payload: { topic: string; poolTopicId: string },
): Promise<string[]> {
  const { topic, poolTopicId } = payload;
  const db = drizzle(env.DB, { schema });

  // Parallel fan-out — 4 chunks of 5 questions each. Promise.all short-
  // circuits on the first chunk that throws; the surrounding step.do
  // retry policy then re-runs the entire generation (not just the failing
  // chunk). This is intentional: a partial pool would violate D-09's
  // "exactly 20" invariant.
  const chunkResults = await Promise.all(
    Array.from({ length: BATTLE_QUIZ_CHUNK_COUNT }, (_, i) =>
      generateQuestionChunk(
        env,
        topic,
        BATTLE_QUIZ_CHUNK_SIZE,
        BATTLE_QUIZ_CHUNK_THEMES[i] ?? "general understanding",
      ),
    ),
  );

  // Merge and validate exactly 20 — reuses the existing D-09 guard so the
  // downstream contract is unchanged.
  const validated = BattleQuizOutputSchema.parse({
    questions: chunkResults.flat(),
  });

  const ids: string[] = [];
  for (let i = 0; i < validated.questions.length; i++) {
    const q = validated.questions[i];
    const id = `${poolTopicId}-q${i}`;
    await db
      .insert(schema.battleQuizPool)
      .values({
        id,
        poolTopicId,
        questionText: q.questionText,
        questionType: q.questionType,
        optionsJson: JSON.stringify(q.options),
        correctOptionId: q.correctOptionId,
        explanation: q.explanation,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    ids.push(id);
  }
  return ids;
}

/**
 * Step 2 body — upsert the topic embedding to Vectorize in the battle-topics
 * namespace (T-04-VEC-INJECT isolation).
 */
export async function upsertBattleTopicVector(
  env: Env,
  payload: {
    poolTopicId: string;
    topic: string;
    topicEmbedding: number[];
    questionCount: number;
  },
): Promise<void> {
  const { poolTopicId, topic, topicEmbedding, questionCount } = payload;
  await (env.VECTORIZE as any).upsert([
    {
      id: poolTopicId,
      values: topicEmbedding,
      namespace: BATTLE_TOPICS_NAMESPACE,
      metadata: { poolTopicId, topic, questionCount },
    },
  ]);
}

/**
 * Step 3 body — mark the pool topic as ready so HTTP callers can consume it.
 */
export async function markPoolTopicReady(
  env: Env,
  poolTopicId: string,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  await db
    .update(schema.battlePoolTopics)
    .set({ status: "ready", updatedAt: new Date() })
    .where(eq(schema.battlePoolTopics.id, poolTopicId));
}

/**
 * Failure path — mark the pool row 'failed' so the HTTP caller can surface
 * "Something went wrong starting the battle" instead of spinning forever.
 */
export async function markPoolTopicFailed(
  env: Env,
  poolTopicId: string,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  await db
    .update(schema.battlePoolTopics)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(schema.battlePoolTopics.id, poolTopicId));
}

/**
 * Gap 04-12: observability stamp. Writes `Date.now()` (unix ms) to
 * battle_pool_topics.workflow_started_at so a silently-dropped workflow
 * (scheduling succeeded, runtime never ran) is distinguishable from a
 * slow one. updatedAt is also refreshed so the DO pool-timeout alarm's
 * staleness check sees fresh activity.
 *
 * WARN-5 footgun: `workflow_started_at` is stored as unix MILLISECONDS
 * (raw Date.now()), while `createdAt` / `updatedAt` on the same table
 * use `mode: "timestamp"` (unix SECONDS). Intentional — the 60s
 * pool-timeout windowing in POST /:id/pool/retry requires millisecond
 * precision. See the schema comment on `battlePoolTopics.workflowStartedAt`
 * in worker/src/db/schema.ts for the authoritative note.
 */
export async function markWorkflowStarted(
  env: Env,
  poolTopicId: string,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  await db
    .update(schema.battlePoolTopics)
    .set({ workflowStartedAt: Date.now(), updatedAt: new Date() })
    .where(eq(schema.battlePoolTopics.id, poolTopicId));
}

/**
 * Gap 04-12: inverse of markWorkflowStarted — called by
 * POST /api/battle/:id/pool/retry BEFORE re-firing the workflow, so the
 * retry-detection staleness check starts cleanly on the next run.
 */
export async function nullWorkflowStartedAt(
  env: Env,
  poolTopicId: string,
): Promise<void> {
  const db = drizzle(env.DB, { schema });
  await db
    .update(schema.battlePoolTopics)
    .set({ workflowStartedAt: null, updatedAt: new Date() })
    .where(eq(schema.battlePoolTopics.id, poolTopicId));
}

// ─── Workflow ─────────────────────────────────────────────────────────────────
// Composes the exported helpers above inside step.do() blocks. Retries match
// the pattern used in ContentGenerationWorkflow.ts. On FATAL failure (retries
// exhausted), we mark the pool row 'failed' so no one polls it forever.

export class BattleQuestionGenerationWorkflow extends WorkflowEntrypoint<
  Env,
  BattlePoolPayload
> {
  async run(event: WorkflowEvent<BattlePoolPayload>, step: WorkflowStep) {
    const { topic, poolTopicId, topicEmbedding } = event.payload;

    console.log(
      `[BattleQuestionGenerationWorkflow] START poolTopicId="${poolTopicId}" topic="${topic}"`,
    );

    try {
      // ── Step 0 (gap 04-12): stamp workflow_started_at so silent drops
      // are distinguishable from slow runs by the POST /pool/retry
      // endpoint and the BattleRoom DO pool-timeout alarm. Tight retry
      // budget (limit:2, delay:1s → ~3s max) because a single D1 write
      // is cheap — don't eat the step-1 budget on a trivial stamp.
      await step.do(
        "record-workflow-started",
        {
          retries: {
            limit: 2,
            delay: "1 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          await markWorkflowStarted(this.env, poolTopicId);
        },
      );

      // ── Step 1: generate + store 20 questions (returns IDs only) ─────────
      const questionIds = await step.do(
        "generate-battle-questions",
        {
          retries: {
            // Gap 04-10: tightened from {limit:3, delay:"15 seconds"} (~105s total)
            // to {limit:2, delay:"3 seconds"} (~9s total) so the outer catch block
            // writes poolStatus='failed' within wall-clock seconds on persistent
            // Workers AI network drops ("Network connection lost"). Frontend
            // stuck-pane timeout is 45s — 5x headroom over the new 9s budget.
            limit: 2,
            delay: "3 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          const ids = await generateAndStoreBattleQuestions(this.env, {
            topic,
            poolTopicId,
          });
          console.log(
            `[BattleQuestionGenerationWorkflow] Step 1: DONE — ${ids.length} question ids stored`,
          );
          return ids;
        },
      );

      // ── Step 2: upsert topic embedding to Vectorize namespace ─────────────
      await step.do(
        "upsert-topic-vector",
        {
          retries: {
            limit: 3,
            delay: "5 seconds",
            backoff: "exponential",
          },
        },
        async () => {
          await upsertBattleTopicVector(this.env, {
            poolTopicId,
            topic,
            topicEmbedding,
            questionCount: questionIds.length,
          });
        },
      );

      // ── Step 3: mark pool entry ready ────────────────────────────────────
      await step.do("mark-pool-ready", async () => {
        await markPoolTopicReady(this.env, poolTopicId);
      });

      console.log(
        `[BattleQuestionGenerationWorkflow] COMPLETE — poolTopicId="${poolTopicId}" questions=${questionIds.length}`,
      );
    } catch (error) {
      console.error(
        `[BattleQuestionGenerationWorkflow] FATAL — poolTopicId="${poolTopicId}" topic="${topic}"`,
        error,
      );
      try {
        await markPoolTopicFailed(this.env, poolTopicId);
      } catch (statusErr) {
        console.error(
          "[BattleQuestionGenerationWorkflow] failed to mark status=failed",
          statusErr,
        );
      }
      throw error;
    }
  }
}
