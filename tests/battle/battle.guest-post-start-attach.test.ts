import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import type {
  BattleRoom,
  BattleQuizQuestion,
} from "../../worker/src/durable-objects/BattleRoom";

// Regression for debug session `battle-guest-disconnect-start`.
//
// Bug: the pre-battle client route called /api/battle/:id/start on BOTH host
// and guest at countdown-end. /start is host-only, so the guest's POST 403'd
// and its pre-battle page flipped to an error pane. User perceived this as
// "guest loses connection" because the host entered the battle alone while
// the guest was stuck on the error pane.
//
// Fix: only the host POSTs /start. Both navigate to /battle/room/:id; the
// guest's WebSocket attaches AFTER the DO has already transitioned to phase
// 'active' and broadcast Q0. This test locks in the server-side contract the
// client fix depends on:
//
//   When a WebSocket joins AFTER `startBattle` has already fired on the DO,
//   the hello → snapshot path must deliver phase='active' + currentQuestion
//   so the late-joining client (the guest in the post-fix flow) can render
//   the first question without any additional broadcast.
//
// If this test ever regresses, the guest would again be stuck in pre-battle
// on its WebSocket even though the server is already in the 'active' phase.

const HOST_ID = "host-postattach";
const GUEST_ID = "guest-postattach";

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

describe("BattleRoom: guest attaches WS AFTER startBattle (battle-guest-disconnect-start regression)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("late-joining WS (post-startBattle) receives snapshot with phase='active' + currentQuestion on hello", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-postattach-${tag}`;
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

    // CRITICAL: startBattle fires BEFORE either player has attached a WS,
    // matching the post-fix client flow. In the pre-fix code the guest
    // called /start itself, 403'd, and never reached this attachment point.
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({}),
    });
    await flush();

    // Host attaches + hellos. (Mirrors the post-fix flow: host nav's to
    // /battle/room/:id after /start resolves, guest nav's at the same time.)
    const host = await openSocket(stub, hostId, "host");
    host.ws.send(JSON.stringify({ action: "hello" }));

    // Guest attaches + hellos. This is the previously-broken path —
    // before the fix, the guest never got here because its /start 403'd
    // and flipped its pre-battle page to the error pane.
    const guest = await openSocket(stub, guestId, "guest");
    guest.ws.send(JSON.stringify({ action: "hello" }));

    // Wait for both snapshots to arrive.
    await flush();
    const deadline = Date.now() + 1500;
    while (
      Date.now() < deadline &&
      (!host.received.some((m) => m.includes('"snapshot"')) ||
        !guest.received.some((m) => m.includes('"snapshot"')))
    ) {
      await new Promise((r) => setTimeout(r, 20));
      await flush();
    }

    const hostSnap = host.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "snapshot");
    const guestSnap = guest.received
      .map((m) => JSON.parse(m))
      .find((m) => m.type === "snapshot");

    expect(hostSnap).toBeDefined();
    expect(guestSnap).toBeDefined();

    // Both must see phase='active' — the DO transition happened BEFORE
    // either WS existed. If handleHello ever regresses to leaving the guest
    // in 'pre-battle' while the runtime is 'active', the original bug
    // returns in spirit even if the client-side root cause is fixed.
    expect(hostSnap.phase).toBe("active");
    expect(guestSnap.phase).toBe("active");

    // Both must have a currentQuestion so the UI can render Q0 without
    // waiting for a separate `question` broadcast (which, in this flow,
    // already happened before either WS was listening — the `question`
    // broadcast fired into zero connected peers on startBattle).
    expect(hostSnap.currentQuestion).toBeDefined();
    expect(guestSnap.currentQuestion).toBeDefined();
    expect(hostSnap.currentQuestion.questionIndex).toBe(0);
    expect(guestSnap.currentQuestion.questionIndex).toBe(0);

    // Reveal-leak invariant (T-04-REVEAL-LEAK) still holds on the
    // post-start snapshot path.
    expect(hostSnap.currentQuestion).not.toHaveProperty("correctOptionId");
    expect(guestSnap.currentQuestion).not.toHaveProperty("correctOptionId");
    expect(hostSnap.currentQuestion).not.toHaveProperty("explanation");
    expect(guestSnap.currentQuestion).not.toHaveProperty("explanation");

    expect(guestSnap.totalQuestions).toBe(3);
    expect(guestSnap.remainingMs).toBeGreaterThan(0);

    host.ws.close();
    guest.ws.close();
  });
});
