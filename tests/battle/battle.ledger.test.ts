import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-17 (SEC-05 / MULT-04): every atomic XP transfer records a
// row in battle_ledger. In Plan 04-04 we do not write ledger rows (that's
// Plan 08's job), but the leaderboard endpoint consumes them. Seed a ledger
// row directly and assert it flows through GET /api/battle/leaderboard.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedUser(userId: string, name: string, email: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(userId, name, email, now, now)
    .run();
}

async function seedBattleCompleted(
  hostId: string,
  guestId: string,
  winnerId: string,
): Promise<string> {
  const battleId = `b-ledger-${crypto.randomUUID()}`;
  const joinCode = `L${crypto.randomUUID().slice(0, 5)}`.toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const hostRoadmapId = `r-led-host-${crypto.randomUUID()}`;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hostRoadmapId,
      hostId,
      "ledger host rm",
      "ledger-topic",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO battles (id, join_code, host_id, guest_id, host_roadmap_id, question_count, status, winner_id, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
  )
    .bind(battleId, joinCode, hostId, guestId, hostRoadmapId, 5, winnerId, now, now)
    .run();

  return battleId;
}

async function insertLedgerRow(
  battleId: string,
  winnerId: string,
  loserId: string,
  xpAmount: number,
  settledAtMs: number,
): Promise<void> {
  const settledSec = Math.floor(settledAtMs / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_ledger (battle_id, winner_id, loser_id, xp_amount, outcome, settled_at)
     VALUES (?, ?, ?, ?, 'decisive', ?)`,
  )
    .bind(battleId, winnerId, loserId, xpAmount, settledSec)
    .run();
}

describe("GET /api/battle/leaderboard — ledger ingestion (04-17)", () => {
  let VIEWER_COOKIE = "";
  let WINNER_ID = "";
  let LOSER_ID = "";

  beforeAll(async () => {
    await setupD1();
    // Viewer is a separate authed user — leaderboard is authenticated.
    const viewer = await createTestSession("ledger-viewer@test.example");
    VIEWER_COOKIE = viewer.cookie;

    WINNER_ID = `u-winner-${crypto.randomUUID()}`;
    LOSER_ID = `u-loser-${crypto.randomUUID()}`;
    await seedUser(WINNER_ID, "Winner Person", `${WINNER_ID}@test.example`);
    await seedUser(LOSER_ID, "Loser Person", `${LOSER_ID}@test.example`);
  });

  it("directly-inserted ledger row appears in week leaderboard with correct net XP + win/loss counts", async () => {
    const battleId = await seedBattleCompleted(WINNER_ID, LOSER_ID, WINNER_ID);
    // Settled within the current week.
    await insertLedgerRow(battleId, WINNER_ID, LOSER_ID, 75, Date.now());

    const app = buildApp();
    const res = await app.request(
      "/api/battle/leaderboard?window=week",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      window: "week" | "all";
      entries: Array<{
        rank: number;
        userId: string;
        name: string;
        netXp: number;
        wins: number;
        losses: number;
      }>;
    };

    expect(body.window).toBe("week");
    const winnerEntry = body.entries.find((e) => e.userId === WINNER_ID);
    const loserEntry = body.entries.find((e) => e.userId === LOSER_ID);

    expect(winnerEntry).toBeTruthy();
    expect(winnerEntry!.netXp).toBeGreaterThanOrEqual(75);
    expect(winnerEntry!.wins).toBeGreaterThanOrEqual(1);

    expect(loserEntry).toBeTruthy();
    expect(loserEntry!.netXp).toBeLessThanOrEqual(-75);
    expect(loserEntry!.losses).toBeGreaterThanOrEqual(1);
  });

  it("all-time window includes rows older than the current week", async () => {
    const oldWinnerId = `u-old-winner-${crypto.randomUUID()}`;
    const oldLoserId = `u-old-loser-${crypto.randomUUID()}`;
    await seedUser(oldWinnerId, "Old Winner", `${oldWinnerId}@test.example`);
    await seedUser(oldLoserId, "Old Loser", `${oldLoserId}@test.example`);
    const battleId = await seedBattleCompleted(oldWinnerId, oldLoserId, oldWinnerId);

    // Settled 60 days ago — outside the week window.
    const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
    await insertLedgerRow(battleId, oldWinnerId, oldLoserId, 40, sixtyDaysAgo);

    const app = buildApp();

    // All-time leaderboard MUST include this row.
    const resAll = await app.request(
      "/api/battle/leaderboard?window=all",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(resAll.status).toBe(200);
    const bodyAll = (await resAll.json()) as {
      entries: Array<{ userId: string; netXp: number }>;
    };
    const oldWinnerInAll = bodyAll.entries.find((e) => e.userId === oldWinnerId);
    expect(oldWinnerInAll).toBeTruthy();
    expect(oldWinnerInAll!.netXp).toBeGreaterThanOrEqual(40);

    // Week leaderboard must NOT include the 60-day-old row.
    const resWeek = await app.request(
      "/api/battle/leaderboard?window=week",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    const bodyWeek = (await resWeek.json()) as {
      entries: Array<{ userId: string }>;
    };
    const oldWinnerInWeek = bodyWeek.entries.find((e) => e.userId === oldWinnerId);
    expect(oldWinnerInWeek).toBeUndefined();
  });
});
