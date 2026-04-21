import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
  setupD1,
  createTestSession,
  createMockAI,
} from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-40 (MULT-01, gap 04-12 / T-04-gap-10/11/12):
// POST /api/battle/:id/pool/retry endpoint contract.
//
// Six branches asserted:
//   A: 403 non-host
//   B: 404 battle without poolTopicId
//   C: 409 battle status !== 'pre-battle'
//   D: 200 {status:'ready'} — idempotent no-op on ready pool
//   E: 409 {status:'generating', inFlight:true} — recent workflow
//   F: 202 {status:'generating', restarted:true} — failed → re-fired
//
// The mocked BATTLE_QUESTION_WORKFLOW binding captures `.create(...)` calls so
// we can assert (for F) that the endpoint never reads topic from the request
// body (T-04-gap-12) and that guest/ready/inFlight paths do NOT fire the
// workflow. Mirrors the env-override pattern from battle.join.pool-failure.test.ts.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

// Mock workflow binding that records .create calls without running anything.
function mockWorkflowBinding() {
  const calls: Array<{ id: string; params: unknown }> = [];
  return {
    binding: {
      create: async (args: { id: string; params: unknown }) => {
        calls.push(args);
        return { id: args.id };
      },
    },
    getCalls: () => calls,
  };
}

async function seedRoadmap(userId: string, topic: string): Promise<string> {
  const roadmapId = `r-retry-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(roadmapId, userId, "Retry Test", topic, "linear", "complete", "[]", now, now)
    .run();
  return roadmapId;
}

async function seedPoolTopic(
  poolTopicId: string,
  topic: string,
  status: "generating" | "ready" | "failed",
  workflowStartedAt: number | null = null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, workflow_started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      poolTopicId,
      `${topic}-${poolTopicId}`,
      status,
      poolTopicId,
      workflowStartedAt,
      now,
      now,
    )
    .run();
}

async function seedPreBattle(
  battleId: string,
  hostId: string,
  guestId: string | null,
  poolTopicId: string | null,
  winningTopic: string | null = "retry-topic",
  status:
    | "lobby"
    | "pre-battle"
    | "active"
    | "completed"
    | "expired"
    | "forfeited" = "pre-battle",
): Promise<void> {
  const roadmapId = await seedRoadmap(hostId, `retry-host-topic-${battleId}`);
  const now = Math.floor(Date.now() / 1000);
  // Use the last 6 chars of the battleId for the join_code — UNIQUE constraint
  // only applies WHERE status='lobby', so collisions don't matter for our
  // pre-battle / active seeded rows.
  await env.DB.prepare(
    `INSERT INTO battles (id, join_code, host_id, guest_id, host_roadmap_id, winning_roadmap_id, winning_topic, pool_topic_id, question_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      battleId,
      battleId.slice(-6).toUpperCase(),
      hostId,
      guestId,
      roadmapId,
      roadmapId,
      winningTopic,
      poolTopicId,
      5,
      status,
      now,
    )
    .run();
}

