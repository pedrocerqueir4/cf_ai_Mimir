import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createMockAI, createMockVectorize } from "../setup";
import {
  findOrQueueTopic,
  POOL_SIMILARITY_THRESHOLD,
} from "../../worker/src/services/battle-pool";

// VALIDATION.md 04-28 (MULT-01, T-04-09): similarity threshold is STRICT
// greater than 0.85. Boundaries:
//   score 0.84 → miss
//   score 0.85 → miss (strict >)
//   score 0.86 → hit

const POOL_ID = "similarity-existing-pool";
const TOPIC = "javascript closures";

async function seedReadyPool(poolTopicId: string, topic: string) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO battle_pool_topics
         (id, topic, status, workflow_run_id, created_at, updated_at)
       VALUES (?, ?, 'ready', ?, ?, ?)`,
    )
    .bind(poolTopicId, topic, poolTopicId, now, now)
    .run();

  for (let i = 0; i < 20; i++) {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO battle_quiz_pool
           (id, pool_topic_id, question_text, question_type, options_json,
            correct_option_id, explanation, created_at)
         VALUES (?, ?, ?, 'mcq', ?, 'opt-a', ?, ?)`,
      )
      .bind(
        `${poolTopicId}-q${i}`,
        poolTopicId,
        `Question ${i}`,
        JSON.stringify([
          { id: "opt-a", text: "A" },
          { id: "opt-b", text: "B" },
        ]),
        "explanation",
        now,
      )
      .run();
  }
}

function makeEnv(score: number): Env {
  const mockAI = createMockAI({});
  const mockVectorize = createMockVectorize([
    { id: POOL_ID, score, metadata: { poolTopicId: POOL_ID, topic: TOPIC } },
  ]);
  const mockWorkflow = { create: async ({ id }: { id: string }) => ({ id }) };
  return {
    ...env,
    AI: mockAI,
    VECTORIZE: mockVectorize,
    BATTLE_QUESTION_WORKFLOW: mockWorkflow,
  } as unknown as Env;
}

describe("battle pool similarity threshold — strict > 0.85 (04-28)", () => {
  beforeAll(async () => {
    await setupD1();
    await seedReadyPool(POOL_ID, TOPIC);
  });

  it("threshold constant is 0.85", () => {
    expect(POOL_SIMILARITY_THRESHOLD).toBe(0.85);
  });

  it("score 0.84 (below threshold) → miss", async () => {
    // Use a distinct raw topic so the INSERT OR IGNORE does not collide
    // with the seeded ready row (topic is UNIQUE).
    const result = await findOrQueueTopic(
      makeEnv(0.84),
      `boundary 0.84 ${crypto.randomUUID()}`,
    );
    expect(result.status).toBe("miss");
  });

  it("score 0.85 (boundary, strict >) → miss", async () => {
    const result = await findOrQueueTopic(
      makeEnv(0.85),
      `boundary 0.85 ${crypto.randomUUID()}`,
    );
    expect(result.status).toBe("miss");
  });

  it("score 0.86 (above threshold) → hit", async () => {
    const result = await findOrQueueTopic(makeEnv(0.86), "Javascript Closures");
    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.poolTopicId).toBe(POOL_ID);
    expect(result.questions.length).toBe(5);
  });

  it("score 0.999 (high similarity) → hit", async () => {
    const result = await findOrQueueTopic(makeEnv(0.999), "javascript closures");
    expect(result.status).toBe("hit");
  });
});
