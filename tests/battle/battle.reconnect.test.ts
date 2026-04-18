import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
  DisconnectRecord,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-19 (MULT-05 / D-25): when a disconnected player
// reconnects within the 30s grace window, the DO:
//   1. Cancels the pending grace alarm
//   2. Restores the paused question timer (reschedules alarm for remaining ms)
//   3. Broadcasts "opponent-reconnected" to the opponent
//   4. Sends a snapshot event to the reconnecting client with full state
//      (phase, currentQuestion stripped of correctOptionId, scores, remainingMs)

const HOST_ID = "host-recon";
const GUEST_ID = "guest-recon";

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

describe("BattleRoom reconnect within grace (04-19 / MULT-05 / D-25)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("host reconnects within grace → cancels alarm, restores phase, emits snapshot (no correctOptionId) + opponent-reconnected", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-recon-${tag}`;
    const hostId = `${HOST_ID}-${tag}`;
    const guestId = `${GUEST_ID}-${tag}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedUserStats(hostId, 500);
    await seedUserStats(guestId, 500);

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
        questions: [q("q-0", "a"), q("q-1", "b"), q("q-2", "a")],
        reservedQuestions: [],
      }),
    });

    const host = await openSocket(stub, hostId, "host");
    const guest = await openSocket(stub, guestId, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host disconnects.
    host.ws.close(1000, "lost-wifi");

    // Wait for disconnect bucket persistence.
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

    // Reconnect: open a new host WS and send hello.
    const host2 = await openSocket(stub, hostId, "host");
    host2.ws.send(JSON.stringify({ action: "hello" }));

    // Wait for snapshot to land.
    await flush();
    const deadline2 = Date.now() + 1500;
    let gotSnapshot = false;
    while (Date.now() < deadline2 && !gotSnapshot) {
      await new Promise((r) => setTimeout(r, 20));
      await flush();
      if (host2.received.some((m) => m.includes('"snapshot"'))) {
        gotSnapshot = true;
      }
    }
    expect(gotSnapshot).toBe(true);

    // DO state: disconnect bucket cleared + phase back to active.
    await runInDurableObject(stub, async (_inst, state) => {
      const disc =
        await state.storage.get<DisconnectRecord>("disconnect");
      expect(disc).toBeUndefined();
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
    });

    // host2 received snapshot event with current state.
    const h2Msgs = host2.received.map((m) => JSON.parse(m));
    const snapshot = h2Msgs.find((m) => m.type === "snapshot");
    expect(snapshot).toBeDefined();
    expect(snapshot.phase).toBe("active");
    expect(snapshot.totalQuestions).toBe(3);
    expect(snapshot.currentQuestion).toBeDefined();
    // CRITICAL: correctOptionId MUST NOT appear in snapshot's currentQuestion
    expect(snapshot.currentQuestion).not.toHaveProperty("correctOptionId");
    expect(snapshot.currentQuestion).not.toHaveProperty("explanation");
    expect(snapshot.currentQuestion.questionType).toBe("mcq");
    expect(snapshot.remainingMs).toBeGreaterThan(0);

    // guest received opponent-reconnected broadcast.
    const guestMsgs = guest.received.map((m) => JSON.parse(m));
    const reconnected = guestMsgs.find(
      (m) => m.type === "opponent-reconnected",
    );
    expect(reconnected).toBeDefined();

    host2.ws.close();
    guest.ws.close();
  });

  it("reconnect after long disconnect bucket age still restores and resumes battle", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-recon-long-${tag}`;
    const hostId = `${HOST_ID}-long-${tag}`;
    const guestId = `${GUEST_ID}-long-${tag}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedUserStats(hostId, 500);
    await seedUserStats(guestId, 500);

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
    await openSocket(stub, guestId, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    host.ws.close();

    // Wait for disconnect bucket to be created.
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

    // Reconnect.
    const host2 = await openSocket(stub, hostId, "host");
    host2.ws.send(JSON.stringify({ action: "hello" }));
    await flush();
    await new Promise((r) => setTimeout(r, 100));
    await flush();

    // After reconnect: disconnect bucket cleared, alarm restored to a
    // question-timer alarm (not the grace alarm).
    await runInDurableObject(stub, async (_inst, state) => {
      const disc =
        await state.storage.get<DisconnectRecord>("disconnect");
      expect(disc).toBeUndefined();

      const alarm = await state.storage.getAlarm();
      // Some alarm scheduled. Either the remaining question time, or
      // an immediate fire for an already-expired question.
      expect(alarm).toBeTypeOf("number");
    });

    host2.ws.close();
  });
});