describe("POST /api/battle/:id/pool/retry (04-40 / gap 04-12)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("A: non-host guest → 403 Forbidden", async () => {
    const host = await createTestSession("host-retry-A@test.example");
    const guest = await createTestSession("guest-retry-A@test.example");
    const battleId = `b-retry-A-${crypto.randomUUID()}`;
    const poolTopicId = `pt-retry-A-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "retry-A-topic", "failed");
    await seedPreBattle(battleId, host.userId, guest.userId, poolTopicId);

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: guest.cookie } },
      { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env,
    );
    expect(res.status).toBe(403);
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("B: battle without poolTopicId → 404", async () => {
    const host = await createTestSession("host-retry-B@test.example");
    const battleId = `b-retry-B-${crypto.randomUUID()}`;
    await seedPreBattle(battleId, host.userId, null, null);

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: host.cookie } },
      { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body).toHaveProperty("error");
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("C: battle status !== 'pre-battle' → 409", async () => {
    const host = await createTestSession("host-retry-C@test.example");
    const battleId = `b-retry-C-${crypto.randomUUID()}`;
    const poolTopicId = `pt-retry-C-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "retry-C-topic", "ready");
    await seedPreBattle(
      battleId,
      host.userId,
      null,
      poolTopicId,
      "retry-topic",
      "active",
    );

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: host.cookie } },
      { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env,
    );
    expect(res.status).toBe(409);
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("D: poolStatus='ready' → 200 {status:'ready'}, idempotent no-op", async () => {
    const host = await createTestSession("host-retry-D@test.example");
    const battleId = `b-retry-D-${crypto.randomUUID()}`;
    const poolTopicId = `pt-retry-D-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "retry-D-topic", "ready");
    await seedPreBattle(battleId, host.userId, null, poolTopicId);

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: host.cookie } },
      { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ready");
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("E: poolStatus='generating' AND fresh workflow_started_at → 409 inFlight", async () => {
    const host = await createTestSession("host-retry-E@test.example");
    const battleId = `b-retry-E-${crypto.randomUUID()}`;
    const poolTopicId = `pt-retry-E-${crypto.randomUUID()}`;
    // Fresh: workflow_started_at = now (well within 60s window).
    await seedPoolTopic(poolTopicId, "retry-E-topic", "generating", Date.now());
    await seedPreBattle(battleId, host.userId, null, poolTopicId);

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: host.cookie } },
      { ...env, BATTLE_QUESTION_WORKFLOW: mock.binding } as unknown as Env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      status: string;
      inFlight?: boolean;
      workflowRunId?: string;
    };
    expect(body.status).toBe("generating");
    expect(body.inFlight).toBe(true);
    expect(body.workflowRunId).toBe(poolTopicId);
    expect(mock.getCalls()).toHaveLength(0);
  });

  it("F: poolStatus='failed' → 202 restarted, workflow re-fired, workflow_started_at nulled", async () => {
    const host = await createTestSession("host-retry-F@test.example");
    const battleId = `b-retry-F-${crypto.randomUUID()}`;
    const poolTopicId = `pt-retry-F-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "retry-F-topic", "failed", 12345);
    await seedPreBattle(battleId, host.userId, null, poolTopicId);

    // embedTopic calls env.AI.run internally; provide a mock that returns
    // a 1024-dim vector so the endpoint resolves without hitting Workers AI.
    const mockAI = createMockAI({});

    const mock = mockWorkflowBinding();
    const res = await buildApp().request(
      `/api/battle/${battleId}/pool/retry`,
      { method: "POST", headers: { Cookie: host.cookie } },
      {
        ...env,
        AI: mockAI,
        BATTLE_QUESTION_WORKFLOW: mock.binding,
      } as unknown as Env,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      status: string;
      restarted?: boolean;
      workflowRunId?: string;
    };
    expect(body.status).toBe("generating");
    expect(body.restarted).toBe(true);
    expect(body.workflowRunId).toBe(poolTopicId);

    // D1 side-effects:
    const row = await env.DB.prepare(
      `SELECT status, workflow_started_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string; workflow_started_at: number | null }>();
    expect(row?.status).toBe("generating");
    expect(row?.workflow_started_at).toBeNull();

    // Workflow was fired exactly once with the same id.
    // T-04-gap-12: the params.topic is re-read from the DB row (not the
    // request body), so we can assert the canonical topic value.
    expect(mock.getCalls()).toHaveLength(1);
    expect(mock.getCalls()[0]?.id).toBe(poolTopicId);
    const firedParams = mock.getCalls()[0]?.params as {
      topic: string;
      poolTopicId: string;
      topicEmbedding: number[];
    };
    expect(firedParams.poolTopicId).toBe(poolTopicId);
    // Server-canonical topic — NEVER sourced from the request body.
    expect(firedParams.topic).toBe(`retry-F-topic-${poolTopicId}`);
  });
});
