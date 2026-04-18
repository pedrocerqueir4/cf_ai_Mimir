import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import type {
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-16 (SEC-05 / T-04-04): the property invariant for atomic
// XP transfer. Across N independent battles run concurrently, the TOTAL XP
// across all users must be preserved — battles only move XP, never create
// or destroy it (modulo the documented negative-XP edge case, which is still
// counted in the sum).

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

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seedUser(userId: string, xp: number) {
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

async function seedBattle(
  battleId: string,
  hostId: string,
  guestId: string,
  hostWagerAmount: number,
  guestWagerAmount: number,
) {
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

async function initDOBattle(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
  hostId: string,
  guestId: string,
) {
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

describe("BattleRoom XP invariant (04-16 / SEC-05 / property test)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("concurrent battles preserve total XP across all users (N=30 battles)", async () => {
    const tag = crypto.randomUUID();
    const userCount = 20;
    const battleCount = 30;
    const startingXp = 1000;

    // Seed 20 users with 1000 XP each → total = 20000.
    const userIds: string[] = [];
    for (let i = 0; i < userCount; i++) {
      const uid = `inv-user-${tag}-${i}`;
      userIds.push(uid);
      await seedUser(uid, startingXp);
    }

    const expectedTotal = userCount * startingXp;

    // Verify baseline
    const baseline = await env.DB.prepare(
      `SELECT COALESCE(SUM(xp), 0) AS total FROM user_stats WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    )
      .bind(...userIds)
      .first<{ total: number }>();
    expect(baseline?.total).toBe(expectedTotal);

    // Generate N battle configs: random pairs + random stakes.
    interface BattleCfg {
      battleId: string;
      hostId: string;
      guestId: string;
      hostWager: number;
      guestWager: number;
      winnerHost: boolean;
    }
    const cfgs: BattleCfg[] = [];
    for (let i = 0; i < battleCount; i++) {
      let hi = rand(0, userCount - 1);
      let gi = rand(0, userCount - 1);
      while (gi === hi) gi = rand(0, userCount - 1);
      cfgs.push({
        battleId: `b-inv-${tag}-${i}`,
        hostId: userIds[hi],
        guestId: userIds[gi],
        hostWager: rand(10, 200),
        guestWager: rand(10, 200),
        winnerHost: Math.random() < 0.5,
      });
    }

    // Seed battles rows + init DOs serially so the row exists before DO call.
    for (const c of cfgs) {
      await seedBattle(
        c.battleId,
        c.hostId,
        c.guestId,
        c.hostWager,
        c.guestWager,
      );
      const id = env.BATTLE_ROOM.idFromName(c.battleId);
      const stub = env.BATTLE_ROOM.get(id);
      await initDOBattle(stub, c.battleId, c.hostId, c.guestId);
    }

    // Fire all endBattle ops in parallel — stresses the atomic batch
    // boundary. Each DO is an independent instance (different battleIds),
    // so there's no cross-DO serialization beyond what D1 provides.
    await Promise.all(
      cfgs.map(async (c) => {
        const id = env.BATTLE_ROOM.idFromName(c.battleId);
        const stub = env.BATTLE_ROOM.get(id);
        const winnerId = c.winnerHost ? c.hostId : c.guestId;
        return await stub.fetch("https://do/op", {
          method: "POST",
          headers: { "X-Battle-Op": "__testEndBattle" },
          body: JSON.stringify({
            winnerId,
            outcome: "decisive",
            hostScore: c.winnerHost ? 500 : 100,
            guestScore: c.winnerHost ? 100 : 500,
          }),
        });
      }),
    );

    // INVARIANT: sum of XP across all users unchanged.
    const after = await env.DB.prepare(
      `SELECT COALESCE(SUM(xp), 0) AS total FROM user_stats WHERE user_id IN (${userIds.map(() => "?").join(",")})`,
    )
      .bind(...userIds)
      .first<{ total: number }>();
    expect(after?.total).toBe(expectedTotal);

    // All N ledger rows present (no duplicates).
    const ledgerCount = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM battle_ledger WHERE battle_id IN (${cfgs.map(() => "?").join(",")})`,
    )
      .bind(...cfgs.map((c) => c.battleId))
      .first<{ c: number }>();
    expect(ledgerCount?.c).toBe(battleCount);
  });
});
