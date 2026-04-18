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

// VALIDATION.md 04-02 (MULT-01): POST /api/battle/join accepts a 6-char
// join code, routes the request to the BattleRoom DO via X-Battle-Op, and
// returns either status:"ready" (pool hit) or status:"generating" (miss).

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedRoadmap(
  userId: string,
  topic = "join-topic",
): Promise<string> {
  const roadmapId = `r-join-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roadmapId,
      userId,
      `Join Test ${topic}`,
      topic,
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
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
  const body = (await res.json()) as { battleId: string; joinCode: string };
  return body;
}

/**
 * Build a test Env that replaces AI + VECTORIZE + BATTLE_QUESTION_WORKFLOW
 * with deterministic mocks so findOrQueueTopic returns "miss" / "generating"
 * without hitting live bindings. Keeps DB + BATTLE_ROOM real.
 */
function testEnvWithMocks(): Env {
  const mockAI = createMockAI({});
  const mockVectorize = createMockVectorize([]); // forces miss path
  const mockWorkflow = {
    create: async ({ id }: { id: string }) => ({ id }),
  };
  return {
    ...env,
    AI: mockAI,
    VECTORIZE: mockVectorize,
    BATTLE_QUESTION_WORKFLOW: mockWorkflow,
  } as unknown as Env;
}

describe("POST /api/battle/join (04-02 / MULT-01)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("battle-join-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("battle-join-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;
  });

  it("happy path: guest with valid code joins → D1 reflects guest + winning roadmap; response returns battleId + status", async () => {
    const testEnv = testEnvWithMocks();
    const hostRoadmapId = await seedRoadmap(HOST_ID, "topic-alpha");
    const guestRoadmapId = await seedRoadmap(GUEST_ID, "topic-beta");

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );

    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: guestRoadmapId }),
      },
      testEnv,
    );

    // miss path → 202 generating. Hit path would be 200 ready but our mock
    // Vectorize always returns empty matches.
    expect([200, 202]).toContain(res.status);
    const body = (await res.json()) as {
      status: "ready" | "generating";
      battleId: string;
      winningRoadmapId: string;
      winningTopic: string;
      poolTopicId: string;
    };
    expect(body.battleId).toBe(battleId);
    expect(body.status).toBe("generating");
    // winningRoadmap must be one of host or guest
    expect([hostRoadmapId, guestRoadmapId]).toContain(body.winningRoadmapId);
    expect(["topic-alpha", "topic-beta"]).toContain(body.winningTopic);

    // D1 row reflects the update.
    const row = await env.DB.prepare(
      `SELECT guest_id, guest_roadmap_id, winning_roadmap_id, winning_topic, status, pool_topic_id FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{
        guest_id: string;
        guest_roadmap_id: string;
        winning_roadmap_id: string;
        winning_topic: string;
        status: string;
        pool_topic_id: string;
      }>();
    expect(row).toBeTruthy();
    expect(row!.guest_id).toBe(GUEST_ID);
    expect(row!.guest_roadmap_id).toBe(guestRoadmapId);
    expect(row!.status).toBe("pre-battle");
    expect(row!.winning_roadmap_id).toBe(body.winningRoadmapId);
    expect(row!.pool_topic_id).toBe(body.poolTopicId);
  });

  it("rejects join with wrong code with 404", async () => {
    const testEnv = testEnvWithMocks();
    const guestRoadmapId = await seedRoadmap(GUEST_ID, "topic-wrong");
    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: "ZZZZZZ", roadmapId: guestRoadmapId }),
      },
      testEnv,
    );
    expect(res.status).toBe(404);
  });

  it("rejects host trying to join their own battle with 400", async () => {
    const testEnv = testEnvWithMocks();
    const roadmapId = await seedRoadmap(HOST_ID, "topic-self");
    const { joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      roadmapId,
      testEnv,
    );

    const app = buildApp();
    const res = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId }),
      },
      testEnv,
    );
    expect(res.status).toBe(400);
  });

  it("rejects second guest when battle already has two players with 400", async () => {
    const testEnv = testEnvWithMocks();
    const hostRoadmapId = await seedRoadmap(HOST_ID, "topic-full");
    const firstGuestRoadmap = await seedRoadmap(GUEST_ID, "topic-full-guest");

    const { joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );

    const app = buildApp();
    // First guest joins successfully.
    const res1 = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode, roadmapId: firstGuestRoadmap }),
      },
      testEnv,
    );
    expect([200, 202]).toContain(res1.status);

    // Third party tries to join — should fail with 400 (battle already has two)
    // or 404 (because status is no longer 'lobby' after the first join).
    const thirdSession = await createTestSession(
      "battle-join-third@test.example",
    );
    const thirdRoadmap = await seedRoadmap(thirdSession.userId, "topic-third");
    const res2 = await app.request(
      "/api/battle/join",
      {
        method: "POST",
        headers: {
          Cookie: thirdSession.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ joinCode, roadmapId: thirdRoadmap }),
      },
      testEnv,
    );
    // Battle has transitioned to 'pre-battle' so the status='lobby' lookup
    // returns nothing → 404 (code no longer finds a joinable battle).
    expect([400, 404]).toContain(res2.status);
  });
});
