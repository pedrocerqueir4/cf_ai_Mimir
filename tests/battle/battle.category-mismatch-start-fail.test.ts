/**
 * Regression test for debug session: battle-category-mismatch-start-fail
 *
 * Root cause: when findOrQueueTopic returned 'miss' or 'generating' at join
 * time, the BattleRoom DO's config.questions was left empty []. The pool
 * workflow later stored questions in D1 and flipped poolStatus='ready', but
 * there was no mechanism to push them into the DO. POST /start → opStartBattle
 * → 409 "no questions loaded" — battle always failed to start on the miss path.
 *
 * Fix: POST /start now calls sampleQuestions + opSetQuestions before
 * opStartBattle, ensuring the DO has questions regardless of whether the pool
 * was a hit or miss at join time.
 *
 * Also tests: the lobby GET endpoint now surfaces winningRoadmapTitle (the
 * AI-generated roadmap title, e.g. "React Fundamentals: A Complete Guide")
 * in addition to winningTopic (the raw extracted prompt). The frontend uses
 * winningRoadmapTitle for the reveal display so users see proper titles, not
 * raw prompt strings.
 */

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

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

// ─── D1 seeders ──────────────────────────────────────────────────────────────

async function seedRoadmap(
  userId: string,
  topic: string,
  title: string,
): Promise<string> {
  const roadmapId = `r-cmf-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'linear', 'complete', '[]', ?, ?)`,
  )
    .bind(roadmapId, userId, title, topic, now, now)
    .run();
  return roadmapId;
}

async function seedReadyPool(poolTopicId: string, topic: string, count = 20) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO battle_pool_topics
       (id, topic, status, workflow_run_id, created_at, updated_at)
     VALUES (?, ?, 'ready', ?, ?, ?)`,
  )
    .bind(poolTopicId, topic, poolTopicId, now, now)
    .run();

  for (let i = 0; i < count; i++) {
    const questionId = `${poolTopicId}-q${i}`;
    await env.DB.prepare(
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
        `Explanation ${i}.`,
        now,
      )
      .run();
  }
}

async function seedUserXp(userId: string, xp: number) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO user_stats (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, ?)`,
  )
    .bind(userId, xp, now)
    .run();
}

