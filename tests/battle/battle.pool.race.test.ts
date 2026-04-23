import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createMockAI, createMockVectorize } from "../setup";
import { findOrQueueTopic } from "../../worker/src/services/battle-pool";

// VALIDATION.md 04-29 (MULT-01, T-04-10): concurrent pool population for the
// same fresh topic must deduplicate via the UNIQUE(topic) constraint. Exactly
// one workflow is scheduled; the losing caller returns status:"generating"
// and points at the winner's poolTopicId.

describe("battle pool race — UNIQUE(topic) dedupes workflow creation (04-29)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("two parallel findOrQueueTopic calls for the same topic → exactly one workflow.create", async () => {
    // Use a topic that is guaranteed NOT to collide with any pre-seeded pool row.
    const topic = `python basics race ${crypto.randomUUID()}`;

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]); // always miss

    let createCalls = 0;
    const createdIds: string[] = [];
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => {
        createCalls++;
        createdIds.push(id);
        return { id };
      },
    };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const [a, b] = await Promise.all([
      findOrQueueTopic(testEnv, topic),
      findOrQueueTopic(testEnv, topic),
    ]);

    // Exactly ONE workflow creation across both awaits — T-04-10 mitigation.
    expect(createCalls).toBe(1);

    // Both results reference the same canonical poolTopicId.
    expect(a.poolTopicId).toBe(b.poolTopicId);

    // One call won (miss), the other lost (generating).
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["generating", "miss"]);

    // Winner's workflowRunId (fresh UUID, decoupled from poolTopicId per
    // debug battle-pool-requeue-silent) matches the scheduled workflow id.
    const winner = a.status === "miss" ? a : b;
    if (winner.status !== "miss") throw new Error("winner must be miss");
    expect(createdIds[0]).toBe(winner.workflowRunId);
    expect(winner.workflowRunId).not.toBe(winner.poolTopicId);

    // Loser's workflowRunId points at the SAME live workflow instance the
    // winner scheduled — both read it from battle_pool_topics.workflow_run_id
    // so client-side status polling converges on the same run.
    const loser = a.status === "generating" ? a : b;
    expect(loser.workflowRunId).toBe(winner.workflowRunId);

    // Exactly one battle_pool_topics row exists for the topic (normalized form).
    const rows = await env.DB
      .prepare(`SELECT id, status FROM battle_pool_topics WHERE topic = ?`)
      .bind(topic.trim().toLowerCase())
      .all<{ id: string; status: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].id).toBe(winner.poolTopicId);
  });

  it("three parallel calls → still exactly one workflow.create", async () => {
    const topic = `elixir otp race ${crypto.randomUUID()}`;

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    let createCalls = 0;
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => {
        createCalls++;
        return { id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const results = await Promise.all([
      findOrQueueTopic(testEnv, topic),
      findOrQueueTopic(testEnv, topic),
      findOrQueueTopic(testEnv, topic),
    ]);

    expect(createCalls).toBe(1);
    const canonicalId = results[0].poolTopicId;
    for (const r of results) {
      expect(r.poolTopicId).toBe(canonicalId);
    }
    const missCount = results.filter((r) => r.status === "miss").length;
    const generatingCount = results.filter((r) => r.status === "generating").length;
    expect(missCount).toBe(1);
    expect(generatingCount).toBe(2);
  });
});
