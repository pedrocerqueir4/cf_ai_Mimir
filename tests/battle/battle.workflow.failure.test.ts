import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import {
  generateAndStoreBattleQuestions,
  markPoolTopicFailed,
} from "../../worker/src/workflows/BattleQuestionGenerationWorkflow";

// VALIDATION.md 04-33 (MULT-01, MULT-02, gap 04-10):
// BattleQuestionGenerationWorkflow must surface a user-visible failure
// when Workers AI drops the inference connection ("Network connection
// lost"). The workflow's outer catch calls markPoolTopicFailed which
// flips battle_pool_topics.status='failed'; polling clients then see
// poolStatus='failed' via GET /api/battle/:id and transition to the
// error pane.
//
// Tests the step body helpers directly (Plan 04-03 Option B testing
// pattern) — the WorkflowEntrypoint runtime cannot be driven from
// miniflare, so we validate:
//   A: markPoolTopicFailed compositional contract
//   B: step body (generateAndStoreBattleQuestions) fails atomically
//   C: full simulated outer-catch path (workflow.ts lines 268-285)
//
// The tightened retry budget (Task 1 of this plan: ~9s total) is locked
// by a static source-level assertion rather than wall-clock timing —
// miniflare cannot drive Workflow retry scheduling.

async function seedGeneratingPoolTopic(
  poolTopicId: string,
  topic: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
     VALUES (?, ?, 'generating', ?, ?, ?)`,
  )
    .bind(poolTopicId, `${topic}-${poolTopicId}`, poolTopicId, now, now)
    .run();
}

/** AI mock that throws Network connection lost on every call. */
function aiAlwaysDropsConnection(): {
  run: (...args: unknown[]) => Promise<unknown>;
  callCount: () => number;
} {
  let n = 0;
  return {
    run: async () => {
      n++;
      throw new Error("Network connection lost");
    },
    callCount: () => n,
  };
}

describe("BattleQuestionGenerationWorkflow failure surface (04-33 / gap 04-10)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("A: markPoolTopicFailed flips battle_pool_topics.status from 'generating' to 'failed'", async () => {
    const poolTopicId = `wf-fail-A-${crypto.randomUUID()}`;
    await seedGeneratingPoolTopic(poolTopicId, "pool-fail-topic-A");

    await markPoolTopicFailed(env as unknown as Env, poolTopicId);

    const row = await env.DB.prepare(
      `SELECT status, updated_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string; updated_at: number }>();

    expect(row).toBeTruthy();
    expect(row!.status).toBe("failed");
    // updated_at can be a Drizzle-mapped Date-encoded value; just confirm
    // it is present and not null (the write happened).
    expect(row!.updated_at).not.toBeNull();
    expect(row!.updated_at).toBeDefined();
  });

  it("B: generateAndStoreBattleQuestions throws on persistent AI network drop and does NOT partially write", async () => {
    const poolTopicId = `wf-fail-B-${crypto.randomUUID()}`;
    await seedGeneratingPoolTopic(poolTopicId, "pool-fail-topic-B");
    const ai = aiAlwaysDropsConnection();
    const testEnv = { ...env, AI: ai } as unknown as Env;

    await expect(
      generateAndStoreBattleQuestions(testEnv, {
        topic: "pool-fail-topic-B",
        poolTopicId,
      }),
    ).rejects.toThrow(/Network connection lost/);

    expect(ai.callCount()).toBeGreaterThanOrEqual(1);

    // No partial writes: battle_quiz_pool should have zero rows for this
    // pool_topic_id — the error propagates before the per-question INSERT
    // loop runs (env.AI.run is the first await inside the helper).
    const rows = await env.DB.prepare(
      `SELECT id FROM battle_quiz_pool WHERE pool_topic_id = ?`,
    )
      .bind(poolTopicId)
      .all<{ id: string }>();
    expect(rows.results).toHaveLength(0);

    // battle_pool_topics row status unchanged (still 'generating') —
    // markPoolTopicFailed is the caller's responsibility (the workflow's
    // outer catch). The step body itself does NOT self-mark failed.
    const topicRow = await env.DB.prepare(
      `SELECT status FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(topicRow!.status).toBe("generating");
  });

  it("C: full simulated failure path — step-1 throws → outer catch calls markPoolTopicFailed → polling client sees 'failed'", async () => {
    const poolTopicId = `wf-fail-C-${crypto.randomUUID()}`;
    const topic = "pool-fail-topic-C";
    await seedGeneratingPoolTopic(poolTopicId, topic);
    const ai = aiAlwaysDropsConnection();
    const testEnv = { ...env, AI: ai } as unknown as Env;

    // Simulate the workflow's outer try/catch block behaviour.
    let caught: unknown = null;
    try {
      await generateAndStoreBattleQuestions(testEnv, {
        topic,
        poolTopicId,
      });
    } catch (err) {
      caught = err;
      // This is the EXACT call the workflow's catch at
      // BattleQuestionGenerationWorkflow.ts line 274 makes.
      await markPoolTopicFailed(testEnv, poolTopicId);
    }
    expect(caught).toBeTruthy();

    // What GET /api/battle/:id returns to a polling lobby/pre-battle
    // client: worker/src/routes/battle.ts reads battle_pool_topics.status
    // and surfaces it as poolStatus in the JSON response.
    const row = await env.DB.prepare(
      `SELECT status FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(row!.status).toBe("failed");
  });
});
