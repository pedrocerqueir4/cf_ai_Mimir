import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { setupD1 } from "../setup";
import type { BattleRoom } from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-04 (MULT-01 / D-04): if no guest joins within 5 minutes,
// the DO's lobby alarm fires, marks the D1 battles row as status='expired',
// and destroys its own storage.

const HOST_ID = "host-lobby-timeout";

async function seedLobbyRow(battleId: string, joinCode: string) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  )
    .bind(HOST_ID, "LobbyHost", `${HOST_ID}@test.example`, now, now)
    .run();
  const roadmapId = `r-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roadmapId,
      HOST_ID,
      "Lobby Test",
      "lobby-test",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'lobby', ?)`,
  )
    .bind(battleId, joinCode, HOST_ID, roadmapId, 5, now)
    .run();
}

describe("BattleRoom lobby timeout (04-04 / D-04)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("alarm in lobby phase marks battles.status='expired' in D1 and destroys DO storage", async () => {
    const battleId = `b-lobby-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    // Seed a lobby battles row so the DO's D1 update has something to hit.
    await seedLobbyRow(battleId, "LOBBY1");

    // Initialise lobby (DO sets phase=lobby, schedules lobby alarm).
    const res = await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "initLobby" },
      body: JSON.stringify({
        battleId,
        hostId: HOST_ID,
        questionCount: 5,
      }),
    });
    expect(res.status).toBe(200);

    // Confirm lobby alarm scheduled.
    await runInDurableObject(stub, async (_inst, state) => {
      const alarm = await state.storage.getAlarm();
      expect(alarm).not.toBeNull();
    });

    // Force-fire the alarm → DO runs expireLobby → destroyBattle.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    // DO storage is wiped.
    await runInDurableObject(stub, async (_inst, state) => {
      const runtime = await state.storage.get("runtime");
      const config = await state.storage.get("config");
      expect(runtime).toBeUndefined();
      expect(config).toBeUndefined();
    });

    // D1 battles row flipped to 'expired'.
    const row = await env.DB.prepare(
      `SELECT status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(row?.status).toBe("expired");
  });

  it("attachGuest cancels the lobby alarm and schedules the 60s pool-timeout alarm — no premature expire", async () => {
    // Gap 04-12: attachGuest now cancels the lobby alarm (5min) AND
    // immediately schedules a NEW pool-timeout alarm (60s) whose alarm()
    // branch flips battle_pool_topics.status to 'failed' if still
    // 'generating' at expiry. Single-alarm-per-DO invariant preserved —
    // only one alarm is pending at a time, and opStartBattle's existing
    // deleteAlarm() clears it on transition to 'active'.

    const battleId = `b-lobby-cancel-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedLobbyRow(battleId, "CANCEL");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "initLobby" },
      body: JSON.stringify({ battleId, hostId: HOST_ID, questionCount: 5 }),
    });

    let lobbyAlarmTs: number | null = null;
    await runInDurableObject(stub, async (_inst, state) => {
      lobbyAlarmTs = await state.storage.getAlarm();
      expect(lobbyAlarmTs).not.toBeNull();
    });

    // Guest joins → DO cancels the lobby alarm AND schedules pool-timeout.
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "attachGuest" },
      body: JSON.stringify({ guestId: "guest-lobby-cancel" }),
    });

    // Gap 04-12: alarm is now the pool-timeout alarm (~60s out), NOT the
    // lobby alarm (which was 5 minutes out). The timestamp is strictly
    // earlier than the lobby alarm — proving the lobby alarm was replaced.
    await runInDurableObject(stub, async (_inst, state) => {
      const poolAlarmTs = await state.storage.getAlarm();
      expect(poolAlarmTs).not.toBeNull();
      if (lobbyAlarmTs !== null && poolAlarmTs !== null) {
        expect(poolAlarmTs).toBeLessThan(lobbyAlarmTs);
      }
    });

    // Fire the pool-timeout alarm. This test's seed does NOT set
    // battles.pool_topic_id, so the pre-battle branch early-returns at
    // the `if (!poolTopicId) return;` guard. Battle row status stays 'lobby'.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    // D1 battles row is still 'lobby' (NOT expired — the pool-timeout
    // branch does NOT touch battles.status; only battle_pool_topics.status).
    const row = await env.DB.prepare(
      `SELECT status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(row?.status).toBe("lobby");
  });
});
