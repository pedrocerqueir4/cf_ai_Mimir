/**
 * Regression tests for debug session: battle-topic-display-bugs
 *
 * Bug #1: /battle/join silently fell back to 12 BATTLE_STARTER_TOPICS presets
 *   when the user had no completed roadmaps. Users saw "topics that don't
 *   belong to them". Fix: show empty-state CTA instead of presets.
 *
 * Bug #2: RoadmapRevealScreen built the reel pool as
 *   [hostTopic, guestTopic, ...BATTLE_STARTER_TOPICS.slice(0,3)] which
 *   introduced 3 starter-topic decoys as visually distinct "candidates".
 *   Combined with winningRoadmapTitle being a 3rd distinct title in the
 *   pre-battle lobby response, users saw more than 2 player-meaningful
 *   candidates. Fix: restrict reel pool to [hostTopic, guestTopic] deduped.
 *
 * These tests cover the server-side half (lobby shape). The client-side
 * RoadmapRevealScreen pool logic is pure TypeScript and is tested by
 * battle.reveal-pool.unit.test.ts (no DO/D1 required).
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
  const roadmapId = `r-rvp-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'linear', 'complete', '[]', ?, ?)`,
  )
    .bind(roadmapId, userId, title, topic, now, now)
    .run();
  return roadmapId;
}

// ─── Route helpers ────────────────────────────────────────────────────────────

function missPoolEnv(): Env {
  return {
    ...env,
    AI: createMockAI({}),
    VECTORIZE: createMockVectorize([]),
    BATTLE_QUESTION_WORKFLOW: {
      create: async ({ id }: { id: string }) => ({ id }),
    },
  } as unknown as Env;
}

async function createBattleViaRoute(
  hostCookie: string,
  roadmapId: string,
  testEnv: Env,
): Promise<{ battleId: string; joinCode: string }> {
  const res = await buildApp().request(
    "/api/battle",
    {
      method: "POST",
      headers: { Cookie: hostCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ roadmapId, questionCount: 5 }),
    },
    testEnv,
  );
  if (res.status !== 200)
    throw new Error(`create failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ battleId: string; joinCode: string }>;
}

async function joinBattleViaRoute(
  guestCookie: string,
  joinCode: string,
  payload: { roadmapId: string } | { presetTopic: string },
  testEnv: Env,
): Promise<Response> {
  return buildApp().request(
    "/api/battle/join",
    {
      method: "POST",
      headers: { Cookie: guestCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ joinCode, ...payload }),
    },
    testEnv,
  );
}

async function getLobbyViaRoute(
  cookie: string,
  battleId: string,
  testEnv: Env,
): Promise<Response> {
  return buildApp().request(
    `/api/battle/${battleId}`,
    { method: "GET", headers: { Cookie: cookie } },
    testEnv,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("battle reveal pool — lobby shape regression (debug battle-topic-display-bugs)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("rvp-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("rvp-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;
  });

  it("TWO ROADMAPS: lobby returns exactly 2 distinct player titles (host + guest)", async () => {
    // Both players have distinct roadmaps. Reel candidates must be exactly 2.
    const testEnv = missPoolEnv();

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "javascript basics",
      "JavaScript Basics: A Complete Guide",
    );
    const guestRoadmapId = await seedRoadmap(
      GUEST_ID,
      "python basics",
      "Python Basics: From Zero to Hero",
    );

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );
    await joinBattleViaRoute(
      GUEST_COOKIE,
      joinCode,
      { roadmapId: guestRoadmapId },
      testEnv,
    );

    const lobbyRes = await getLobbyViaRoute(HOST_COOKIE, battleId, testEnv);
    expect(lobbyRes.status).toBe(200);
    const lobby = (await lobbyRes.json()) as {
      hostRoadmapTitle: string;
      guestRoadmapTitle: string | null;
      winningRoadmapTitle: string | null;
      winningTopic: string | null;
    };

    const hostTitle = "JavaScript Basics: A Complete Guide";
    const guestTitle = "Python Basics: From Zero to Hero";

    expect(lobby.hostRoadmapTitle).toBe(hostTitle);
    expect(lobby.guestRoadmapTitle).toBe(guestTitle);

    // winningRoadmapTitle must be one of the two player titles — never a 3rd value.
    expect(lobby.winningRoadmapTitle).not.toBeNull();
    expect([hostTitle, guestTitle]).toContain(lobby.winningRoadmapTitle);

    // The reel pool [hostRoadmapTitle, guestRoadmapTitle] deduped has exactly
    // 2 distinct entries. winningRoadmapTitle is one of them, so no 3rd title.
    const reelCandidates = new Set([
      lobby.hostRoadmapTitle,
      lobby.guestRoadmapTitle,
    ]);
    expect(reelCandidates.size).toBe(2);

    // winningRoadmapTitle must be contained in the reel candidate set.
    expect(reelCandidates.has(lobby.winningRoadmapTitle!)).toBe(true);
  });

  it("SAME ROADMAP TOPIC: dedup leaves 1 candidate; winningRoadmapTitle stays in set", async () => {
    // Edge case: both players pick roadmaps on the same topic (same title).
    // Deduped reel pool has 1 item. winningRoadmapTitle must still be that item.
    const testEnv = missPoolEnv();

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "react fundamentals",
      "React Fundamentals: A Practical Guide",
    );
    const guestRoadmapId = await seedRoadmap(
      GUEST_ID,
      "react fundamentals",
      "React Fundamentals: A Practical Guide",
    );

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );
    await joinBattleViaRoute(
      GUEST_COOKIE,
      joinCode,
      { roadmapId: guestRoadmapId },
      testEnv,
    );

    const lobbyRes = await getLobbyViaRoute(HOST_COOKIE, battleId, testEnv);
    expect(lobbyRes.status).toBe(200);
    const lobby = (await lobbyRes.json()) as {
      hostRoadmapTitle: string;
      guestRoadmapTitle: string | null;
      winningRoadmapTitle: string | null;
    };

    const sharedTitle = "React Fundamentals: A Practical Guide";
    expect(lobby.hostRoadmapTitle).toBe(sharedTitle);
    expect(lobby.guestRoadmapTitle).toBe(sharedTitle);

    // Even though both are the same, winningRoadmapTitle is still that title.
    expect(lobby.winningRoadmapTitle).toBe(sharedTitle);

    // Reel pool deduped: 1 unique entry. No starter-topic decoys injected.
    const reelCandidates = new Set([
      lobby.hostRoadmapTitle,
      lobby.guestRoadmapTitle,
    ]);
    expect(reelCandidates.size).toBe(1);
    expect(reelCandidates.has(lobby.winningRoadmapTitle!)).toBe(true);
  });

  it("HOST ROADMAP + GUEST PRESET: lobby has hostRoadmapTitle + null guestRoadmapTitle", async () => {
    // When guest uses a preset topic (no real roadmap), guestRoadmapTitle is
    // null in the lobby (the preset is stored as a raw topic string in
    // winningTopic, not as a roadmap row). The reel should use hostRoadmapTitle
    // and the preset topic string — never a 3rd unrelated title.
    const testEnv = missPoolEnv();

    const hostRoadmapId = await seedRoadmap(
      HOST_ID,
      "algorithms 101",
      "Algorithms 101: From Basics to Mastery",
    );

    const { battleId, joinCode } = await createBattleViaRoute(
      HOST_COOKIE,
      hostRoadmapId,
      testEnv,
    );

    // Guest joins with a preset topic (no roadmap row, bypasses ownership check).
    const joinRes = await joinBattleViaRoute(
      GUEST_COOKIE,
      joinCode,
      { presetTopic: "Python basics" },
      testEnv,
    );
    expect([200, 202]).toContain(joinRes.status);

    const lobbyRes = await getLobbyViaRoute(HOST_COOKIE, battleId, testEnv);
    expect(lobbyRes.status).toBe(200);
    const lobby = (await lobbyRes.json()) as {
      hostRoadmapTitle: string;
      guestRoadmapTitle: string | null;
      winningRoadmapTitle: string | null;
      winningTopic: string | null;
    };

    // Host always has a roadmap title; guest (preset) has null.
    expect(lobby.hostRoadmapTitle).toBe("Algorithms 101: From Basics to Mastery");
    expect(lobby.guestRoadmapTitle).toBeNull();

    // winningRoadmapTitle falls back to winningTopic when the winning side has
    // no roadmap row (i.e., preset path).
    expect(lobby.winningRoadmapTitle).not.toBeNull();
    // It must be either the host's AI title or the preset topic string —
    // never a value from BATTLE_STARTER_TOPICS that nobody chose.
    const validWinners = [
      "Algorithms 101: From Basics to Mastery",
      // winningTopic for preset path is the normalized preset string.
      lobby.winningTopic,
    ].filter(Boolean) as string[];
    expect(validWinners).toContain(lobby.winningRoadmapTitle);
  });
});
