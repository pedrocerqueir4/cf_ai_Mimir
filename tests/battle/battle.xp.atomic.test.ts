import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import type {
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-15 (SEC-05 / T-04-04 / D-20): battle end triggers an
// atomic env.DB.batch() that transfers XP from loser to winner AND inserts
// a battle_ledger row — all-or-nothing. Also covers 04-17 (ledger row
// inserted on every transfer) as a sibling assertion. Ledger PK is
// battle_id, so a retried endBattle is a no-op (T-04-FORFEIT-DOUBLE).

const HOST_ID_BASE = "host-xp";
const GUEST_ID_BASE = "guest-xp";

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

async function seedUserStats(userId: string, xp: number) {
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

async function seedBattleRow(
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

async function setupDOBattle(
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

async function fireTestEndBattle(
  stub: DurableObjectStub<BattleRoom>,
  winnerId: string | null,
  outcome: "decisive" | "forfeit" | "both-dropped",
  hostScore = 0,
  guestScore = 0,
) {
  return await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "__testEndBattle" },
    body: JSON.stringify({ winnerId, outcome, hostScore, guestScore }),
  });
}

describe("BattleRoom atomic XP transfer (04-15 / SEC-05 / T-04-04)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("decisive outcome: host wins — loser XP decrements, winner XP increments, ledger row written in same batch", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-dec-${tag}`;
    const guestId = `${GUEST_ID_BASE}-dec-${tag}`;
    const battleId = `b-xp-dec-${tag}`;

    await seedUserStats(hostId, 100);
    await seedUserStats(guestId, 50);
    await seedBattleRow(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    const res = await fireTestEndBattle(stub, hostId, "decisive", 300, 200);
    expect(res.status).toBe(200);

    // Verify user_stats updated
    const hostRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();

    expect(hostRow?.xp).toBe(110);
    expect(guestRow?.xp).toBe(40);

    // Ledger row
    const ledgerRow = await env.DB.prepare(
      "SELECT winner_id, loser_id, xp_amount, outcome FROM battle_ledger WHERE battle_id = ?",
    )
      .bind(battleId)
      .first<{
        winner_id: string;
        loser_id: string;
        xp_amount: number;
        outcome: string;
      }>();
    expect(ledgerRow).toBeDefined();
    expect(ledgerRow?.winner_id).toBe(hostId);
    expect(ledgerRow?.loser_id).toBe(guestId);
    expect(ledgerRow?.xp_amount).toBe(10);
    expect(ledgerRow?.outcome).toBe("decisive");

    // Battles row updated
    const battleRow = await env.DB.prepare(
      "SELECT status, winner_id, host_final_score, guest_final_score FROM battles WHERE id = ?",
    )
      .bind(battleId)
      .first<{
        status: string;
        winner_id: string;
        host_final_score: number;
        guest_final_score: number;
      }>();
    expect(battleRow?.status).toBe("completed");
    expect(battleRow?.winner_id).toBe(hostId);
    expect(battleRow?.host_final_score).toBe(300);
    expect(battleRow?.guest_final_score).toBe(200);
  });

  it("idempotency: a second endBattle invocation is a no-op — XP only changes once", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-idem-${tag}`;
    const guestId = `${GUEST_ID_BASE}-idem-${tag}`;
    const battleId = `b-xp-idem-${tag}`;

    await seedUserStats(hostId, 200);
    await seedUserStats(guestId, 200);
    await seedBattleRow(battleId, hostId, guestId, 20, 20);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    // First settlement — host wins
    await fireTestEndBattle(stub, hostId, "decisive", 400, 100);

    const hostAfter1 = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    expect(hostAfter1?.xp).toBe(220);

    // Second settlement — same battle, same winner. Should be a no-op:
    // endBattle sees existing ledger row and skips the batch. Runtime
    // endBroadcasted guard ALSO short-circuits (belt-and-braces).
    await fireTestEndBattle(stub, hostId, "decisive", 400, 100);

    const hostAfter2 = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestAfter2 = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();
    // XP unchanged from first settlement
    expect(hostAfter2?.xp).toBe(220);
    expect(guestAfter2?.xp).toBe(180);

    // Exactly ONE ledger row
    const ledgerCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM battle_ledger WHERE battle_id = ?",
    )
      .bind(battleId)
      .first<{ c: number }>();
    expect(ledgerCount?.c).toBe(1);
  });

  it("forfeit outcome: non-forfeiting player receives opponent's stake; ledger outcome=forfeit", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-ff-${tag}`;
    const guestId = `${GUEST_ID_BASE}-ff-${tag}`;
    const battleId = `b-xp-ff-${tag}`;

    await seedUserStats(hostId, 500);
    await seedUserStats(guestId, 500);
    await seedBattleRow(battleId, hostId, guestId, 50, 50);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    // Host forfeits (guest wins). Winner is guest.
    await fireTestEndBattle(stub, guestId, "forfeit", 0, 100);

    const hostRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();
    expect(hostRow?.xp).toBe(450);
    expect(guestRow?.xp).toBe(550);

    const ledgerRow = await env.DB.prepare(
      "SELECT outcome, winner_id, xp_amount FROM battle_ledger WHERE battle_id = ?",
    )
      .bind(battleId)
      .first<{ outcome: string; winner_id: string; xp_amount: number }>();
    expect(ledgerRow?.outcome).toBe("forfeit");
    expect(ledgerRow?.winner_id).toBe(guestId);
    expect(ledgerRow?.xp_amount).toBe(50);

    const battleRow = await env.DB.prepare(
      "SELECT status FROM battles WHERE id = ?",
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(battleRow?.status).toBe("forfeited");
  });

  it("both-dropped outcome: no XP movement but ledger row written with xp_amount=0", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-bd-${tag}`;
    const guestId = `${GUEST_ID_BASE}-bd-${tag}`;
    const battleId = `b-xp-bd-${tag}`;

    await seedUserStats(hostId, 300);
    await seedUserStats(guestId, 300);
    await seedBattleRow(battleId, hostId, guestId, 30, 30);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    await fireTestEndBattle(stub, null, "both-dropped", 0, 0);

    // XP completely unchanged — both wagers refunded (no decrements applied).
    const hostRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    const guestRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();
    expect(hostRow?.xp).toBe(300);
    expect(guestRow?.xp).toBe(300);

    const ledgerRow = await env.DB.prepare(
      "SELECT outcome, xp_amount, winner_id, loser_id FROM battle_ledger WHERE battle_id = ?",
    )
      .bind(battleId)
      .first<{
        outcome: string;
        xp_amount: number;
        winner_id: string | null;
        loser_id: string | null;
      }>();
    expect(ledgerRow?.outcome).toBe("both-dropped");
    expect(ledgerRow?.xp_amount).toBe(0);
    expect(ledgerRow?.winner_id).toBeNull();
    expect(ledgerRow?.loser_id).toBeNull();
  });

  it("negative XP allowed (D-19): loser with less XP than wager ends up negative", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-neg-${tag}`;
    const guestId = `${GUEST_ID_BASE}-neg-${tag}`;
    const battleId = `b-xp-neg-${tag}`;

    // Guest has 3 XP; floor-wager is 10 XP (D-19). After loss: -7.
    await seedUserStats(hostId, 1000);
    await seedUserStats(guestId, 3);
    await seedBattleRow(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    await fireTestEndBattle(stub, hostId, "decisive", 500, 0);

    const guestRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();
    expect(guestRow?.xp).toBe(-7);

    const hostRow = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(hostId)
      .first<{ xp: number }>();
    expect(hostRow?.xp).toBe(1010);
  });

  it("level-up detection: winner crossing a threshold reports leveledUp + newLevel in end event", async () => {
    const tag = crypto.randomUUID();
    const hostId = `${HOST_ID_BASE}-lvl-${tag}`;
    const guestId = `${GUEST_ID_BASE}-lvl-${tag}`;
    const battleId = `b-xp-lvl-${tag}`;

    // Phase 3 LEVEL_THRESHOLDS[1] (i.e. floor for level 2) = 100 XP.
    // Seed host at 95. Wager 10. Post-transfer: 105 → level 2.
    await seedUserStats(hostId, 95);
    await seedUserStats(guestId, 500);
    await seedBattleRow(battleId, hostId, guestId, 10, 10);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);
    await setupDOBattle(stub, battleId, hostId, guestId);

    // Open a host socket to capture the end event payload.
    const wsRes = await stub.fetch("https://do/ws", {
      headers: {
        Upgrade: "websocket",
        "X-Battle-User-Id": hostId,
        "X-Battle-Role": "host",
      },
    });
    expect(wsRes.status).toBe(101);
    const ws = wsRes.webSocket!;
    ws.accept();
    const received: string[] = [];
    ws.addEventListener("message", (ev: MessageEvent) => {
      received.push(String(ev.data));
    });

    await fireTestEndBattle(stub, hostId, "decisive", 500, 0);

    // Allow the broadcast to flush.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const msgs = received.map((m) => JSON.parse(m));
    const endEvent = msgs.find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.leveledUp).toBe(true);
    expect(endEvent.newLevel).toBe(2);
    expect(endEvent.xpTransferred).toBe(10);
    expect(endEvent.xpDelta[hostId]).toBe(10);
    expect(endEvent.xpDelta[guestId]).toBe(-10);

    ws.close();
  });
});
