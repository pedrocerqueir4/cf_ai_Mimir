import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-14 (MULT-04 / D-17-RANDOM-TIER): when both players
// propose different wager tiers, the server picks one uniformly at random
// (via crypto.getRandomValues) and applies it. Over N iterations both
// outcomes should be observed.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedBattleInPreBattle(
  hostId: string,
  guestId: string,
): Promise<string> {
  const battleId = `b-wager-rnd-${crypto.randomUUID()}`;
  const joinCode = `R${crypto.randomUUID().slice(0, 5)}`.toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const hostRoadmapId = `r-host-${crypto.randomUUID()}`;
  const guestRoadmapId = `r-guest-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hostRoadmapId,
      hostId,
      "wager rand host",
      "wager-rand",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      guestRoadmapId,
      guestId,
      "wager rand guest",
      "wager-rand-g",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO battles (id, join_code, host_id, guest_id, host_roadmap_id, guest_roadmap_id, question_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pre-battle', ?)`,
  )
    .bind(
      battleId,
      joinCode,
      hostId,
      guestId,
      hostRoadmapId,
      guestRoadmapId,
      5,
      now,
    )
    .run();

  return battleId;
}

async function seedUserStats(userId: string, xp: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO user_stats (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, last_streak_date, last_active_roadmap_id, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, NULL, NULL, ?)`,
  )
    .bind(userId, xp, now)
    .run();
}

describe("POST /api/battle/:id/wager — random tier pick (04-14 / D-17-RANDOM-TIER)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("wager-rand-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("wager-rand-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;

    await seedUserStats(HOST_ID, 1000);
    await seedUserStats(GUEST_ID, 1000);
  });

  it("over 20 iterations with hostTier=10/guestTier=20, both applied tiers observed", async () => {
    const app = buildApp();
    const appliedTiers = new Set<number>();

    for (let i = 0; i < 20; i++) {
      const battleId = await seedBattleInPreBattle(HOST_ID, GUEST_ID);

      // Host proposes tier 10.
      const resHost = await app.request(
        `/api/battle/${battleId}/wager`,
        {
          method: "POST",
          headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({ tier: 10 }),
        },
        env,
      );
      expect(resHost.status).toBe(200);
      const hostBody = (await resHost.json()) as { bothProposed: boolean };
      expect(hostBody.bothProposed).toBe(false);

      // Guest proposes tier 20 — server picks appliedTier.
      const resGuest = await app.request(
        `/api/battle/${battleId}/wager`,
        {
          method: "POST",
          headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({ tier: 20 }),
        },
        env,
      );
      expect(resGuest.status).toBe(200);
      const guestBody = (await resGuest.json()) as {
        bothProposed: boolean;
        appliedTier: 10 | 20;
      };
      expect(guestBody.bothProposed).toBe(true);
      expect([10, 20]).toContain(guestBody.appliedTier);
      appliedTiers.add(guestBody.appliedTier);

      // Early exit if both observed.
      if (appliedTiers.has(10) && appliedTiers.has(20)) break;
    }

    expect(appliedTiers.has(10)).toBe(true);
    expect(appliedTiers.has(20)).toBe(true);
  });

  it("rejects tier outside {10,15,20} with 400 (T-04-03)", async () => {
    const app = buildApp();
    const battleId = await seedBattleInPreBattle(HOST_ID, GUEST_ID);

    for (const badTier of [0, 5, 25, 50, 100, -10]) {
      const res = await app.request(
        `/api/battle/${battleId}/wager`,
        {
          method: "POST",
          headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({ tier: badTier }),
        },
        env,
      );
      expect(res.status).toBe(400);
    }
  });
});
