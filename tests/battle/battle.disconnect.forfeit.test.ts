import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
  DisconnectRecord,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-20 (MULT-05 / T-04-05 / D-25): when a player disconnects
// mid-battle, the DO schedules a 30s grace alarm. If the alarm fires before
// the player reconnects, the disconnected player forfeits and the opponent
// wins the wager. Covers T-04-05 (rage-quit mitigation).

const HOST_ID = "host-disc";
const GUEST_ID = "guest-disc";

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
  stake: number,
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
      stake,
      stake,
      stake * 2,
      now,
    )
    .run();
}

async function openSocket(
  stub: DurableObjectStub<BattleRoom>,
  userId: string,
  role: "host" | "guest",
) {
  const res = await stub.fetch("https://do/ws", {
    headers: {
      Upgrade: "websocket",
      "X-Battle-User-Id": userId,
      "X-Battle-Role": role,
    },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const received: string[] = [];
  ws.addEventListener("message", (ev: MessageEvent) => {
    received.push(String(ev.data));
  });
  return { ws, received };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function seedActiveBattle(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
) {
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "initLobby" },
    body: JSON.stringify({ battleId, hostId: HOST_ID, questionCount: 5 }),
  });
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "attachGuest" },
    body: JSON.stringify({ guestId: GUEST_ID }),
  });
  await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "setQuestions" },
    body: JSON.stringify({
      questions: [q("q-0", "a"), q("q-1", "b"), q("q-2", "a")],
      reservedQuestions: [],
    }),
  });
}

describe("BattleRoom disconnect-grace forfeit (04-20 / D-25 / T-04-05)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("host WS close → 30s grace alarm → alarm fire forfeits host, guest wins", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-disc-${tag}`;
    const hostId = `${HOST_ID}-${tag}`;
    const guestId = `${GUEST_ID}-${tag}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedUserStats(hostId, 500);
    await seedUserStats(guestId, 500);
    await seedBattleRow(battleId, hostId, guestId, 50);

    // initLobby + attachGuest + setQuestions using the real user ids (not the
    // base constants) so the config matches the battles row.
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
        questions: [q("q-0", "a"), q("q-1", "b")],
        reservedQuestions: [],
      }),
    });

    const host = await openSocket(stub, hostId, "host");
    const guest = await openSocket(stub, guestId, "guest");

    // Start the battle so runtime.phase === "active".
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host abruptly closes its socket (not the CLOSE_CODE_MOVED eviction
    // code; default 1000/1001 is fine).
    host.ws.close(1000, "rage-quit");

    // Wait for webSocketClose to persist the disconnect bucket and flip
    // phase. Miniflare dispatches hibernation events asynchronously.
    const deadline = Date.now() + 1500;
    let sawDisconnect = false;
    while (Date.now() < deadline && !sawDisconnect) {
      await new Promise((r) => setTimeout(r, 30));
      await flush();
      await runInDurableObject(stub, async (_inst, state) => {
        const disc =
          await state.storage.get<DisconnectRecord>("disconnect");
        if (disc) sawDisconnect = true;
      });
    }
    expect(sawDisconnect).toBe(true);

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("opponent-reconnecting");
      const disc =
        (await state.storage.get<DisconnectRecord>("disconnect"))!;
      expect(disc.userId).toBe(hostId);
      expect(disc.pausedQuestionRemainingMs).toBeGreaterThan(0);
      expect(disc.preDisconnectPhase).toBe("active");
    });

    // The guest should have seen the opponent-reconnecting broadcast.
    await flush();
    const guestMsgs = guest.received.map((m) => JSON.parse(m));
    const reconnectingEvent = guestMsgs.find(
      (m) => m.type === "opponent-reconnecting",
    );
    expect(reconnectingEvent).toBeDefined();
    expect(reconnectingEvent.graceMs).toBe(30_000);

    // Fire the grace alarm (simulates 30s elapsing).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // Alarm handler sees phase === "opponent-reconnecting" → endBattle(forfeit).
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("forfeited");
      const disc =
        await state.storage.get<DisconnectRecord>("disconnect");
      expect(disc).toBeUndefined();
    });

    // Guest received end event with outcome="forfeit" winner=guestId.
    await flush();
    const guestMsgsAfter = guest.received.map((m) => JSON.parse(m));
    const endEvent = guestMsgsAfter.find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.outcome).toBe("forfeit");
    expect(endEvent.winnerId).toBe(guestId);

    // Ledger row reflects the forfeit.
    const ledgerRow = await env.DB.prepare(
      "SELECT outcome, winner_id, loser_id, xp_amount FROM battle_ledger WHERE battle_id = ?",
    )
      .bind(battleId)
      .first<{
        outcome: string;
        winner_id: string;
        loser_id: string;
        xp_amount: number;
      }>();
    expect(ledgerRow?.outcome).toBe("forfeit");
    expect(ledgerRow?.winner_id).toBe(guestId);
    expect(ledgerRow?.loser_id).toBe(hostId);
    expect(ledgerRow?.xp_amount).toBe(50);

    // XP actually transferred.
    const guestXp = await env.DB.prepare(
      "SELECT xp FROM user_stats WHERE user_id = ?",
    )
      .bind(guestId)
      .first<{ xp: number }>();
    expect(guestXp?.xp).toBe(550);

    guest.ws.close();
  });

  it("socket close with code 4001 (multi-tab eviction) does NOT trigger grace forfeit", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-disc-4001-${tag}`;
    const hostId = `${HOST_ID}-4001-${tag}`;
    const guestId = `${GUEST_ID}-4001-${tag}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedUserStats(hostId, 500);
    await seedUserStats(guestId, 500);
    await seedBattleRow(battleId, hostId, guestId, 50);

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

    const host = await openSocket(stub, hostId, "host");
    await openSocket(stub, guestId, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Open a SECOND host socket — DO's handleWsUpgrade evicts the first
    // with code CLOSE_CODE_MOVED (4001). webSocketClose should NOT trigger
    // the grace alarm path.
    const host2 = await openSocket(stub, hostId, "host");
    await flush();
    await new Promise((r) => setTimeout(r, 100));
    await flush();

    // Disconnect bucket should NOT exist (eviction ≠ forfeit).
    await runInDurableObject(stub, async (_inst, state) => {
      const disc =
        await state.storage.get<DisconnectRecord>("disconnect");
      expect(disc).toBeUndefined();
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Phase should remain active.
      expect(rt.phase).toBe("active");
    });

    host.ws.close();
    host2.ws.close();
  });
});
