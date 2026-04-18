import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-18 (MULT-04 / T-04-03): wager amount MUST be re-computed
// from CURRENT XP at battle-start, not just at proposal-time. This guards
// against XP drift between the wager proposal and the actual start.
//
// Scenario: host has 1000 XP when proposing wager, both pick tier=20, so
// propose-time amount would be floor(1000 * 0.2) = 200. We then mutate
// host.xp down to 50 (simulating a concurrent XP loss). When the host
// POSTs /:id/start, the server must re-compute via computeWagerAmount(50,
// 20) = max(10, 10) = 10 — NOT the stale 200.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedBattleInPreBattle(
  hostId: string,
  guestId: string,
): Promise<string> {
  const battleId = `b-wager-rec-${crypto.randomUUID()}`;
  const joinCode = `C${crypto.randomUUID().slice(0, 5)}`.toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const hostRoadmapId = `r-rec-host-${crypto.randomUUID()}`;
  const guestRoadmapId = `r-rec-guest-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hostRoadmapId,
      hostId,
      "wager recheck host",
      "wager-recheck",
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
      "wager recheck guest",
      "wager-recheck-g",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO battles (id, join_code, host_id, guest_id, host_roadmap_id, guest_roadmap_id, winning_roadmap_id, winning_topic, question_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pre-battle', ?)`,
  )
    .bind(
      battleId,
      joinCode,
      hostId,
      guestId,
      hostRoadmapId,
      guestRoadmapId,
      hostRoadmapId,
      "wager-recheck",
      5,
      now,
    )
    .run();

  return battleId;
}

async function setUserXp(userId: string, xp: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_stats (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, last_streak_date, last_active_roadmap_id, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, NULL, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, updated_at = excluded.updated_at`,
  )
    .bind(userId, xp, now)
    .run();
}

describe("POST /api/battle/:id/start — re-validates wager against current XP (04-18)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let GUEST_COOKIE = "";
  let GUEST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("wager-rec-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const guest = await createTestSession("wager-rec-guest@test.example");
    GUEST_COOKIE = guest.cookie;
    GUEST_ID = guest.userId;
  });

  it("host XP dropping after proposal → POST /start re-reads XP and recomputes wager amount", async () => {
    // Initial state: host=1000 xp, guest=500 xp.
    await setUserXp(HOST_ID, 1000);
    await setUserXp(GUEST_ID, 500);

    const battleId = await seedBattleInPreBattle(HOST_ID, GUEST_ID);
    const app = buildApp();

    // Both propose tier=20. Both picks of appliedTier are 20 (same value).
    let res = await app.request(
      `/api/battle/${battleId}/wager`,
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: 20 }),
      },
      env,
    );
    expect(res.status).toBe(200);

    res = await app.request(
      `/api/battle/${battleId}/wager`,
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: 20 }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const proposeBody = (await res.json()) as {
      appliedTier: number;
      hostWagerAmount: number;
      guestWagerAmount: number;
    };
    expect(proposeBody.appliedTier).toBe(20);
    // At proposal time: host=1000*0.2=200, guest=500*0.2=100
    expect(proposeBody.hostWagerAmount).toBe(200);
    expect(proposeBody.guestWagerAmount).toBe(100);

    // Simulate XP drift — host suffers a massive XP loss between proposal
    // and start. Real-world cause could be a concurrent settlement from a
    // different battle finishing first.
    await setUserXp(HOST_ID, 50);

    // Host issues start — server MUST re-validate and recompute.
    res = await app.request(
      `/api/battle/${battleId}/start`,
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE },
      },
      env,
    );
    expect(res.status).toBe(200);
    const startBody = (await res.json()) as {
      appliedTier: number;
      hostWagerAmount: number;
      guestWagerAmount: number;
    };
    // 50 * 20 / 100 = 10 → max(10, 10) = 10 (floor).
    expect(startBody.hostWagerAmount).toBe(10);
    // Guest unchanged → still 100.
    expect(startBody.guestWagerAmount).toBe(100);

    // D1 row reflects the re-validated values.
    const row = await env.DB.prepare(
      `SELECT host_wager_amount, guest_wager_amount, wager_amount, status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{
        host_wager_amount: number;
        guest_wager_amount: number;
        wager_amount: number;
        status: string;
      }>();
    expect(row).toBeTruthy();
    expect(row!.host_wager_amount).toBe(10); // NOT the stale 200
    expect(row!.guest_wager_amount).toBe(100);
    expect(row!.wager_amount).toBe(110);
    expect(row!.status).toBe("active");
  });

  it("guest cannot start battle (host-only) → 403", async () => {
    await setUserXp(HOST_ID, 500);
    await setUserXp(GUEST_ID, 500);
    const battleId = await seedBattleInPreBattle(HOST_ID, GUEST_ID);
    const app = buildApp();

    // Both propose so preconditions other than host-ness are met.
    await app.request(
      `/api/battle/${battleId}/wager`,
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: 10 }),
      },
      env,
    );
    await app.request(
      `/api/battle/${battleId}/wager`,
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ tier: 10 }),
      },
      env,
    );

    const res = await app.request(
      `/api/battle/${battleId}/start`,
      {
        method: "POST",
        headers: { Cookie: GUEST_COOKIE },
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});
