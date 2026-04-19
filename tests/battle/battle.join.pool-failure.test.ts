import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
  setupD1,
  createTestSession,
  createMockAI,
  createMockVectorize,
} from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-32 (MULT-01, threat T-04-gap-01): gap closure for UAT
// Phase 04 Test 5 blocker.
//
// Contract: POST /api/battle/join MUST NOT mutate D1 or the BattleRoom DO
// when findOrQueueTopic throws (e.g., Workers AI InferenceUpstreamError
// 1031, Vectorize upstream failure). The battle row must stay in
// status='lobby', the join code must remain valid for retry, and the
// caller must receive a structured 503 with code='AI_UPSTREAM_TEMPORARY'.
//
// Also verifies that the retry-with-jitter wrapper added in battle-pool.ts
// absorbs a single transient flake without surfacing as a user-visible error.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedRoadmap(userId: string, topic = "pool-fail-topic"): Promise<string> {
  const roadmapId = `r-pf-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(roadmapId, userId, `Pool-Fail ${topic}`, topic, "linear", "complete", "[]", now, now)
    .run();
  return roadmapId;
}

async function createBattleViaRoute(
  hostCookie: string,
  roadmapId: string,
  testEnv: Env,
): Promise<{ battleId: string; joinCode: string }> {
  const app = buildApp();
  const res = await app.request(
    "/api/battle",
    {
      method: "POST",
      headers: { Cookie: hostCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ roadmapId, questionCount: 5 }),
    },
    testEnv,
  );
  if (res.status !== 200) {
    throw new Error(`create failed with status ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { battleId: string; joinCode: string };
}

/**
 * AI mock that throws InferenceUpstreamError 1031 on EVERY call. Used to
 * simulate a persistent upstream outage — retryWithJitter will attempt
 * twice (original + 1 retry) and both fail, surfacing as a 503 to the
 * caller. callCount() lets the test assert the retry wrapper actually
 * retried before giving up.
 */
function aiAlwaysFails(): {
  run: (model: string, opts: unknown) => Promise<unknown>;
  callCount: () => number;
} {
  let n = 0;
  return {
    run: async (_model: string, _opts: unknown) => {
      n++;
      throw new Error("InferenceUpstreamError: error code: 1031");
    },
    callCount: () => n,
  };
}

/**
 * AI mock that throws 1031 on the FIRST call and returns a valid 1024-dim
 * embedding on every subsequent call. Proves retryWithJitter absorbs a
 * single-shot flake.
 */
function aiFlakesOnce(): {
  run: (model: string, opts: unknown) => Promise<unknown>;
  callCount: () => number;
} {
  let n = 0;
  return {
    run: async (_model: string, _opts: unknown) => {
      n++;
      if (n === 1) throw new Error("InferenceUpstreamError: error code: 1031");
      return { data: [new Array(1024).fill(0.01)] };
    },
    callCount: () => n,
  };
}

/**
 * Vectorize mock that throws on every .query call. Models the second class
 * of transient upstream failure covered by gap 04-09.
 */
function vectorizeAlwaysFails(): {
  upsert: () => Promise<{ count: number }>;
  query: () => Promise<never>;
} {
  return {
    upsert: async () => ({ count: 1 }),
    query: async () => {
      throw new Error("VectorizeUpstreamError: transient query failure");
    },
  };
}

/**
 * Build a test Env overriding AI / VECTORIZE / BATTLE_QUESTION_WORKFLOW so
 * the join path does not hit live bindings. Mirrors the pattern used in
 * battle.join.test.ts (self-contained, no shared fixture helpers).
 */
function envWith(
  aiBinding: unknown,
  vectorizeBinding: unknown,
): Env {
  const mockWorkflow = {
    create: async ({ id }: { id: string }) => ({ id }),
  };
  return {
    ...env,
    AI: aiBinding,
    VECTORIZE: vectorizeBinding,
    BATTLE_QUESTION_WORKFLOW: mockWorkflow,
  } as unknown as Env;
}

