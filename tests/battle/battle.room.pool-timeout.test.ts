import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type { BattleRoom } from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-39 (MULT-01, MULT-02, gap 04-12 / T-04-gap-11):
// BattleRoom DO schedules a 60s pool-timeout alarm at end of opAttachGuest.
// When the alarm fires in runtime.phase='pre-battle' with
// battle_pool_topics.status='generating', the handler flips status='failed'
// so the frontend's existing error pane surfaces. On status='ready' or
// 'failed' already, the alarm is a no-op. opStartBattle clears the alarm
// so it cannot fire after the transition to active.
//
// Mirrors the fixture pattern from battle.lobby.timeout.test.ts:
//   1. seedUser + seedLobbyRow via env.DB.prepare
//   2. env.BATTLE_ROOM.idFromName(battleId).get() → DO stub
//   3. stub.fetch("https://do/op", { headers: { "X-Battle-Op": ... } }) ops
//   4. runInDurableObject(stub, (_inst, state) => state.storage.getAlarm())
//   5. runDurableObjectAlarm(stub) force-fires the alarm.

const HOST_ID = "host-pool-timeout";
const GUEST_ID = "guest-pool-timeout";
const POOL_TIMEOUT_MS = 60_000;

async function seedUser(id: string, name: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(id, name, `${id}@test.example`, now, now)
    .run();
}

async function seedLobbyRow(
  battleId: string,
  joinCode: string,
  poolTopicId: string | null,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await seedUser(HOST_ID, "PoolTimeoutHost");
  const roadmapId = `r-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roadmapId,
      HOST_ID,
      "Pool Timeout Test",
      "pool-timeout-test",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, pool_topic_id, winning_topic, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      battleId,
      joinCode,
      HOST_ID,
      roadmapId,
      5,
      "lobby",
      poolTopicId,
      "pool-timeout-topic",
      now,
    )
    .run();
  return roadmapId;
}

async function seedPoolTopic(
  poolTopicId: string,
  topic: string,
  status: "generating" | "ready" | "failed" = "generating",
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(poolTopicId, `${topic}-${poolTopicId}`, status, poolTopicId, now, now)
    .run();
}

async function initLobbyAndAttachGuest(
  stub: DurableObjectStub<BattleRoom>,
  battleId: string,
): Promise<void> {
  await seedUser(GUEST_ID, "PoolTimeoutGuest");
  const initRes = await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "initLobby" },
    body: JSON.stringify({ battleId, hostId: HOST_ID, questionCount: 5 }),
  });
  expect(initRes.status).toBe(200);
  const attachRes = await stub.fetch("https://do/op", {
    method: "POST",
    headers: { "X-Battle-Op": "attachGuest" },
    body: JSON.stringify({ guestId: GUEST_ID, guestName: "PoolTimeoutGuest" }),
  });
  expect(attachRes.status).toBe(200);
}

describe("BattleRoom DO pool-timeout alarm (04-39 / gap 04-12)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("A: opAttachGuest schedules a ~60s alarm", async () => {
    const battleId = `b-pt-A-${crypto.randomUUID()}`;
    const poolTopicId = `pt-A-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "pt-A-topic");
    await seedLobbyRow(battleId, "PTALRM", poolTopicId);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const beforeMs = Date.now();
    await initLobbyAndAttachGuest(stub, battleId);
    const afterMs = Date.now();

    await runInDurableObject(stub, async (_inst, state) => {
      const alarmAt = await state.storage.getAlarm();
      expect(alarmAt).not.toBeNull();
      // ±5s tolerance for scheduling + test harness jitter.
      expect(alarmAt!).toBeGreaterThanOrEqual(beforeMs + POOL_TIMEOUT_MS - 5_000);
      expect(alarmAt!).toBeLessThanOrEqual(afterMs + POOL_TIMEOUT_MS + 5_000);
    });
  });

  it("B: alarm fires in pre-battle with status='generating' → flips to 'failed'", async () => {
    const battleId = `b-pt-B-${crypto.randomUUID()}`;
    const poolTopicId = `pt-B-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "pt-B-topic", "generating");
    await seedLobbyRow(battleId, "PTBALR", poolTopicId);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await initLobbyAndAttachGuest(stub, battleId);

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const row = await env.DB.prepare(
      `SELECT status FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(row?.status).toBe("failed");
  });

  it("C: alarm fires with status already 'ready' → no-op", async () => {
    const battleId = `b-pt-C-${crypto.randomUUID()}`;
    const poolTopicId = `pt-C-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "pt-C-topic", "generating");
    await seedLobbyRow(battleId, "PTCALR", poolTopicId);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await initLobbyAndAttachGuest(stub, battleId);

    // Race-winner path: flip to 'ready' BEFORE the alarm fires.
    await env.DB.prepare(
      `UPDATE battle_pool_topics SET status = 'ready', updated_at = ? WHERE id = ?`,
    )
      .bind(Math.floor(Date.now() / 1000), poolTopicId)
      .run();

    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const row = await env.DB.prepare(
      `SELECT status FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ status: string }>();
    expect(row?.status).toBe("ready");
  });

  it("D: opStartBattle clears the pool-timeout alarm", async () => {
    const battleId = `b-pt-D-${crypto.randomUUID()}`;
    const poolTopicId = `pt-D-${crypto.randomUUID()}`;
    await seedPoolTopic(poolTopicId, "pt-D-topic", "ready");
    await seedLobbyRow(battleId, "PTDALR", poolTopicId);

    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await initLobbyAndAttachGuest(stub, battleId);

    // Load one question so opStartBattle can transition to active.
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "setQuestions" },
      body: JSON.stringify({
        questions: [
          {
            id: "q-1",
            questionText: "Test?",
            questionType: "mcq",
            options: [
              { id: "a", text: "Yes" },
              { id: "b", text: "No" },
            ],
            correctOptionId: "a",
            explanation: "Test",
          },
        ],
        reservedQuestions: [],
      }),
    });

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "startBattle" },
      body: JSON.stringify({ wagerAmount: 100 }),
    });

    await runInDurableObject(stub, async (_inst, state) => {
      const alarmAt = await state.storage.getAlarm();
      // After startBattle, any alarm is the BATTLE_TIME_LIMIT question
      // timer (15s), NOT the 60s pool-timeout. Either assert alarmAt is
      // null OR assert alarmAt < (Date.now() + 30_000) — i.e., the
      // question timer, not a 60s pool-timeout.
      if (alarmAt !== null) {
        expect(alarmAt).toBeLessThan(Date.now() + 30_000);
      }
      // The pool-timeout alarm (~60s from opAttachGuest) must NOT be pending.
    });
  });
});
