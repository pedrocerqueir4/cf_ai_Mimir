import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import type {
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md / 04-UAT.md gap B (SEC-05 / T-04-04 + MULT-04):
// Atomic XP transfer must work even when participants have no
// pre-existing user_stats row. user_stats is only seeded by lesson
// completion / quiz answer (worker/src/routes/roadmaps.ts:386,490);
// a fresh user who battles first has no row, and a plain UPDATE
// silently no-ops in D1. The fix in 04-16-PLAN converts the two
// UPDATEs in BattleRoom.endBattle to UPSERTs. This test exercises
// the production missing-row path that battle.xp.invariant.test.ts
// masks via INSERT OR REPLACE pre-seeding.

function q(id: string, correctOptionId: string): BattleQuizQuestion {
  return {
    id,
    questionText: id,
    questionType: "mcq",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctOptionId,
    explanation: "",
  };
}

/**
 * Seed a row in `users` ONLY — DELIBERATELY does NOT create a
 * user_stats row. The whole point of this test file is to exercise
 * the missing-row code path that the existing invariant test masks
 * via INSERT OR REPLACE pre-seeding.
 */
async function seedUserOnly(userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(userId, userId, `${userId}@test.example`, now, now)
    .run();
  // NO user_stats insert — that's the missing-row path under test.
}

/** Seed a fully-formed user (users + user_stats with given xp). */
async function seedUserWithStats(userId: string, xp: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(userId, userId, `${userId}@test.example`, now, now)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO user_stats (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, ?)`,
  )
    .bind(userId, xp, now)
    .run();
}

/** Seed a battles row + a roadmap to satisfy FK. Mirrors the helper in battle.xp.invariant.test.ts. */
async function seedBattle(
  battleId: string,
  hostId: string,
  guestId: string,
  hostWagerAmount: number,
  guestWagerAmount: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const roadmapId = `r-${battleId}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, 'test', 'test', 'linear', 'complete', '[]', ?, ?)`,
  )
    .bind(roadmapId, hostId, now, now)
    .run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO battles (id, join_code, host_id, guest_id, host_roadmap_id, question_count, host_wager_amount, guest_wager_amount, wager_amount, status, created_at)
     VALUES (?, ?, ?, ?, ?, 5, ?, ?, ?, 'active', ?)`,
  )
    .bind(
      battleId,
      battleId.slice(-6).toUpperCase(),
      hostId,
      guestId,
      roadmapId,
      hostWagerAmount,
      guestWagerAmount,
      hostWagerAmount + guestWagerAmount,
      now,
    )
    .run();
}

/** Drive the DO into a state where endBattle can fire. */
async function initDOBattle(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
  hostId: string,
  guestId: string,
): Promise<void> {
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "initLobby" },
    body: JSON.stringify({ battleId, hostId, questionCount: 5 }),
  });
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "attachGuest" },
    body: JSON.stringify({ guestId }),
  });
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "setQuestions" },
    body: JSON.stringify({
      questions: [q("q-0", "a")],
      reservedQuestions: [],
    }),
  });
}

/** Mirror the __testEndBattle op invocation pattern from battle.xp.atomic.test.ts. */
async function fireTestEndBattle(
  stub: DurableObjectStub<BattleRoom>,
  winnerId: string | null,
  outcome: "decisive" | "forfeit" | "both-dropped",
  hostScore = 0,
  guestScore = 0,
): Promise<Response> {
  return await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "__testEndBattle" },
    body: JSON.stringify({ winnerId, outcome, hostScore, guestScore }),
  });
}

