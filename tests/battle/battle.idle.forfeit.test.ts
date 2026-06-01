import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-22 (SEC-06 / T-04-06 / D-26): if a user misses 3 consecutive
// questions (no answer within the 15s window), the DO auto-forfeits them;
// the opponent wins the battle. WRONG answers do NOT increment the miss
// counter — only null/missed answers do.
//
// NOTE (reveal phase): The 15s per-question alarm now enters "reveal" phase
// first (3s window), then a second alarm fires completeRevealAndAdvance, which
// is where the forfeit check runs. Each "round" therefore requires TWO alarm
// firings: ask-timer alarm → reveal; reveal alarm → forfeit-check / next round.

const HOST_ID = "host-forfeit";
const GUEST_ID = "guest-forfeit";

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

async function seedBattle(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
  nQuestions = 5,
) {
  const questions: BattleQuizQuestion[] = [];
  for (let i = 0; i < nQuestions; i++) {
    questions.push(q(`q-${i}`, i % 2 === 0 ? "a" : "b"));
  }
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
    body: JSON.stringify({ questions, reservedQuestions: [] }),
  });
}

/**
 * Advance through a full reveal cycle:
 * 1. Fire the 15s ask-timer alarm → enters reveal phase (fills null answers).
 * 2. Fire the 3s reveal alarm → completeRevealAndAdvance (forfeit-check / next Q).
 *
 * Returns true if both alarms ran.
 */
async function advanceFullCycle(stub: DurableObjectStub<BattleRoom>): Promise<void> {
  const ran1 = await runDurableObjectAlarm(stub);
  expect(ran1).toBe(true);
  await flush();
  const ran2 = await runDurableObjectAlarm(stub);
  expect(ran2).toBe(true);
  await flush();
}

describe("BattleRoom idle-forfeit (04-22 / D-26 / T-04-06)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("3 consecutive null answers for a user triggers auto-forfeit; opponent wins", async () => {
    const battleId = `b-forfeit-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattle(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Round 1: guest answers (correct "a"); host is silent. Both alarms fire.
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    // Guest answered so only the ask-timer alarm fires (phase → reveal after guest+host).
    // But host hasn't answered, so we need to fire the ask-timer alarm.
    let ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // After ask-timer: in reveal phase. Miss counts already incremented.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
      expect(rt.consecutiveMiss[HOST_ID]).toBe(1);
      expect(rt.consecutiveMiss[GUEST_ID]).toBe(0);
    });

    // Fire reveal alarm → advances to Q1.
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // Round 2: guest answers (correct "b"); host silent. Both alarms fire.
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.consecutiveMiss[HOST_ID]).toBe(2);
    });

    // Fire reveal alarm → advances to Q2.
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // Round 3: host silent again. Ask-timer alarm → reveal (3 misses detected).
    // Then reveal alarm → completeRevealAndAdvance → forfeit check fires.
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // In reveal phase — miss count is now 3 but forfeit fires in completeRevealAndAdvance.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Still in reveal, forfeit happens on the reveal alarm.
      expect(rt.phase).toBe("reveal");
      expect(rt.consecutiveMiss[HOST_ID]).toBe(3);
    });

    // Fire reveal alarm → forfeit triggered.
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("forfeited");
    });

    // Both sockets saw an end event with outcome "forfeit" and winnerId = guest.
    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const endEvent = hostMsgs.find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.outcome).toBe("forfeit");
    expect(endEvent.winnerId).toBe(GUEST_ID);

    host.ws.close();
    guest.ws.close();
  });

  it("WRONG answers do NOT increment consecutiveMiss — only null/missed do", async () => {
    const battleId = `b-forfeit-wrong-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattle(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host answers WRONG on 3 consecutive rounds (optionId always "b" for
    // even-index questions whose correct is "a"). Guest answers correctly.
    // After 3 rounds, host should NOT be forfeited — wrong ≠ missed.
    for (let round = 0; round < 3; round++) {
      // For even round (q0, q2): correct=a; for odd (q1): correct=b.
      // Host always answers "b" → wrong on q0/q2, correct on q1. But we want
      // to assert the "no increment on wrong" property: force a definitely-wrong
      // answer by inverting.
      const hostAns = round % 2 === 0 ? "b" : "a"; // intentionally wrong
      const guestAns = round % 2 === 0 ? "a" : "b"; // correct

      host.ws.send(JSON.stringify({ action: "answer", optionId: hostAns }));
      await flush();
      guest.ws.send(JSON.stringify({ action: "answer", optionId: guestAns }));
      await flush();
      // Both answered → reveal phase. Fire reveal alarm to advance.
      const ran = await runDurableObjectAlarm(stub);
      expect(ran).toBe(true);
      await flush();
    }

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Host has been answering every round (just wrongly) → miss count = 0.
      expect(rt.consecutiveMiss[HOST_ID]).toBe(0);
      expect(rt.consecutiveMiss[GUEST_ID]).toBe(0);
      // Battle is NOT forfeited — still in active phase (or advanced beyond).
      expect(rt.phase).not.toBe("forfeited");
    });

    host.ws.close();
    guest.ws.close();
  });

  it("any answer (correct or wrong) resets consecutiveMiss back to 0", async () => {
    const battleId = `b-forfeit-reset-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattle(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Round 1: guest answers, host silent. Ask-timer alarm → reveal (HOST miss=1).
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    let ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.consecutiveMiss[HOST_ID]).toBe(1);
    });

    // Fire reveal alarm → advances to Q1.
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // Round 2: host answers WRONG — resets miss counter back to 0.
    // Both answer → reveal phase. Fire reveal alarm.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" })); // wrong for q1 (correct b)
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    // Both answered → reveal alarm scheduled.
    ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Host answered (wrong) → miss reset to 0.
      expect(rt.consecutiveMiss[HOST_ID]).toBe(0);
    });

    host.ws.close();
    guest.ws.close();
  });
});
