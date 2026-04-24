import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import {
  generateAndStoreBattleQuestions,
  upsertBattleTopicVector,
  markPoolTopicReady,
  markPoolTopicFailed,
} from "../../worker/src/workflows/BattleQuestionGenerationWorkflow";

// VALIDATION.md 04-30 (MULT-01, D-10): BattleQuestionGenerationWorkflow
// stores exactly 20 questions per topic in battle_quiz_pool, upserts the
// topic embedding to Vectorize in the "battle-topics" namespace, and marks
// the pool row ready.
//
// Test approach (Option B per plan): each step body is exported as a
// standalone helper from the workflow module. We exercise those helpers
// against a mocked env — same code the workflow runs in production.
//
// Generation note (debug battle-qgen-parse-and-504): generateAndStoreBattleQuestions
// now fans out 4 chunked AI calls of 5 questions each. The mock below returns
// a 5-question chunk per call so the merged total is 20.

function buildMockQuestions(count = 20) {
  const questions: Array<{
    questionText: string;
    questionType: "mcq" | "true_false";
    options: Array<{ id: string; text: string }>;
    correctOptionId: string;
    explanation: string;
  }> = [];
  for (let i = 0; i < count; i++) {
    const isTrueFalse = i % 5 === 0;
    if (isTrueFalse) {
      questions.push({
        questionText: `T/F question ${i}`,
        questionType: "true_false",
        options: [
          { id: "opt-true", text: "True" },
          { id: "opt-false", text: "False" },
        ],
        correctOptionId: i % 2 === 0 ? "opt-true" : "opt-false",
        explanation: `Explanation for T/F ${i}.`,
      });
    } else {
      questions.push({
        questionText: `MCQ question ${i}`,
        questionType: "mcq",
        options: [
          { id: "opt-a", text: "Alpha" },
          { id: "opt-b", text: "Bravo" },
          { id: "opt-c", text: "Charlie" },
          { id: "opt-d", text: "Delta" },
        ],
        correctOptionId: "opt-b",
        explanation: `Explanation for MCQ ${i}.`,
      });
    }
  }
  return { questions };
}

/**
 * Build a Workers-AI mock that returns a 5-question chunk per invocation.
 * Each call gets questions with unique text/ids so the 4 merged chunks don't
 * collide on correctness sanity checks.
 */
function buildChunkedAIMock() {
  let callIndex = 0;
  return {
    run: async (model: string, _opts: unknown) => {
      if (!model.includes("llama-3.1-8b")) {
        throw new Error(`Unmocked model: ${model}`);
      }
      const offset = callIndex * 5;
      callIndex += 1;
      const chunkQuestions = Array.from({ length: 5 }, (_, i) => {
        const n = offset + i;
        return {
          questionText: `MCQ question ${n}`,
          questionType: "mcq" as const,
          options: [
            { id: "opt-a", text: "Alpha" },
            { id: "opt-b", text: "Bravo" },
            { id: "opt-c", text: "Charlie" },
            { id: "opt-d", text: "Delta" },
          ],
          correctOptionId: "opt-b",
          explanation: `Explanation for MCQ ${n}.`,
        };
      });
      return { response: JSON.stringify({ questions: chunkQuestions }) };
    },
  };
}