describe("POST /api/battle/join — pool-failure isolation (04-32 / gap 04-09)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("pool-fail-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("pool-fail-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;
  });

  it("A: persistent AI failure → 503 AI_UPSTREAM_TEMPORARY; battle stays in lobby, no mutation leak", async () => {
    const ai = aiAlwaysFails();
    const testEnv = envWith(ai, createMockVectorize([]));
    const hostRm = await seedRoadmap(HOST_ID, "pool-fail-A");
    const guestRm = await seedRoadmap(GUEST_ID, "pool-fail-A-guest");
    const { battleId, joinCode } = await createBattleViaRoute(HOST_COOKIE, hostRm, testEnv);

    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRm }),
      },
      testEnv,
    );

    // 1. Structured 503 with code AI_UPSTREAM_TEMPORARY.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("AI_UPSTREAM_TEMPORARY");
    expect(typeof body.error).toBe("string");
    expect(body.error).toMatch(/temporarily unavailable/i);

    // 2. retryWithJitter MUST have made at least 2 attempts before surfacing.
    expect(ai.callCount()).toBeGreaterThanOrEqual(2);

    // 3. Critical invariants — battle row is untouched. No mutation leaked.
    const row = await env.DB.prepare(
      `SELECT guest_id, status, pool_topic_id, winning_roadmap_id, winning_topic
         FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{
        guest_id: string | null;
        status: string;
        pool_topic_id: string | null;
        winning_roadmap_id: string | null;
        winning_topic: string | null;
      }>();
    expect(row).toBeTruthy();
    expect(row!.guest_id).toBeNull();
    expect(row!.status).toBe("lobby");
    expect(row!.pool_topic_id).toBeNull();
    expect(row!.winning_roadmap_id).toBeNull();
    expect(row!.winning_topic).toBeNull();
  });

  it("B: flake-once AI → retry absorbs the flake; battle transitions to pre-battle", async () => {
    const ai = aiFlakesOnce();
    const testEnv = envWith(ai, createMockVectorize([]));
    const hostRm = await seedRoadmap(HOST_ID, "pool-fail-B");
    const guestRm = await seedRoadmap(GUEST_ID, "pool-fail-B-guest");
    const { battleId, joinCode } = await createBattleViaRoute(HOST_COOKIE, hostRm, testEnv);

    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRm }),
      },
      testEnv,
    );

    // Miss path (empty Vectorize matches) → 202 generating.
    expect([200, 202]).toContain(res.status);

    // retryWithJitter: 1 failure + 1 success = 2 calls minimum.
    expect(ai.callCount()).toBeGreaterThanOrEqual(2);

    // Battle row advanced to pre-battle with guest attached.
    const row = await env.DB.prepare(
      `SELECT guest_id, status, pool_topic_id FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ guest_id: string | null; status: string; pool_topic_id: string | null }>();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("pre-battle");
    expect(row!.guest_id).toBe(GUEST_ID);
    expect(row!.pool_topic_id).not.toBeNull();
  });

  it("C: terminal-fail leaves joinCode usable; retry-success same code reaches pre-battle", async () => {
    const hostRm = await seedRoadmap(HOST_ID, "pool-fail-C");
    const guestRm = await seedRoadmap(GUEST_ID, "pool-fail-C-guest");

    // Attempt 1 — AI fully broken. Use badEnv for BOTH the create AND the
    // join so the create path also runs against the mocks; only the join
    // is expected to fail under this test env (create does not call
    // findOrQueueTopic).
    const badAi = aiAlwaysFails();
    const envBad = envWith(badAi, createMockVectorize([]));
    const { battleId, joinCode } = await createBattleViaRoute(HOST_COOKIE, hostRm, envBad);

    const app = buildApp();
    const res1 = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRm }),
      },
      envBad,
    );
    expect(res1.status).toBe(503);

    // After the failure, verify the code is still valid: status stays 'lobby'
    // and no guest attached, which means the partial UNIQUE index still
    // resolves this joinCode on the next attempt.
    const afterFailure = await env.DB.prepare(
      `SELECT guest_id, status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ guest_id: string | null; status: string }>();
    expect(afterFailure!.status).toBe("lobby");
    expect(afterFailure!.guest_id).toBeNull();

    // Attempt 2 — healthy AI. Same joinCode must still resolve and land
    // the battle in pre-battle with the guest attached.
    const envGood = envWith(createMockAI({}), createMockVectorize([]));
    const res2 = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRm }),
      },
      envGood,
    );
    expect([200, 202]).toContain(res2.status);

    const afterSuccess = await env.DB.prepare(
      `SELECT guest_id, status, pool_topic_id FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ guest_id: string | null; status: string; pool_topic_id: string | null }>();
    expect(afterSuccess!.status).toBe("pre-battle");
    expect(afterSuccess!.guest_id).toBe(GUEST_ID);
    expect(afterSuccess!.pool_topic_id).not.toBeNull();
  });

  it("D: Vectorize failure isolates state (same invariants as case A)", async () => {
    const testEnv = envWith(createMockAI({}), vectorizeAlwaysFails());
    const hostRm = await seedRoadmap(HOST_ID, "pool-fail-D");
    const guestRm = await seedRoadmap(GUEST_ID, "pool-fail-D-guest");
    const { battleId, joinCode } = await createBattleViaRoute(HOST_COOKIE, hostRm, testEnv);

    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRm }),
      },
      testEnv,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("AI_UPSTREAM_TEMPORARY");

    const row = await env.DB.prepare(
      `SELECT guest_id, status, pool_topic_id FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ guest_id: string | null; status: string; pool_topic_id: string | null }>();
    expect(row!.guest_id).toBeNull();
    expect(row!.status).toBe("lobby");
    expect(row!.pool_topic_id).toBeNull();
  });
});
