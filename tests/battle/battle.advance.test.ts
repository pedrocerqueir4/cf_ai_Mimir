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
//   Part A: both answer → DO broadcasts the NEXT question (or end event).
//   Part B: alarm fires with only 0/1 answers → DO fills null answers and advances.

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

describe("BattleRoom advance (04-06 / MULT-02)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("advances to next question when BOTH users answer", async () => {
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
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    await flush();

    // DO should have advanced: runtime.currentQuestionIndex === 1, phase still active.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      expect(runtime.phase).toBe("active");
      // Q0 answered by both users
      expect(runtime.answered[0]?.[HOST_ID]?.correct).toBe(true);
      expect(runtime.answered[0]?.[GUEST_ID]?.correct).toBe(false);
      // Host score > 0 (correct, fast), guest score === 0 (wrong)
      expect(runtime.scores[HOST_ID]).toBeGreaterThan(0);
      expect(runtime.scores[GUEST_ID]).toBe(0);
    });

    // Both clients should have seen: question(0), score-update(...), reveal(0), question(1).
    const allHost = host.received.map((m) => JSON.parse(m));
    const allGuest = guest.received.map((m) => JSON.parse(m));
    expect(allHost.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();
    expect(allGuest.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();
    const hostQ1 = allHost.find((m) => m.type === "question" && m.questionIndex === 1);
    const guestQ1 = allGuest.find((m) => m.type === "question" && m.questionIndex === 1);
    expect(hostQ1).toBeDefined();
    expect(guestQ1).toBeDefined();
    // Reveal event DOES contain correctOptionId (allowed only in reveal path).
    const revealMsg = allHost.find((m) => m.type === "reveal" && m.questionIndex === 0);
    expect(revealMsg.correctOptionId).toBe("a");

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
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      // Both users had null answers filled.
      expect(runtime.answered[0]?.[HOST_ID]?.optionId).toBeNull();
      expect(runtime.answered[0]?.[GUEST_ID]?.optionId).toBeNull();
      expect(runtime.answered[0]?.[HOST_ID]?.points).toBe(0);
      expect(runtime.answered[0]?.[GUEST_ID]?.points).toBe(0);
      // consecutiveMiss incremented for both.
      expect(runtime.consecutiveMiss[HOST_ID]).toBe(1);
      expect(runtime.consecutiveMiss[GUEST_ID]).toBe(1);
    });

    // Both sockets saw a reveal for q0 and a new question for q1.
    const hostMsgs = host.received.map((m) => JSON.parse(m));
    const guestMsgs = guest.received.map((m) => JSON.parse(m));
    expect(hostMsgs.find((m) => m.type === "reveal" && m.questionIndex === 0)).toBeDefined();
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

    // Force alarm — DO fills only the guest's null answer and increments their miss count.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(runtime.currentQuestionIndex).toBe(1);
      // Host's genuine answer is preserved.
      expect(runtime.answered[0]?.[HOST_ID]?.correct).toBe(true);
      expect(runtime.answered[0]?.[HOST_ID]?.optionId).toBe("a");
      // Guest's null was filled.
      expect(runtime.answered[0]?.[GUEST_ID]?.optionId).toBeNull();
      // Host's miss count RESET to 0 (they answered). Guest's miss = 1.
      expect(runtime.consecutiveMiss[HOST_ID]).toBe(0);
      expect(runtime.consecutiveMiss[GUEST_ID]).toBe(1);
    });

    host.ws.close();
    guest.ws.close();
  });
});
