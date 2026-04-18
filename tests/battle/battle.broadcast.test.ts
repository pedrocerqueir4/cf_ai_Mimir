import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleConfig,
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-05 (MULT-02): DO broadcasts the same question event to BOTH
// sockets simultaneously. `correctOptionId` MUST NOT appear in a question
// event — only in the subsequent `reveal` event.

const HOST_ID = "host-broadcast";
const GUEST_ID = "guest-broadcast";

function makeQuestions(): BattleQuizQuestion[] {
  return [
    {
      id: "q-A",
      questionText: "Which planet is closest to the sun?",
      questionType: "mcq",
      options: [
        { id: "a", text: "Earth" },
        { id: "b", text: "Mercury" },
        { id: "c", text: "Venus" },
        { id: "d", text: "Mars" },
      ],
      correctOptionId: "b",
      explanation: "Mercury orbits closest to the sun.",
    },
    {
      id: "q-B",
      questionText: "2 + 2?",
      questionType: "mcq",
      options: [
        { id: "a", text: "3" },
        { id: "b", text: "4" },
      ],
      correctOptionId: "b",
      explanation: "basic math",
    },
  ];
}

async function seedBattle(stub: DurableObjectStub<BattleRoom>, battleId: string) {
  // initLobby
  let res = await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "initLobby" },
    body: JSON.stringify({
      battleId,
      hostId: HOST_ID,
      questionCount: 5,
      hostName: "Alice",
    }),
  });
  expect(res.status).toBe(200);

  // attachGuest
  res = await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "attachGuest" },
    body: JSON.stringify({ guestId: GUEST_ID, guestName: "Bob" }),
  });
  expect(res.status).toBe(200);

  // setQuestions
  res = await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "setQuestions" },
    body: JSON.stringify({
      questions: makeQuestions(),
      reservedQuestions: [],
    }),
  });
  expect(res.status).toBe(200);
}

async function openSocket(
  stub: DurableObjectStub<BattleRoom>,
  userId: string,
  role: "host" | "guest",
): Promise<{ ws: WebSocket; received: string[] }> {
  const res = await stub.fetch("https://do/ws", {
    headers: {
      Upgrade: "websocket",
      "X-Battle-User-Id": userId,
      "X-Battle-Role": role,
    },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  if (!ws) throw new Error("no webSocket in upgrade response");
  ws.accept();
  const received: string[] = [];
  ws.addEventListener("message", (ev: MessageEvent) => {
    received.push(String(ev.data));
  });
  return { ws, received };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("BattleRoom broadcast (04-05 / MULT-02)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("broadcasts the same question event to both sockets — without correctOptionId", async () => {
    const battleId = `b-broadcast-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedBattle(stub, battleId);

    const { ws: hostWs, received: hostMsgs } = await openSocket(stub, HOST_ID, "host");
    const { ws: guestWs, received: guestMsgs } = await openSocket(stub, GUEST_ID, "guest");

    // Start battle → DO broadcasts question idx=0 to both sockets.
    const res = await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({ wagerAmount: 50 }),
    });
    expect(res.status).toBe(200);

    // give the broadcast loop a moment to flush
    await flushMicrotasks();
    await flushMicrotasks();

    expect(hostMsgs.length).toBeGreaterThan(0);
    expect(guestMsgs.length).toBeGreaterThan(0);

    const hostQ = JSON.parse(hostMsgs[0]);
    const guestQ = JSON.parse(guestMsgs[0]);

    expect(hostQ.type).toBe("question");
    expect(guestQ.type).toBe("question");
    expect(hostQ.questionIndex).toBe(0);
    expect(guestQ.questionIndex).toBe(0);
    expect(hostQ.questionText).toBe("Which planet is closest to the sun?");
    expect(guestQ.questionText).toBe("Which planet is closest to the sun?");

    // Same options for both sockets.
    expect(hostQ.options).toEqual(guestQ.options);

    // CRITICAL: correctOptionId MUST NOT appear in the question broadcast.
    expect(hostQ).not.toHaveProperty("correctOptionId");
    expect(guestQ).not.toHaveProperty("correctOptionId");
    expect(hostQ).not.toHaveProperty("explanation");
    expect(guestQ).not.toHaveProperty("explanation");

    // Phase transitioned to active and DO tracks the question start.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = (await state.storage.get<BattleRuntime>("runtime"))!;
      const config = (await state.storage.get<BattleConfig>("config"))!;
      expect(runtime.phase).toBe("active");
      expect(runtime.currentQuestionIndex).toBe(0);
      expect(config.questions[0]?.correctOptionId).toBe("b");
    });

    hostWs.close();
    guestWs.close();
  });
});
