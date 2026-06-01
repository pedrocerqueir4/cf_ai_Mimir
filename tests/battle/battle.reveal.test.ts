import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type {
  BattleRuntime,
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";
import { REVEAL_DURATION_MS } from "../../worker/src/durable-objects/BattleRoom";

// Tests for the reveal phase + request_next early-advance feature.
// Design: after both players answer (or the 15s alarm fires), the DO enters
// a "reveal" phase that lasts REVEAL_DURATION_MS (3s). During this window
// both players may send request_next to skip the remaining time. If only one
// sends it the 3s alarm still controls the advance.

const HOST_ID = "host-reveal";
const GUEST_ID = "guest-reveal";

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
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function settle(ms = 80) {
  await flush();
  await new Promise((r) => setTimeout(r, ms));
  await flush();
}

async function seed(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
  questions: BattleQuizQuestion[],
  reservedQuestions: BattleQuizQuestion[] = [],
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
    body: JSON.stringify({ questions, reservedQuestions }),
  });
}

describe("BattleRoom reveal phase", () => {
  beforeAll(async () => {
    await setupD1();
  });

  // ── Test 1: both answer → reveal phase (not direct next) ─────────────────

  it("both players answering transitions phase to 'reveal', not directly to next question", async () => {
    const battleId = `b-reveal-phase-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer Q0.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Phase must be "reveal", NOT "active" with index 1.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
      // Question index stays at 0 during reveal.
      expect(rt.currentQuestionIndex).toBe(0);
      // Both players are NOT in playersRequestedNext yet.
      expect(rt.playersRequestedNext ?? {}).toEqual({});
    });

    // Reveal event was broadcast to both players.
    const hostReveal = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "reveal");
    expect(hostReveal).toBeDefined();
    expect(hostReveal.correctOptionId).toBe("a");
    expect(hostReveal.yourCorrect).toBe(true);   // host answered "a" (correct)
    expect(hostReveal.opponentCorrect).toBe(false); // guest answered "b" (wrong)
    expect(hostReveal.revealDurationMs).toBe(REVEAL_DURATION_MS);

    // No "question" for Q1 yet — reveal is still active.
    const nextQuestion = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "question" && m.questionIndex === 1);
    expect(nextQuestion).toBeUndefined();

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 2: 3s reveal alarm → next question fires ─────────────────────────

  it("reveal alarm expiry advances to the next question", async () => {
    const battleId = `b-reveal-alarm-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer → enters reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // Confirm we're in reveal before firing the alarm.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
    });

    // Fire the reveal alarm (simulates 3s elapsing).
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    // Phase should now be "active" on Q1.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
      expect(rt.currentQuestionIndex).toBe(1);
    });

    // Q1 question broadcast received.
    const q1msg = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "question" && m.questionIndex === 1);
    expect(q1msg).toBeDefined();
    // correctOptionId must NOT appear in question events.
    expect(q1msg).not.toHaveProperty("correctOptionId");

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 3: both request_next → immediately advances (alarm cancelled) ────

  it("both players sending request_next advances immediately without waiting for alarm", async () => {
    const battleId = `b-reveal-both-next-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer → reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // Both send request_next — second one should trigger advance.
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "request_next" }));
    await settle();

    // Phase should be "active" on Q1 WITHOUT firing the alarm.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
      expect(rt.currentQuestionIndex).toBe(1);
    });

    // Alarm was cancelled — runDurableObjectAlarm should return false
    // (no alarm scheduled, or if there is one it's for Q1's 15s).
    // We just confirm the DO advanced; the alarm that's now set is for Q1.
    const q1msg = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "question" && m.questionIndex === 1);
    expect(q1msg).toBeDefined();

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 4: only one request_next → alarm still controls ─────────────────

  it("only one player sending request_next does NOT advance — alarm still controls", async () => {
    const battleId = `b-reveal-one-next-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer → reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // Only host sends request_next.
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await settle();

    // Still in reveal — guest hasn't confirmed.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
      expect(rt.playersRequestedNext?.[HOST_ID]).toBe(true);
      expect(rt.playersRequestedNext?.[GUEST_ID]).toBeFalsy();
    });

    // Now fire the alarm — alarm takes over.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
      expect(rt.currentQuestionIndex).toBe(1);
    });

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 5: 15s ask-timer expiry enters reveal phase (not next question) ──

  it("15s ask-timer alarm expiry triggers reveal phase, not direct next question", async () => {
    const battleId = `b-reveal-timer-expiry-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Nobody answers — fire the 15s alarm.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    // Phase must be "reveal", NOT directly "active" with index 1.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
      expect(rt.currentQuestionIndex).toBe(0);
      // Both players were filled as no-answer.
      expect(rt.answered[0]?.[HOST_ID]?.optionId).toBeNull();
      expect(rt.answered[0]?.[GUEST_ID]?.optionId).toBeNull();
    });

    // Reveal broadcast should have fired.
    const revealMsg = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "reveal");
    expect(revealMsg).toBeDefined();
    expect(revealMsg.correctOptionId).toBe("a");
    expect(revealMsg.yourCorrect).toBe(false);
    expect(revealMsg.opponentCorrect).toBe(false);

    // Fire the reveal alarm to advance to Q1.
    const ran2 = await runDurableObjectAlarm(stub);
    expect(ran2).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
      expect(rt.currentQuestionIndex).toBe(1);
    });

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 6: idempotent request_next (double-tap is a no-op) ──────────────

  it("duplicate request_next from the same player is a no-op", async () => {
    const battleId = `b-reveal-idempotent-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [
      q("q0", "a", "Q0"),
      q("q1", "b", "Q1"),
    ]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer → reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // Host sends request_next TWICE.
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await flush();
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await settle();

    // Still in reveal — guest hasn't confirmed yet.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
      // Host marked once (idempotent).
      expect(rt.playersRequestedNext?.[HOST_ID]).toBe(true);
    });

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 7: last question → reveal → endBattle / tiebreak entry ───────────

  it("last question reveal alarm → endBattle for decisive winner", async () => {
    const battleId = `b-reveal-lastq-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    // Single question so the last question path fires immediately.
    await seed(stub, battleId, [q("q0", "a", "Q0")], []);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host correct, guest wrong → host should win after reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // In reveal now.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
    });

    // Fire reveal alarm → completeRevealAndAdvance → endBattle.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("ended");
    });

    const endEvent = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.winnerId).toBe(HOST_ID);
    expect(endEvent.outcome).toBe("decisive");

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 8: tiebreak path enters tiebreak-reveal ─────────────────────────

  it("tiebreak round → tiebreak-reveal phase → resolveTiebreakRound after alarm", async () => {
    const battleId = `b-reveal-tiebreak-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    // One regular question (tied), one reserved.
    await seed(
      stub,
      battleId,
      [q("q0", "a", "Q0-regular")],
      [q("q-tb-0", "b", "TB0")],
    );
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Both answer wrong on Q0 → tied at 0.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Should be in "reveal" for the regular round.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("reveal");
    });

    // Fire reveal alarm → completeRevealAndAdvance → enters tiebreak (Q1 = TB0).
    const ran1 = await runDurableObjectAlarm(stub);
    expect(ran1).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("tiebreak");
      expect(rt.tiebreakerRound).toBe(1);
    });

    // Tiebreak Q1: host correct (b), guest wrong (a).
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    // Should be in "tiebreak-reveal".
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("tiebreak-reveal");
    });

    // Fire tiebreak-reveal alarm → resolveTiebreakRound → host wins.
    const ran2 = await runDurableObjectAlarm(stub);
    expect(ran2).toBe(true);
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("ended");
    });

    const endEvent = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "end");
    expect(endEvent).toBeDefined();
    expect(endEvent.winnerId).toBe(HOST_ID);

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 9: request_next ignored outside reveal phase ────────────────────

  it("request_next message during active phase is silently ignored", async () => {
    const battleId = `b-reveal-ignore-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seed(stub, battleId, [q("q0", "a", "Q0"), q("q1", "b", "Q1")]);
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Send request_next during active (before anyone answers) — should no-op.
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await settle();

    // Phase is still active with no advancement.
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");
      expect(rt.currentQuestionIndex).toBe(0);
    });

    host.ws.close();
    guest.ws.close();
  });

  // ── Test 10: both request_next on tiebreak-reveal advances too ───────────

  it("both request_next during tiebreak-reveal advances immediately", async () => {
    const battleId = `b-reveal-tb-next-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    // Tie on regular, two reserved so tiebreak continues.
    await seed(
      stub,
      battleId,
      [q("q0", "a", "Q0-regular")],
      [q("q-tb-0", "b", "TB0"), q("q-tb-1", "a", "TB1")],
    );
    const host = await openSocket(stub, HOST_ID, "host");
    const guest = await openSocket(stub, GUEST_ID, "guest");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Tie on regular Q0.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "b" }));
    await settle();

    // Fire reveal alarm → tiebreak.
    await runDurableObjectAlarm(stub);
    await settle();

    // Tiebreak Q1: both wrong → tiebreak-reveal.
    host.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "answer", optionId: "a" }));
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("tiebreak-reveal");
    });

    // Both request_next → should advance immediately to Q2 (TB1).
    host.ws.send(JSON.stringify({ action: "request_next" }));
    await flush();
    guest.ws.send(JSON.stringify({ action: "request_next" }));
    await settle();

    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      // Should have advanced to next tiebreak round (Q2).
      expect(rt.phase).toBe("tiebreak");
      expect(rt.tiebreakerRound).toBe(2);
    });

    host.ws.close();
    guest.ws.close();
  });
});
