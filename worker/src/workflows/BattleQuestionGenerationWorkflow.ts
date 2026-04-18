import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  BATTLE_QUIZ_JSON_SCHEMA,
  BattleQuizOutputSchema,
  buildBattleQuizSystemPrompt,
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

/**
 * Step 1 body — generate 20 questions and persist each row.
 *
 * Store-in-step pattern (D-10): writes individual rows inside the step and
 * returns only the question ids to keep the step output payload under the
 * 1MiB Workflows limit.
 */
export async function generateAndStoreBattleQuestions(
  env: Env,
  payload: { topic: string; poolTopicId: string },
): Promise<string[]> {
  const { topic, poolTopicId } = payload;
  const db = drizzle(env.DB, { schema });

  const aiResp = await (env.AI.run as any)(MODEL_QUIZ, {
    messages: [
      { role: "system", content: buildBattleQuizSystemPrompt(topic) },
      { role: "user", content: `Generate 20 quiz questions about: ${topic}` },
    ],
    response_format: {
      type: "json_schema",
      json_schema: BATTLE_QUIZ_JSON_SCHEMA,
    },
  });

  const parsed = parseAIResponse(aiResp);
  const validated = BattleQuizOutputSchema.parse(parsed);

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
      // ── Step 1: generate + store 20 questions (returns IDs only) ─────────
      const questionIds = await step.do(
        "generate-battle-questions",
        {
          retries: {
            limit: 3,
            delay: "15 seconds",
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
          console.log(
            `[BattleQuestionGenerationWorkflow] Step 2: DONE — vector upserted for poolTopicId="${poolTopicId}"`,
          );
        },
      );

      // ── Step 3: mark pool entry ready ────────────────────────────────────
      await step.do("mark-pool-ready", async () => {
        await markPoolTopicReady(this.env, poolTopicId);
        console.log(
          `[BattleQuestionGenerationWorkflow] Step 3: DONE — poolTopicId="${poolTopicId}" ready`,
        );
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
        console.log(
          `[BattleQuestionGenerationWorkflow] Marked poolTopicId="${poolTopicId}" as failed`,
        );
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
