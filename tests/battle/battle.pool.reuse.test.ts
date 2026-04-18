import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createMockAI, createMockVectorize } from "../setup";
import {
  findOrQueueTopic,
  normalizeTopic,
} from "../../worker/src/services/battle-pool";

// VALIDATION.md 04-26 (MULT-01): battleQuizPool reuse — an existing topic
// with similarity score > 0.85 returns cached questions instead of triggering
// a fresh workflow run.

const EXISTING_TOPIC_ID = "existing-pool-topic-reuse";
const EXISTING_TOPIC_NORMALIZED = "react fundamentals";

async function seedReadyPool(poolTopicId: string, topic: string, count = 20) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO battle_pool_topics
         (id, topic, status, workflow_run_id, created_at, updated_at)
       VALUES (?, ?, 'ready', ?, ?, ?)`,
    )
    .bind(poolTopicId, topic, poolTopicId, now, now)
    .run();

  for (let i = 0; i < count; i++) {
    const questionId = `${poolTopicId}-q${i}`;
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO battle_quiz_pool
           (id, pool_topic_id, question_text, question_type, options_json,
            correct_option_id, explanation, created_at)
         VALUES (?, ?, ?, 'mcq', ?, 'opt-a', ?, ?)`,
      )
      .bind(
        questionId,
        poolTopicId,
        `Question ${i} about ${topic}?`,
        JSON.stringify([
          { id: "opt-a", text: "Option A" },
          { id: "opt-b", text: "Option B" },
          { id: "opt-c", text: "Option C" },
          { id: "opt-d", text: "Option D" },
        ]),
        `Because reason ${i}.`,
        now,
      )
      .run();
  }
}

describe("battle pool reuse — hit path returns cached questions (04-26)", () => {
  beforeAll(async () => {
    await setupD1();
    await seedReadyPool(EXISTING_TOPIC_ID, EXISTING_TOPIC_NORMALIZED);
  });

  it("returns status:'hit' when Vectorize returns score > 0.85", async () => {
    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([
      {
        id: EXISTING_TOPIC_ID,
        score: 0.92,
        metadata: { poolTopicId: EXISTING_TOPIC_ID, topic: EXISTING_TOPIC_NORMALIZED },
      },
    ]);

    let workflowCreateCalls = 0;
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => {
        workflowCreateCalls++;
        return { id };
      },
    };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, "React Fundamentals");

    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;

    expect(result.poolTopicId).toBe(EXISTING_TOPIC_ID);
    expect(result.questions).toHaveLength(5);
    expect(result.reservedQuestions).toHaveLength(5);

    // Exactly 10 distinct question ids across questions + reserved.
    const allIds = new Set([
      ...result.questions.map((q) => q.id),
      ...result.reservedQuestions.map((q) => q.id),
    ]);
    expect(allIds.size).toBe(10);

    // Workflow NEVER called on hit path.
    expect(workflowCreateCalls).toBe(0);
  });

  it("normalizeTopic collapses case + whitespace + trailing punctuation", () => {
    expect(normalizeTopic("React Fundamentals")).toBe("react fundamentals");
    expect(normalizeTopic("  React   Fundamentals  ")).toBe("react fundamentals");
    expect(normalizeTopic("react fundamentals.")).toBe("react fundamentals");
    expect(normalizeTopic("react fundamentals??!")).toBe("react fundamentals");
    // Different semantic content stays distinct.
    expect(normalizeTopic("Python 3")).not.toBe(normalizeTopic("Python3"));
  });

  it("hit path parses options JSON into structured options arrays", async () => {
    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([
      {
        id: EXISTING_TOPIC_ID,
        score: 0.99,
        metadata: { poolTopicId: EXISTING_TOPIC_ID },
      },
    ]);
    const mockWorkflow = { create: async ({ id }: { id: string }) => ({ id }) };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, "react fundamentals");
    if (result.status !== "hit") throw new Error("expected hit");

    for (const q of result.questions) {
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.correctOptionId).toBeTruthy();
      expect(typeof q.questionText).toBe("string");
    }
  });
});