// ─── Route helpers ────────────────────────────────────────────────────────────

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
    throw new Error(`create failed ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{ battleId: string; joinCode: string }>;
}

async function joinBattleViaRoute(
  guestCookie: string,
  joinCode: string,
  roadmapId: string,
  testEnv: Env,
): Promise<Response> {
  const app = buildApp();
  return app.request(
    "/api/battle/join",
    {
      method: "POST",
      headers: { Cookie: guestCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode, roadmapId }),
    },
    testEnv,
  );
}

async function submitWagerViaRoute(
  cookie: string,
  battleId: string,
  tier: 10 | 15 | 20,
  testEnv: Env,
): Promise<Response> {
  const app = buildApp();
  return app.request(
    `/api/battle/${battleId}/wager`,
    {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    },
    testEnv,
  );
}

async function startBattleViaRoute(
  hostCookie: string,
  battleId: string,
  testEnv: Env,
): Promise<Response> {
  const app = buildApp();
  return app.request(
    `/api/battle/${battleId}/start`,
    {
      method: "POST",
      headers: { Cookie: hostCookie },
    },
    testEnv,
  );
}

async function getLobbyViaRoute(
  cookie: string,
  battleId: string,
  testEnv: Env,
): Promise<Response> {
  const app = buildApp();
  return app.request(
    `/api/battle/${battleId}`,
    {
      method: "GET",
      headers: { Cookie: cookie },
    },
    testEnv,
  );
}

// ─── Test env builder ─────────────────────────────────────────────────────────

function testEnvMissPool(): Env {
  // Vectorize always returns no matches → forces miss path in findOrQueueTopic.
  const mockAI = createMockAI({});
  const mockVectorize = createMockVectorize([]);
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("battle category mismatch + start fail — regression (debug battle-category-mismatch-start-fail)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("cmf-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("cmf-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;
  });

  it("MISS PATH: POST /start succeeds after pool generates (questions loaded from D1 at start time)", async () => {
    // This test reproduces the primary bug:
    //   - join → pool miss → DO has no questions
    //   - pool workflow generates questions in D1 (simulated by seedReadyPool)
    //   - POST /start must sample from D1 and push to DO before opStartBattle
    //   - Without the fix: opStartBattle returns 409 "no questions loaded"
    //   - With the fix: questions loaded at start time → battle starts

    const testEnv = testEnvMissPool();

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "javascript basics",
      "JavaScript Fundamentals: A Complete Guide",
    );
    const guestRoadmapId = await seedRoadmap(
      GUEST_ID,
      "python basics",
      "Python Fundamentals: From Zero to Hero",
    );

    await seedUserXp(HOST_ID, 200);
    await seedUserXp(GUEST_ID, 150);

    // Step 1: Host creates battle.
    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );
    expect(battleId).toBeTruthy();

    // Step 2: Guest joins — Vectorize returns no matches so pool is a miss.
    const joinRes = await joinBattleViaRoute(
      GUEST_COOKIE,
      joinCode,
      guestRoadmapId,
      testEnv,
    );
    expect([200, 202]).toContain(joinRes.status);
    const joinBody = (await joinRes.json()) as {
      status: string;
      poolTopicId: string;
    };
    // The mock always forces a miss (no vectorize matches).
    expect(joinBody.status).toBe("generating");

    // Step 3: Simulate the workflow completing — seed pool questions in D1.
    // This is what BattleQuestionGenerationWorkflow does: INSERT into
    // battle_quiz_pool and UPDATE battle_pool_topics.status='ready'.
    const poolTopicId = joinBody.poolTopicId;
    await seedReadyPool(poolTopicId, "javascript basics");
    await env.DB.prepare(
      `UPDATE battle_pool_topics SET status = 'ready' WHERE id = ?`,
    )
      .bind(poolTopicId)
      .run();

    // Step 4: Both players submit wagers (required before /start).
    const wagerRes1 = await submitWagerViaRoute(HOST_COOKIE, battleId, 10, testEnv);
    expect([200, 201]).toContain(wagerRes1.status);

    const wagerRes2 = await submitWagerViaRoute(GUEST_COOKIE, battleId, 10, testEnv);
    expect([200, 201]).toContain(wagerRes2.status);

    // Verify appliedWagerTier is set (both wagers submitted).
    const battle = await env.DB.prepare(
      `SELECT applied_wager_tier FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ applied_wager_tier: number | null }>();
    expect(battle?.applied_wager_tier).not.toBeNull();

    // Step 5: Host calls /start — this is where the bug manifested.
    // Without the fix: DO startBattle returns 409 "no questions loaded".
    // With the fix: questions are sampled from D1 and pushed to DO first.
    const startRes = await startBattleViaRoute(HOST_COOKIE, battleId, testEnv);
    // The route always returns 200 (it forwards the 409 to the DO but still
    // returns 200 from the HTTP handler). The important signal is the D1
    // battles row flipping to 'active'.
    expect(startRes.status).toBe(200);

    // Verify battle status changed to 'active' in D1.
    const updatedBattle = await env.DB.prepare(
      `SELECT status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(updatedBattle?.status).toBe("active");
  });

  it("HIT PATH: battle still starts when pool was a hit at join time", async () => {
    // Control case: when pool is a hit at join time, questions are loaded in
    // DO during join (existing behaviour). POST /start should also succeed
    // via the re-push at start time (idempotent safety net).

    const poolTopicId = `cmf-hit-pool-${crypto.randomUUID()}`;
    const normalizedTopic = "typescript advanced";
    await seedReadyPool(poolTopicId, normalizedTopic);

    // Vectorize returns a high-score match for this pool.
    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([
      {
        id: poolTopicId,
        score: 0.95,
        metadata: { poolTopicId, topic: normalizedTopic },
      },
    ]);
    const mockWorkflow = { create: async ({ id }: { id: string }) => ({ id }) };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "TypeScript Advanced",
      "TypeScript Advanced: Mastering the Type System",
    );
    const guestRoadmapId = await seedRoadmap(
      GUEST_ID,
      "TypeScript Advanced",
      "TypeScript Advanced: Mastering the Type System",
    );

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );

    const joinRes = await joinBattleViaRoute(
      GUEST_COOKIE,
      joinCode,
      guestRoadmapId,
      testEnv,
    );
    // With a pool hit, join should return 200 ready.
    expect(joinRes.status).toBe(200);
    const joinBody = (await joinRes.json()) as { status: string };
    expect(joinBody.status).toBe("ready");

    // Both wagers.
    await submitWagerViaRoute(HOST_COOKIE, battleId, 15, testEnv);
    await submitWagerViaRoute(GUEST_COOKIE, battleId, 15, testEnv);

    const startRes = await startBattleViaRoute(HOST_COOKIE, battleId, testEnv);
    expect(startRes.status).toBe(200);

    const updatedBattle = await env.DB.prepare(
      `SELECT status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(updatedBattle?.status).toBe("active");
  });

  it("GET /:id lobby surfaces winningRoadmapTitle (AI title, not raw topic)", async () => {
    // Regression: lobby.winningTopic was the raw user prompt (e.g. "react basics")
    // while the proper display title (e.g. "React Basics: A Complete Guide") was
    // in roadmaps.title. The fix surfaces winningRoadmapTitle from roadmaps.title.

    const testEnv = testEnvMissPool();

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "react basics",
      "React Basics: From Zero to Hero",
    );
    const guestRoadmapId = await seedRoadmap(
      GUEST_ID,
      "vue basics",
      "Vue Basics: A Practical Introduction",
    );

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );

    // Guest joins — coin flip selects one of the two roadmaps as winner.
    await joinBattleViaRoute(GUEST_COOKIE, joinCode, guestRoadmapId, testEnv);

    // Fetch lobby state via GET /:id.
    const lobbyRes = await getLobbyViaRoute(HOST_COOKIE, battleId, testEnv);
    expect(lobbyRes.status).toBe(200);
    const lobby = (await lobbyRes.json()) as {
      winningTopic: string | null;
      winningRoadmapTitle: string | null;
      winningRoadmapId: string | null;
      hostRoadmapTitle: string;
      guestRoadmapTitle: string | null;
    };

    // winningRoadmapTitle must be present.
    expect(lobby.winningRoadmapTitle).not.toBeNull();

    // winningRoadmapTitle must be the AI-generated title, not the raw topic.
    // The winning roadmap is either host's or guest's (coin flip is random):
    const hostTitle = "React Basics: From Zero to Hero";
    const guestTitle = "Vue Basics: A Practical Introduction";
    expect([hostTitle, guestTitle]).toContain(lobby.winningRoadmapTitle);

    // winningTopic is still present (raw topic — preserved for back-compat).
    expect(lobby.winningTopic).not.toBeNull();
    expect(["react basics", "vue basics"]).toContain(lobby.winningTopic);

    // winningRoadmapTitle must NOT be the raw topic string (the bug).
    expect(lobby.winningRoadmapTitle).not.toBe(lobby.winningTopic);
  });
});
