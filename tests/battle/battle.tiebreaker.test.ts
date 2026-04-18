import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleConfig,
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-11 (MULT-03 / D-15): a tie at the end of the regular round
// enters a sudden-death tiebreaker. First correct wins; if both correct the
// higher points wins; if both wrong (or both-correct with equal points) the
// DO pulls the next reserved question.

const HOST_ID = "host-tiebreak";
const GUEST_ID = "guest-tiebreak";

function q(id: string, correctOptionId: string, text = "?"): BattleQuizQuestion {
  return {
    id,
    questionText: text,
    questionType: "mcq",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    correctOptionId,
    explanation: "",
  };
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
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

async function settle(ms = 60) {
  await flush();
  await new Promise((r) => setTimeout(r, ms));
  await flush();
}

async function seedTiedAtEndOfRegular(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
  reserved: BattleQuizQuestion[],
) {
  // initLobby + attachGuest + setQuestions (with just 1 regular question)
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
      questions: [q("q-reg-0", "a", "regular")],
      reservedQuestions: reserved,
    }),
  });
}

describe("BattleRoom tiebreaker (04-11 / MULT-03 / D-15)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("tie at end → enters tiebreak phase and broadcasts the first reserved question", async () => {
    const battleId = `b-tb-enter-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const reserved = [q("q-tb-0", "b", "TB0"), q("q-tb-1", "a", "TB1")];
    await seedTiedAtEndOfRegular(stub, battleId, reserved);

    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer WRONG on the only regular question → both 0 → TIE.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("tiebreak");
      expect(rt.tiebreakerRound).toBe(1);
    });

    // Both sockets saw the tiebreak question broadcast (reserved[0] "TB0").
    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const guestMsgs = guest.received.map((m) => JSON.parse(m));
    const tbQ = hostMsgs.find(
      (m) => m.type === "question" && m.questionText === "TB0",
    );
    expect(tbQ).toBeDefined();
    expect(tbQ.questionIndex).toBe(1); // idx 0 = regular; idx 1 = first tiebreak
    expect(tbQ).not.toHaveProperty("correctOptionId");
    const tbQGuest = guestMsgs.find(
      (m) => m.type === "question" && m.questionText === "TB0",
    );
    expect(tbQGuest).toBeDefined();

    host.ws.close();
    guest.ws.close();
  });

  it("first correct in tiebreak decides — host correct, guest wrong → host wins decisive", async () => {
    const battleId = `b-tb-decide-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const reserved = [q("q-tb-0", "b", "TB0")];
    await seedTiedAtEndOfRegular(stub, battleId, reserved);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both 0 on Q0 → enter tiebreak at Q1.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Tiebreak round 1: host correct (b), guest wrong (a).
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("ended");
    });

    // End event broadcast with winnerId === host and outcome decisive.
    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const endEvent = hostMsgs.find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.winnerId).toBe(HOST_ID);
    expect(endEvent.outcome).toBe("decisive");

    host.ws.close();
    guest.ws.close();
  });

  it("both wrong on first tiebreak question → pulls second reserved question", async () => {
    const battleId = `b-tb-retry-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const reserved = [q("q-tb-0", "b", "TB0"), q("q-tb-1", "a", "TB1")];
    await seedTiedAtEndOfRegular(stub, battleId, reserved);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Regular Q0 tie (both 0).
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Tiebreak round 1 TB0 (correct is "b"): BOTH answer "a" (wrong) → advance.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // DO should now be on tiebreak round 2 at TB1.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("tiebreak");
      expect(rt.tiebreakerRound).toBe(2);
    });

    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const tb1 = hostMsgs.find(
      (m) => m.type === "question" && m.questionText === "TB1",
    );
    expect(tb1).toBeDefined();

    host.ws.close();
    guest.ws.close();
  });

  it("both correct in tiebreak — higher points wins", async () => {
    const battleId = `b-tb-points-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const reserved = [q("q-tb-0", "b", "TB0")];
    await seedTiedAtEndOfRegular(stub, battleId, reserved);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Regular Q0 tie.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Tiebreak round — host answers first (faster → more points), guest answers
    // after a micro delay with the same correct option (slower → fewer points).
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    await new Promise((r) => setTimeout(r, 50));
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const endEvent = hostMsgs.find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    // Host answered first → higher points → wins.
    expect(endEvent.winnerId).toBe(HOST_ID);

    host.ws.close();
    guest.ws.close();
  });

  it("tiebreak alarm timeout advances like active phase (both nulls → next reserve)", async () => {
    const battleId = `b-tb-alarm-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const reserved = [q("q-tb-0", "b", "TB0"), q("q-tb-1", "a", "TB1")];
    await seedTiedAtEndOfRegular(stub, battleId, reserved);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Tie in regular round.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // In tiebreak round 1, fire the alarm directly (nobody answers in time).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Both are filled as null for tiebreak round 1 → advance to round 2.
      expect(rt.phase).toBe("tiebreak");
      expect(rt.tiebreakerRound).toBe(2);
    });

    host.ws.close();
    guest.ws.close();
  });
});