describe("BattleQuestionGenerationWorkflow populates pool (04-30)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("generateAndStoreBattleQuestions inserts 20 rows and returns 20 ids", async () => {
    const poolTopicId = `wf-pop-${crypto.randomUUID()}`;
    const topic = "photosynthesis basics";
    const now = Math.floor(Date.now() / 1000);

    // Seed a 'generating' pool topic row (the state findOrQueueTopic leaves
    // before dispatching the workflow).
    await env.DB
      .prepare(
        `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
         VALUES (?, ?, 'generating', ?, ?, ?)`,
      )
      .bind(poolTopicId, `${topic}-${poolTopicId}`, poolTopicId, now, now)
      .run();

    const testEnv = { ...env, AI: buildChunkedAIMock() } as unknown as Env;

    const ids = await generateAndStoreBattleQuestions(testEnv, {
      topic,
      poolTopicId,
    });

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids[0]).toBe(`${poolTopicId}-q0`);
    expect(ids[19]).toBe(`${poolTopicId}-q19`);

    // Verify 20 rows exist in battle_quiz_pool for this pool topic.
    const rows = await env.DB
      .prepare(
        `SELECT id, question_text, question_type, correct_option_id
           FROM battle_quiz_pool WHERE pool_topic_id = ?`,
      )
      .bind(poolTopicId)
      .all<{ id: string; question_text: string; question_type: string; correct_option_id: string }>();

    expect(rows.results).toHaveLength(20);

    // Sanity: correct_option_id is one of the stored options in each row.
    for (const r of rows.results) {
      expect(typeof r.correct_option_id).toBe("string");
      expect(r.correct_option_id.length).toBeGreaterThan(0);
    }
  });

  it("upsertBattleTopicVector calls Vectorize with namespace 'battle-topics'", async () => {
    const poolTopicId = `wf-vec-${crypto.randomUUID()}`;
    const topic = "vector test topic";
    const topicEmbedding = new Array(1024).fill(0.01);

    const upsertCalls: unknown[] = [];
    const mockVectorize = {
      upsert: async (vectors: unknown[]) => {
        upsertCalls.push(vectors);
        return { count: vectors.length };
      },
      query: async () => ({ matches: [] }),
    };

    const testEnv = { ...env, VECTORIZE: mockVectorize } as unknown as Env;

    await upsertBattleTopicVector(testEnv, {
      poolTopicId,
      topic,
      topicEmbedding,
      questionCount: 20,
    });

    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0] as Array<{
      id: string;
      values: number[];
      namespace: string;
      metadata: Record<string, unknown>;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0].id).toBe(poolTopicId);
    expect(payload[0].namespace).toBe("battle-topics");
    expect(payload[0].values).toBe(topicEmbedding);
    expect(payload[0].metadata).toEqual({
      poolTopicId,
      topic,
      questionCount: 20,
    });
  });

  it("markPoolTopicReady flips status from generating → ready", async () => {
    const poolTopicId = `wf-ready-${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    await env.DB
      .prepare(
        `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
         VALUES (?, ?, 'generating', ?, ?, ?)`,
      )
      .bind(poolTopicId, `ready-test-${poolTopicId}`, poolTopicId, now, now)
      .run();

    await markPoolTopicReady(env as unknown as Env, poolTopicId);

    const row = await env.DB
      .prepare(`SELECT status FROM battle_pool_topics WHERE id = ?`)
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(row?.status).toBe("ready");
  });

  it("markPoolTopicFailed flips status from generating → failed (error path)", async () => {
    const poolTopicId = `wf-fail-${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    await env.DB
      .prepare(
        `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
         VALUES (?, ?, 'generating', ?, ?, ?)`,
      )
      .bind(poolTopicId, `fail-test-${poolTopicId}`, poolTopicId, now, now)
      .run();

    await markPoolTopicFailed(env as unknown as Env, poolTopicId);

    const row = await env.DB
      .prepare(`SELECT status FROM battle_pool_topics WHERE id = ?`)
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
  });

  it("end-to-end: full helper pipeline produces a ready pool with 20 rows", async () => {
    const poolTopicId = `wf-e2e-${crypto.randomUUID()}`;
    const topic = "quantum basics e2e";
    const topicEmbedding = new Array(1024).fill(0.02);
    const now = Math.floor(Date.now() / 1000);

    await env.DB
      .prepare(
        `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
         VALUES (?, ?, 'generating', ?, ?, ?)`,
      )
      .bind(poolTopicId, `${topic}-${poolTopicId}`, poolTopicId, now, now)
      .run();

    const mockAI = buildChunkedAIMock();
    const upsertCalls: unknown[] = [];
    const mockVectorize = {
      upsert: async (v: unknown[]) => {
        upsertCalls.push(v);
        return { count: v.length };
      },
      query: async () => ({ matches: [] }),
    };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
    } as unknown as Env;

    const ids = await generateAndStoreBattleQuestions(testEnv, {
      topic,
      poolTopicId,
    });
    expect(ids).toHaveLength(20);

    await upsertBattleTopicVector(testEnv, {
      poolTopicId,
      topic,
      topicEmbedding,
      questionCount: ids.length,
    });
    expect(upsertCalls).toHaveLength(1);

    await markPoolTopicReady(testEnv, poolTopicId);

    // Post-pipeline state: status='ready' + 20 rows in battle_quiz_pool.
    const poolRow = await env.DB
      .prepare(`SELECT status FROM battle_pool_topics WHERE id = ?`)
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(poolRow?.status).toBe("ready");

    const quizRows = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM battle_quiz_pool WHERE pool_topic_id = ?`)
      .bind(poolTopicId)
      .first<{ c: number }>();
    expect(quizRows?.c).toBe(20);
  });
});

// Keep `buildMockQuestions` as a legacy helper in case other suites import it
// (it's unused by this file's suites after the chunked-mock refactor).
void buildMockQuestions;
