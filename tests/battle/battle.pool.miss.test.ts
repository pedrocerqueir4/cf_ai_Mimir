import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createMockAI, createMockVectorize } from "../setup";
import { findOrQueueTopic } from "../../worker/src/services/battle-pool";

// VALIDATION.md 04-27 (MULT-01): battleQuizPool miss — when no similar topic
// exists in Vectorize, findOrQueueTopic inserts a new battle_pool_topics row
// in status 'generating' and triggers BattleQuestionGenerationWorkflow.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("battle pool miss — triggers workflow (04-27)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("returns status:'miss' with UUID poolTopicId + schedules workflow exactly once", async () => {
    const rawTopic = `Obscure Mongolian Throat Singing ${crypto.randomUUID()}`;

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]); // empty matches

    const createCalls: Array<{ id: string; params: unknown }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push(opts);
        return { id: opts.id };
      },
    };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, rawTopic);

    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;

    expect(result.poolTopicId).toMatch(UUID_RE);
    // Contract: workflowRunId === poolTopicId so status polling is 1:1.
    expect(result.workflowRunId).toBe(result.poolTopicId);

    // Workflow was scheduled exactly once.
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].id).toBe(result.poolTopicId);

    const params = createCalls[0].params as {
      topic: string;
      poolTopicId: string;
      topicEmbedding: number[];
    };
    expect(params.topic).toBe(rawTopic.trim().toLowerCase());
    expect(params.poolTopicId).toBe(result.poolTopicId);
    expect(Array.isArray(params.topicEmbedding)).toBe(true);
    expect(params.topicEmbedding.length).toBe(1024);
  });

  it("inserts a battle_pool_topics row with status='generating'", async () => {
    const rawTopic = `Lattice Gauge Theory ${crypto.randomUUID()}`;
    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    const mockWorkflow = { create: async ({ id }: { id: string }) => ({ id }) };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, rawTopic);
    if (result.status !== "miss") throw new Error("expected miss");

    const row = await env.DB
      .prepare(
        `SELECT id, topic, status, workflow_run_id FROM battle_pool_topics WHERE id = ?`,
      )
      .bind(result.poolTopicId)
      .first<{ id: string; topic: string; status: string; workflow_run_id: string | null }>();

    expect(row).toBeTruthy();
    expect(row!.status).toBe("generating");
    expect(row!.workflow_run_id).toBe(result.poolTopicId);
    expect(row!.topic).toBe(rawTopic.trim().toLowerCase());
  });

  it("sub-threshold match (score 0.50) still treated as miss", async () => {
    const rawTopic = `Rare Mineralogy ${crypto.randomUUID()}`;
    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([
      { id: "some-other-topic", score: 0.5, metadata: { poolTopicId: "some-other-topic" } },
    ]);

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

    const result = await findOrQueueTopic(testEnv, rawTopic);
    expect(result.status).toBe("miss");
    expect(createCalls).toBe(1);
  });
});
