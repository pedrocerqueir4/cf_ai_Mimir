import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

// VALIDATION.md 04-31 (MULT-04): leaderboard returns top 50 players ranked
// by net XP won (sum of wins - sum of losses) within the selected window
// (week = rolling Monday-00:00-UTC; all = lifetime). Order DESC by net XP;
// ties broken alphabetically by name.

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

async function seedBattleAndLedger(
  winnerId: string,
  loserId: string,
  xpAmount: number,
  settledAtMs: number,
): Promise<void> {
  const battleId = `b-lb-${crypto.randomUUID()}`;
  const hostRoadmapId = `r-lb-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hostRoadmapId,
      winnerId,
      "lb host rm",
      "lb-topic",
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
    .bind(
      battleId,
      `B${crypto.randomUUID().slice(0, 5)}`.toUpperCase(),
      winnerId,
      loserId,
      hostRoadmapId,
      5,
      winnerId,
      now,
      now,
    )
    .run();

  const settledSec = Math.floor(settledAtMs / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_ledger (battle_id, winner_id, loser_id, xp_amount, outcome, settled_at)
     VALUES (?, ?, ?, ?, 'decisive', ?)`,
  )
    .bind(battleId, winnerId, loserId, xpAmount, settledSec)
    .run();
}

describe("GET /api/battle/leaderboard (04-31 / MULT-04)", () => {
  let VIEWER_COOKIE = "";

  let USER_A = "";
  let USER_B = "";
  let USER_C = "";

  beforeAll(async () => {
    await setupD1();
    const viewer = await createTestSession("lb-viewer@test.example");
    VIEWER_COOKIE = viewer.cookie;

    USER_A = `lb-a-${crypto.randomUUID()}`;
    USER_B = `lb-b-${crypto.randomUUID()}`;
    USER_C = `lb-c-${crypto.randomUUID()}`;
    // Use distinct alpha-sorted names to make tie-break order predictable.
    await seedUser(USER_A, "Alpha Alice", `${USER_A}@test.example`);
    await seedUser(USER_B, "Bravo Bob", `${USER_B}@test.example`);
    await seedUser(USER_C, "Charlie Chris", `${USER_C}@test.example`);

    const now = Date.now();
    const thisWeek = now - 2 * 60 * 60 * 1000; // 2 hours ago
    const longAgo = now - 45 * 24 * 60 * 60 * 1000; // 45 days ago

    // This week:
    //   A beats B for +100 xp → A: +100, B: -100
    //   A beats C for +50 xp  → A: +150, C: -50
    //   C beats B for +30 xp  → B: -130, C: -20
    // Net XP (this week): A=+150, B=-130, C=-20
    await seedBattleAndLedger(USER_A, USER_B, 100, thisWeek);
    await seedBattleAndLedger(USER_A, USER_C, 50, thisWeek);
    await seedBattleAndLedger(USER_C, USER_B, 30, thisWeek);

    // Long-ago (45 days = outside week):
    //   B beats A for +200 xp
    // Only visible in "all" window.
    await seedBattleAndLedger(USER_B, USER_A, 200, longAgo);
  });

  it("window=week excludes rows outside the current Monday-00:00-UTC window, DESC sort by net XP", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/battle/leaderboard?window=week",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      window: string;
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
    const map = new Map(body.entries.map((e) => [e.userId, e]));

    const a = map.get(USER_A);
    const b = map.get(USER_B);
    const c = map.get(USER_C);

    expect(a).toBeTruthy();
    expect(a!.netXp).toBe(150);
    expect(a!.wins).toBe(2);
    expect(a!.losses).toBe(0);

    expect(b).toBeTruthy();
    expect(b!.netXp).toBe(-130);
    expect(b!.wins).toBe(0);
    expect(b!.losses).toBe(2);

    expect(c).toBeTruthy();
    expect(c!.netXp).toBe(-20);
    expect(c!.wins).toBe(1);
    expect(c!.losses).toBe(1);

    // DESC sort by netXp: A (150) > C (-20) > B (-130). Among these 3 only —
    // other seeded rows from other test files may interleave, so we check
    // relative ordering rather than absolute rank.
    const aIdx = body.entries.findIndex((e) => e.userId === USER_A);
    const bIdx = body.entries.findIndex((e) => e.userId === USER_B);
    const cIdx = body.entries.findIndex((e) => e.userId === USER_C);
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(bIdx);

    // Ranks are 1-based and monotonically increasing.
    body.entries.forEach((e, i) => {
      expect(e.rank).toBe(i + 1);
    });
  });

  it("window=all includes the 45-day-old row that was excluded from week", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/battle/leaderboard?window=all",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      window: string;
      entries: Array<{ userId: string; netXp: number; wins: number; losses: number }>;
    };
    expect(body.window).toBe("all");

    const map = new Map(body.entries.map((e) => [e.userId, e]));
    const a = map.get(USER_A);
    const b = map.get(USER_B);

    // All-time A: +100 +50 -200 = -50 (vs +150 in week window).
    expect(a!.netXp).toBe(-50);
    // All-time B: -100 -30 +200 = +70 (vs -130 in week window).
    expect(b!.netXp).toBe(70);
    expect(a!.wins).toBe(2);
    expect(a!.losses).toBe(1);
    expect(b!.wins).toBe(1);
    expect(b!.losses).toBe(2);
  });

  it("rejects invalid window value with 400", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/battle/leaderboard?window=month",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("defaults to window=week when no query param given", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/battle/leaderboard",
      { headers: { Cookie: VIEWER_COOKIE } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { window: string };
    expect(body.window).toBe("week");
  });
});