describe("BattleRoom endBattle UPSERTs user_stats when row missing (04-16 / gap B)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("A: both users missing user_stats — endBattle creates both rows with correct deltas", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-fb-A-${tag}`;
    const hostId = `host-fb-A-${tag}`;
    const guestId = `guest-fb-A-${tag}`;

    await seedUserOnly(hostId);
    await seedUserOnly(guestId);

    // Sanity: confirm user_stats has NO rows for either user pre-battle.
    const preCount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_stats WHERE user_id IN (?, ?)`,
    )
      .bind(hostId, guestId)
      .first<{ n: number }>();
    expect(preCount?.n).toBe(0);

    await seedBattle(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await initDOBattle(stub, battleId, hostId, guestId);

    const res = await fireTestEndBattle(stub, hostId, "decisive", 300, 200);
    expect(res.status).toBe(200);

    const rows = await env.DB.prepare(
      `SELECT user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, updated_at
       FROM user_stats WHERE user_id IN (?, ?) ORDER BY user_id`,
    )
      .bind(guestId, hostId)
      .all<{
        user_id: string;
        xp: number;
        lessons_completed: number;
        questions_correct: number;
        current_streak: number;
        longest_streak: number;
        updated_at: number;
      }>();

    expect(rows.results).toHaveLength(2);

    const hostRow = rows.results.find((r) => r.user_id === hostId);
    const guestRow = rows.results.find((r) => r.user_id === guestId);
    expect(hostRow).toBeDefined();
    expect(guestRow).toBeDefined();

    // Winner: INSERT seeds xp = +xpTransferred = +10
    expect(hostRow!.xp).toBe(10);
    expect(hostRow!.lessons_completed).toBe(0);
    expect(hostRow!.questions_correct).toBe(0);
    expect(hostRow!.current_streak).toBe(0);
    expect(hostRow!.longest_streak).toBe(0);
    expect(hostRow!.updated_at).toBeGreaterThan(0);

    // Loser: INSERT seeds xp = -xpTransferred = -10 (D-19 allows negative XP)
    expect(guestRow!.xp).toBe(-10);
    expect(guestRow!.lessons_completed).toBe(0);
    expect(guestRow!.questions_correct).toBe(0);
    expect(guestRow!.current_streak).toBe(0);
    expect(guestRow!.longest_streak).toBe(0);
    expect(guestRow!.updated_at).toBeGreaterThan(0);

    // Ledger row was inserted in the SAME batch (atomic with UPSERTs).
    const ledger = await env.DB.prepare(
      `SELECT winner_id, loser_id, xp_amount, outcome FROM battle_ledger WHERE battle_id = ?`,
    )
      .bind(battleId)
      .first<{
        winner_id: string;
        loser_id: string;
        xp_amount: number;
        outcome: string;
      }>();
    expect(ledger?.winner_id).toBe(hostId);
    expect(ledger?.loser_id).toBe(guestId);
    expect(ledger?.xp_amount).toBe(10);
    expect(ledger?.outcome).toBe("decisive");
  });

  it("B: only loser missing — winner pre-seeded — winner UPDATE branch + loser INSERT branch", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-fb-B-${tag}`;
    const hostId = `host-fb-B-${tag}`;
    const guestId = `guest-fb-B-${tag}`;

    await seedUserWithStats(hostId, 100);
    await seedUserOnly(guestId);

    await seedBattle(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await initDOBattle(stub, battleId, hostId, guestId);

    const res = await fireTestEndBattle(stub, hostId, "decisive", 300, 200);
    expect(res.status).toBe(200);

    const hostRow = await env.DB.prepare(
      `SELECT xp FROM user_stats WHERE user_id = ?`,
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestRow = await env.DB.prepare(
      `SELECT xp FROM user_stats WHERE user_id = ?`,
    )
      .bind(guestId)
      .first<{ xp: number }>();

    expect(hostRow?.xp).toBe(110); // 100 + 10 (UPSERT DO UPDATE branch)
    expect(guestRow?.xp).toBe(-10); // 0 - 10 (UPSERT INSERT branch with negative seed)
  });

  it("C: only winner missing — loser pre-seeded — winner INSERT branch + loser UPDATE branch", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-fb-C-${tag}`;
    const hostId = `host-fb-C-${tag}`;
    const guestId = `guest-fb-C-${tag}`;

    await seedUserOnly(hostId);
    await seedUserWithStats(guestId, 50);

    await seedBattle(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await initDOBattle(stub, battleId, hostId, guestId);

    const res = await fireTestEndBattle(stub, hostId, "decisive", 300, 200);
    expect(res.status).toBe(200);

    const hostRow = await env.DB.prepare(
      `SELECT xp FROM user_stats WHERE user_id = ?`,
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestRow = await env.DB.prepare(
      `SELECT xp FROM user_stats WHERE user_id = ?`,
    )
      .bind(guestId)
      .first<{ xp: number }>();

    expect(hostRow?.xp).toBe(10); // 0 + 10 (UPSERT INSERT branch)
    expect(guestRow?.xp).toBe(40); // 50 - 10 (UPSERT DO UPDATE branch)
  });

  it("D: sum invariant — total XP across all participants is conserved across all three cases", async () => {
    // Run all three scenarios in fresh ID-spaces, then assert that the
    // sum of XP across the 6 participants equals the initial seeded
    // total (0 + 0 + 100 + 0 + 0 + 50 = 150). Each battle MOVES 10 XP
    // between two participants — net delta zero — so the post-battle
    // total must equal the pre-battle total.
    const ids = {
      A: {
        battleId: `b-fb-D-A-${crypto.randomUUID()}`,
        hostId: `h-fb-D-A-${crypto.randomUUID()}`,
        guestId: `g-fb-D-A-${crypto.randomUUID()}`,
      },
      B: {
        battleId: `b-fb-D-B-${crypto.randomUUID()}`,
        hostId: `h-fb-D-B-${crypto.randomUUID()}`,
        guestId: `g-fb-D-B-${crypto.randomUUID()}`,
      },
      C: {
        battleId: `b-fb-D-C-${crypto.randomUUID()}`,
        hostId: `h-fb-D-C-${crypto.randomUUID()}`,
        guestId: `g-fb-D-C-${crypto.randomUUID()}`,
      },
    };

    // Mirror Test A/B/C seeding patterns:
    //   A: both missing user_stats (initial XP contribution = 0 + 0 = 0)
    //   B: host has 100, guest missing       (= 100 + 0 = 100)
    //   C: host missing, guest has 50         (= 0 + 50 = 50)
    await seedUserOnly(ids.A.hostId);
    await seedUserOnly(ids.A.guestId);
    await seedUserWithStats(ids.B.hostId, 100);
    await seedUserOnly(ids.B.guestId);
    await seedUserOnly(ids.C.hostId);
    await seedUserWithStats(ids.C.guestId, 50);

    const initialTotal = 0 + 0 + 100 + 0 + 0 + 50; // = 150

    for (const scenario of [ids.A, ids.B, ids.C]) {
      await seedBattle(
        scenario.battleId,
        scenario.hostId,
        scenario.guestId,
        10,
        10,
      );
      const stub = env.BATTLE_ROOM.get(
        env.BATTLE_ROOM.idFromName(scenario.battleId),
      );
      await initDOBattle(
        stub,
        scenario.battleId,
        scenario.hostId,
        scenario.guestId,
      );
      const res = await fireTestEndBattle(
        stub,
        scenario.hostId,
        "decisive",
        300,
        200,
      );
      expect(res.status).toBe(200);
    }

    const allUserIds = [
      ids.A.hostId,
      ids.A.guestId,
      ids.B.hostId,
      ids.B.guestId,
      ids.C.hostId,
      ids.C.guestId,
    ];
    const placeholders = allUserIds.map(() => "?").join(",");
    const sumRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(xp), 0) AS total FROM user_stats WHERE user_id IN (${placeholders})`,
    )
      .bind(...allUserIds)
      .first<{ total: number }>();

    expect(sumRow?.total).toBe(initialTotal);

    // Sanity: all 6 user_stats rows now exist (the missing ones were
    // created by the UPSERT INSERT branch).
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM user_stats WHERE user_id IN (${placeholders})`,
    )
      .bind(...allUserIds)
      .first<{ n: number }>();
    expect(countRow?.n).toBe(6);
  });
});
