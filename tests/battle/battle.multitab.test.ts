import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { setupD1 } from "../setup";
import type { BattleRoom } from "../../worker/src/durable-objects/BattleRoom";

// VALIDATION.md 04-23 (SEC-06 / T-04-07 / D-27): when a second WS connects
// for the same (battleId, userId), the DO closes the older socket with
// code 4001 and keeps only the newest.

const HOST_ID = "host-multitab";

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
  let closeEvent: { code: number; reason: string } | null = null;
  const received: string[] = [];
  ws.addEventListener("message", (ev: MessageEvent) => {
    received.push(String(ev.data));
  });
  ws.addEventListener("close", (ev: CloseEvent) => {
    closeEvent = { code: ev.code, reason: ev.reason };
  });
  return {
    ws,
    get closeEvent() {
      return closeEvent;
    },
    received,
  };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("BattleRoom multi-tab eviction (04-23 / D-27 / T-04-07)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("second WS for same userId closes the first with code 4001", async () => {
    const battleId = `b-mt-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    // initLobby so the DO has a valid config (not strictly required for the
    // eviction test, but matches the real flow).
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "initLobby" },
      body: JSON.stringify({
        battleId,
        hostId: HOST_ID,
        questionCount: 5,
      }),
    });

    // Open WS #1.
    const ws1 = await openSocket(stub, HOST_ID, "host");
    await flush();

    // Confirm one socket is registered.
    await runInDurableObject(stub, async (_inst, state) => {
      const sockets = state.getWebSockets(HOST_ID);
      expect(sockets.length).toBe(1);
    });

    // Open WS #2 for the SAME userId.
    const ws2 = await openSocket(stub, HOST_ID, "host");
    // Poll up to 500ms for the close frame to reach ws1 (miniflare loopback
    // delivers close events asynchronously).
    const deadline = Date.now() + 500;
    while (Date.now() < deadline && ws1.closeEvent === null) {
      await flush();
      await new Promise((r) => setTimeout(r, 20));
    }

    // WS #1 should have received a close event with code 4001.
    expect(ws1.closeEvent).not.toBeNull();
    expect(ws1.closeEvent!.code).toBe(4001);
    expect(ws1.closeEvent!.reason).toContain("Battle moved");

    // Important: `ctx.getWebSockets(userId)` may continue to report a recently
    // closed socket until miniflare garbage-collects it; the AUTHORITATIVE
    // signal that eviction happened is the close frame (code 4001) asserted
    // above on ws1. Just verify that of whatever sockets remain, the new one
    // is still open (readyState === OPEN = 1).
    await runInDurableObject(stub, async (_inst, state) => {
      const sockets = state.getWebSockets(HOST_ID);
      const open = sockets.filter((s) => s.readyState === WebSocket.OPEN);
      // There must be at least ONE open socket (ws2) and at most ONE
      // (since ws1 was evicted — its readyState is no longer OPEN).
      expect(open.length).toBe(1);
    });

    ws2.ws.close();
  });

  it("different userIds are NOT evicted (per-user scoping)", async () => {
    const battleId = `b-mt-scope-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "initLobby" },
      body: JSON.stringify({
        battleId,
        hostId: HOST_ID,
        questionCount: 5,
      }),
    });
    await stub.fetch("https://do/op", {
      method: "POST",
      headers: { "X-Battle-Op": "attachGuest" },
      body: JSON.stringify({ guestId: "guest-mt-scope" }),
    });

    const hostWs = await openSocket(stub, HOST_ID, "host");
    const guestWs = await openSocket(stub, "guest-mt-scope", "guest");
    await flush();
    await new Promise((r) => setTimeout(r, 30));

    // Neither socket should have been closed.
    expect(hostWs.closeEvent).toBeNull();
    expect(guestWs.closeEvent).toBeNull();

    await runInDurableObject(stub, async (_inst, state) => {
      expect(state.getWebSockets(HOST_ID).length).toBe(1);
      expect(state.getWebSockets("guest-mt-scope").length).toBe(1);
    });

    hostWs.ws.close();
    guestWs.ws.close();
  });
});
