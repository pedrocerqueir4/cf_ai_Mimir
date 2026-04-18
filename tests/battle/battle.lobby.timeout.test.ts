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

  it("attachGuest cancels the lobby alarm — no premature expire", async () => {
    const battleId = `b-lobby-cancel-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await seedLobbyRow(battleId, "CANCEL");

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "initLobby" },
      body: JSON.stringify({ battleId, hostId: HOST_ID, questionCount: 5 }),
    });

    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });

    // Guest joins → DO cancels the lobby alarm.
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "attachGuest" },
      body: JSON.stringify({ guestId: "guest-lobby-cancel" }),
    });

    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });

    // Try to fire an alarm — there is none, so no state change.
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(false);

    // D1 battles row is still 'lobby' (NOT expired).
    const row = await env.DB.prepare(
      `SELECT status FROM battles WHERE id = ?`,
    )
      .bind(battleId)
      .first<{ status: string }>();
    expect(row?.status).toBe("lobby");
  });
});
