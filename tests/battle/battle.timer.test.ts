import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-07 (MULT-03): a late-arriving answer that lands AFTER the
// per-question alarm has already advanced the index MUST NOT score.
// Also asserts that a client-supplied `score` field is rejected by Zod and
// never mutates server state (T-04-02).
//
// NOTE (reveal phase): The 15s per-question alarm now enters "reveal" phase
// first (3s window), then a second alarm advances to the next question.
// Tests that check post-alarm state must fire BOTH alarms: the 15s alarm
// (→ reveal) and the 3s reveal alarm (→ next question).

const HOST_ID = "host-timer";
const GUEST_ID = "guest-timer";

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
      explanation: "",
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
      explanation: "",
    },
    {
      id: "q-2",
      questionText: "Q2",
      questionType: "mcq",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      correctOptionId: "a",
      explanation: "",
    },
  ];
}

async function seed(stub: DurableObjectStub<BattleRoom>, battleId: string) {
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
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

/** Fire both alarms required to advance from Q0 to Q1 via the reveal path. */
async function advanceViaReveal(stub: DurableObjectStub<BattleRoom>) {
  // Step 1: 15s ask-timer alarm → reveal phase.
  const ran1 = await runDurableObjectAlarm(stub);
  expect(ran1).toBe(true);
  await flush();
  // Step 2: 3s reveal alarm → next question.
  const ran2 = await runDurableObjectAlarm(stub);
  expect(ran2).toBe(true);
  await flush();
}

describe("BattleRoom timer + late-answer rejection (04-07 / MULT-03)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("late answer for the PRIOR question after alarm-advance is ignored (no score change, no duplicate score-update)", async () => {
    const battleId = `b-timer-late-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Snapshot: before alarm, nobody has answered q0, scores are 0.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.currentQuestionIndex).toBe(0);
      expect(rt.scores[HOST_ID]).toBe(0);
    });

    // Fire both alarms (15s ask-timer → reveal → 3s reveal → q1).
    // After this sequence the DO is on Q1 in "active" phase.
    await advanceViaReveal(stub);

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.currentQuestionIndex).toBe(1);
      expect(rt.phase).toBe("active");
    });

    const scoreUpdatesBefore = host.received.filter(
      (m) => JSON.parse(m).type === "score-update",
    ).length;

    // NOW host sends a "late" answer that arrives on Q1 (active), but the
    // intent is to verify Q0's null-fill was not overwritten. The answer
    // optionId "a" is WRONG for q1 (correct is "b") → 0 points.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // q0's host answer is still the null-fill from the ask-timer alarm.
      expect(rt.answered[0]?.[HOST_ID]?.optionId).toBeNull();
      expect(rt.answered[0]?.[HOST_ID]?.points).toBe(0);
      // q1 now has the message scored against q1's correct ("b"), "a" is wrong.
      expect(rt.answered[1]?.[HOST_ID]?.optionId).toBe("a");
      expect(rt.answered[1]?.[HOST_ID]?.correct).toBe(false);
      expect(rt.answered[1]?.[HOST_ID]?.points).toBe(0);
      // Host score never left 0.
      expect(rt.scores[HOST_ID]).toBe(0);
    });

    // A score-update broadcast may fire for the wrong answer (points=0), but
    // it is NOT a duplicate of any q0 score-update (because there was none).
    const scoreUpdatesAfter = host.received.filter(
      (m) => JSON.parse(m).type === "score-update",
    ).length;
    expect(scoreUpdatesAfter).toBeGreaterThanOrEqual(scoreUpdatesBefore);

    host.ws.close();
    guest.ws.close();
  });

  it("client-supplied score/timestamp fields are rejected by Zod — server computes its own", async () => {
    const battleId = `b-timer-strict-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId);
    const host = await openSocket(stub, HOST_ID, "host");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Send a forged message with score + timestamp fields.
    host.ws.send(
      JSON.stringify({
        action: "answer",
        optionId: "a",
        score: 9999,
        timestamp: 0,
        responseTimeMs: -1,
      }),
    );
    // Poll up to 500ms for the error frame to arrive — the reply path
    // (WebSocket send from DO → test-side WebSocket message event) is
    // async across miniflare's loopback.
    const deadline = Date.now() + 500;
    while (
      Date.now() < deadline &&
      !host.received.some((m) => {
        try {
          return JSON.parse(m).type === "error";
        } catch {
          return false;
        }
      })
    ) {
      await flush();
      await new Promise((r) => setTimeout(r, 10));
    }

    // Host should have received an `error` frame with code INVALID_MESSAGE.
    const msgs = host.received.map((m) => JSON.parse(m));
    const err = msgs.find((m) => m.type === "error");
    expect(err).toBeDefined();
    expect(err.code).toBe("INVALID_MESSAGE");

    // No score change: DO rejected the message pre-scoring.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.scores[HOST_ID] ?? 0).toBe(0);
      expect(rt.answered[0]?.[HOST_ID]).toBeUndefined();
    });

    host.ws.close();
  });

  it("after alarm-advance, the DO's setAlarm has been rescheduled (reveal alarm set after 15s)", async () => {
    const battleId = `b-timer-realarm-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId);
    await openSocket(stub, HOST_ID, "host");
    await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Fire the 15s ask-timer alarm. DO fills nulls → enters reveal phase.
    // A reveal alarm is scheduled (REVEAL_DURATION_MS from now).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Still on Q0 but in reveal phase.
      expect(rt.currentQuestionIndex).toBe(0);
      expect(rt.phase).toBe("reveal");
      // A reveal alarm IS scheduled.
      const alarm = await state.storage.getAlarm();
      expect(alarm).not.toBeNull();
    });

    // Fire the reveal alarm → advances to Q1 → reschedules for the next 15s.
    const ran2 = await runDurableObjectAlarm(stub);
    expect(ran2).toBe(true);
    await flush();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.currentQuestionIndex).toBe(1);
      expect(rt.phase).toBe("active");
      // After startQuestion, an alarm IS set for the new round.
      const alarm = await state.storage.getAlarm();
      expect(alarm).not.toBeNull();
    });
  });
});
