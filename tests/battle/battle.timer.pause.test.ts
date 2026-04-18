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

// VALIDATION.md 04-21 (MULT-05 / D-25): question timer pauses during the
// disconnect grace window. Elapsed time DURING the pause does NOT count
// toward the 15s answer timer — on reconnect, the remaining-ms recorded
// at disconnect time is preserved.

const HOST_ID = "host-pause";
const GUEST_ID = "guest-pause";
const BATTLE_TIME_LIMIT_MS = 15_000;

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

describe("BattleRoom timer pause during disconnect (04-21 / D-25)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("disconnect captures paused remaining time; reconnect resumes with same budget (elapsed pause NOT counted)", async () => {
    const tag = crypto.randomUUID();
    const battleId = `b-pause-${tag}`;
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

    // Wait ~200 ms before disconnecting so the paused-remaining ms is
    // clearly less than 15_000 but very close to it.
    await new Promise((r) => setTimeout(r, 200));

    const disconnectCallTime = Date.now();
    host.ws.close(1000, "wifi-drop");

    // Wait for disconnect bucket.
    const deadline = Date.now() + 1500;
    let pausedRemaining: number | undefined;
    let questionStartedAtMs: number | undefined;
    while (Date.now() < deadline && pausedRemaining === undefined) {
      await new Promise((r) => setTimeout(r, 20));
      await flush();
      await runInDurableObject(stub, async (_inst, state) => {
        const disc =
          await state.storage.get<DisconnectRecord>("disconnect");
        if (disc) {
          pausedRemaining = disc.pausedQuestionRemainingMs;
        }
        const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
        questionStartedAtMs = rt.questionStartedAtMs;
      });
    }
    expect(pausedRemaining).toBeDefined();
    // ~200 ms elapsed before disconnect → paused ≈ 14_800 ms (±500ms
    // tolerance for scheduler jitter).
    expect(pausedRemaining!).toBeGreaterThan(BATTLE_TIME_LIMIT_MS - 1_500);
    expect(pausedRemaining!).toBeLessThanOrEqual(BATTLE_TIME_LIMIT_MS);

    // Sleep 600 ms of real wall-clock time. The grace alarm is 30s out
    // and doesn't fire during this sleep. Elapsed pause time == 600 ms.
    await new Promise((r) => setTimeout(r, 600));

    // Reconnect.
    const reconnectTime = Date.now();
    const host2 = await openSocket(stub, hostId, "host");
    host2.ws.send(JSON.stringify({ action: "hello" }));
    await flush();
    await new Promise((r) => setTimeout(r, 100));
    await flush();

    // Verify:
    //   1. alarm is rescheduled ≈ reconnect + pausedRemaining (NOT reconnect + pausedRemaining - 600ms)
    //   2. runtime.questionStartedAtMs is adjusted so that
    //      questionStartedAtMs + BATTLE_TIME_LIMIT_MS ≈ reconnectTime + pausedRemaining
    await runInDurableObject(stub, async (_inst, state) => {
      const rt = (await state.storage.get<BattleRuntime>("runtime"))!;
      expect(rt.phase).toBe("active");

      const alarm = await state.storage.getAlarm();
      expect(alarm).toBeTypeOf("number");

      // Expected alarm ≈ reconnectTime + pausedRemaining; allow ±500 ms
      // for dispatch + storage jitter.
      const expectedAlarm = reconnectTime + pausedRemaining!;
      expect(Math.abs(alarm! - expectedAlarm)).toBeLessThan(500);

      // Post-resume: rt.questionStartedAtMs should be "now - (TIME_LIMIT - paused)"
      // so that (questionStartedAtMs + TIME_LIMIT) still equals (now + paused).
      const effectiveDeadline =
        rt.questionStartedAtMs + BATTLE_TIME_LIMIT_MS;
      expect(
        Math.abs(effectiveDeadline - (reconnectTime + pausedRemaining!)),
      ).toBeLessThan(500);

      // IMPORTANT: the 600ms sleep should NOT have been counted.
      // Pre-disconnect questionStartedAtMs was captured above;
      // post-reconnect questionStartedAtMs should be LATER (adjusted
      // forward by the pause duration).
      if (questionStartedAtMs !== undefined) {
        // Adjustment must be at least ~500ms (the real sleep) and less
        // than the 30s grace window.
        const shift = rt.questionStartedAtMs - questionStartedAtMs;
        expect(shift).toBeGreaterThan(300);
        expect(shift).toBeLessThan(30_000);
      }
    });

    // Disconnect time for context (avoid unused var warning).
    expect(disconnectCallTime).toBeTypeOf("number");

    host2.ws.close();
  });
});
