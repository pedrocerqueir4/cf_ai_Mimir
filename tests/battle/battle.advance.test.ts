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

// VALIDATION.md 04-06 (MULT-02): question advances when BOTH answer OR 15s alarm fires.
//   Part A: both answer → DO broadcasts reveal (3s window) then NEXT question.
//   Part B: alarm fires with only 0/1 answers → DO fills null answers, enters
//           reveal phase, then advances after the reveal alarm.
//
// NOTE (reveal phase): After both answer OR the ask-timer expires, the DO now
// enters a "reveal" phase that lasts REVEAL_DURATION_MS (3s). Tests that verify
// the next question was received must fire the reveal alarm (or have both players
// send request_next) to complete the transition.

const HOST_ID = "host-advance";
const GUEST_ID = "guest-advance";

function makeQuestions(): BattleQuizQuestion[] {
  return [
    {
      id: "q-0",
      questionText: "Q0",
      questionType: "mcq",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "a",
      explanation: "e0",
    },
    {
      id: "q-1",
      questionText: "Q1",
      questionType: "mcq",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "b",
      explanation: "e1",
    },
  ];
}

async function seedBattleReady(stub: DurableObjectStub<BattleRoom>, battleId: string) {
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
    body: JSON.stringify({ questions: makeQuestions(), reservedQuestions: [] }),
  });
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
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

async function settle(ms = 60) {
  await flush();
  await new Promise((r) => setTimeout(r, ms));
  await flush();
}

describe("BattleRoom advance (04-06 / MULT-02)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("advances to next question when BOTH users answer (via reveal phase)", async () => {
    const battleId = `b-adv-both-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattleReady(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({ wagerAmount: 10 }),
    });
    await flush();

    // Both clients submit answers for Q0 — host correct ("a"), guest wrong ("b").
    // This triggers startReveal → phase = "reveal".
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // At this point we're in "reveal" phase on Q0. Verify Q0 answers are recorded.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.phase).toBe("reveal");
      expect(runtime.currentQuestionIndex).toBe(0);
      // Q0 answered by both users
      expect(runtime.answered[0]?.[HOST_ID]?.correct).toBe(true);
      expect(runtime.answered[0]?.[GUEST_ID]?.correct).toBe(false);
      // Host score > 0 (correct, fast), guest score === 0 (wrong)
      expect(runtime.scores[HOST_ID]).toBeGreaterThan(0);
      expect(runtime.scores[GUEST_ID]).toBe(0);
    });

    // Reveal event broadcast to both clients already.
    const allHostBeforeAlarm = host.received.map((m) => JSON.parse(m));
    const allGuestBeforeAlarm = guest.received.map((m) => JSON.parse(m));
    expect(allHostBeforeAlarm.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();
    expect(allGuestBeforeAlarm.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();
    const revealMsg = allHostBeforeAlarm.find((m) => m.type === "reveal" && m.questionIndex === 0);
    // Reveal event DOES contain correctOptionId (allowed only in reveal path).
    expect(revealMsg.correctOptionId).toBe("a");

    // Q1 has NOT appeared yet — still in reveal.
    expect(allHostBeforeAlarm.find((m) => m.type === "question" && m.questionIndex === 1)).toBeUndefined();

    // Fire the reveal alarm → completeRevealAndAdvance → Q1.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      expect(runtime.phase).toBe("active");
    });

    // Q1 question now received.
    const allHostAfterAlarm = host.received.map((m) => JSON.parse(m));
    const allGuestAfterAlarm = guest.received.map((m) => JSON.parse(m));
    const hostQ1 = allHostAfterAlarm.find((m) => m.type === "question" && m.questionIndex === 1);
    const guestQ1 = allGuestAfterAlarm.find((m) => m.type === "question" && m.questionIndex === 1);
    expect(hostQ1).toBeDefined();
    expect(guestQ1).toBeDefined();

    host.ws.close();
    guest.ws.close();
  });

  it("advances when alarm fires with nobody answering — fills null answers and increments miss count", async () => {
    const battleId = `b-adv-alarm-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattleReady(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Fire the DO's scheduled 15s alarm NOW (no real wait).
    // This enters reveal phase with null-filled answers.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // In reveal phase — Q0 null-fills recorded, miss counts incremented.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.phase).toBe("reveal");
      expect(runtime.currentQuestionIndex).toBe(0);
      // Both users had null answers filled.
      expect(runtime.answered[0]?.[HOST_ID]?.optionId).toBeNull();
      expect(runtime.answered[0]?.[GUEST_ID]?.optionId).toBeNull();
      expect(runtime.answered[0]?.[HOST_ID]?.points).toBe(0);
      expect(runtime.answered[0]?.[GUEST_ID]?.points).toBe(0);
      // consecutiveMiss incremented for both.
      expect(runtime.consecutiveMiss[HOST_ID]).toBe(1);
      expect(runtime.consecutiveMiss[GUEST_ID]).toBe(1);
    });

    // Reveal event for Q0 was broadcast.
    const hostMsgs = host.received.map((m) => JSON.parse(m));
    expect(hostMsgs.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();

    // Q1 not yet broadcast — still in reveal.
    expect(hostMsgs.find((m) => m.type === "question" && m.questionIndex === 1)).toBeUndefined();

    // Fire the reveal alarm to advance to Q1.
    const ran2 = await runDurableObjectAlarm(stub);
    expect(ran2).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      expect(runtime.phase).toBe("active");
    });

    const guestMsgs = guest.received.map((m) => JSON.parse(m));
    expect(guestMsgs.find((m) => m.type === "question" && m.questionIndex === 1)).toBeDefined();

    host.ws.close();
    guest.ws.close();
  });

  it("one user answers + alarm → advances with the non-answerer's consecutiveMiss incremented", async () => {
    const battleId = `b-adv-partial-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattleReady(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host answers correctly; guest is silent.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();

    // Force alarm — DO fills only the guest's null answer, enters reveal.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    // In reveal phase — Q0 data recorded.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.phase).toBe("reveal");
      expect(runtime.currentQuestionIndex).toBe(0);
      // Host's genuine answer is preserved.
      expect(runtime.answered[0]?.[HOST_ID]?.correct).toBe(true);
      expect(runtime.answered[0]?.[HOST_ID]?.optionId).toBe("a");
      // Guest's null was filled.
      expect(runtime.answered[0]?.[GUEST_ID]?.optionId).toBeNull();
      // Host's miss count RESET to 0 (they answered). Guest's miss = 1.
      expect(runtime.consecutiveMiss[HOST_ID]).toBe(0);
      expect(runtime.consecutiveMiss[GUEST_ID]).toBe(1);
    });

    // Fire the reveal alarm to advance to Q1.
    const ran2 = await runDurableObjectAlarm(stub);
    expect(ran2).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      expect(runtime.phase).toBe("active");
    });

    host.ws.close();
    guest.ws.close();
  });
});
