import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";

// VALIDATION.md 04-25 (SEC-06 / T-04-08): the DO must not accept a WS
// upgrade request without a valid `X-Battle-User-Id` header. This is the
// DO-level belt-and-braces check that complements the HTTP-layer
// websocketAuthGuard. In production the Worker route injects this header
// only AFTER validating the Better Auth session + battle membership, so a
// missing header indicates a direct DO fetch that bypassed the Worker.
//
// Plan 02's handleWsUpgrade currently enforces only the "missing header →
// 401" clause. It does NOT cross-validate X-Battle-User-Id against the
// stored config.hostId / config.guestId. The stricter cross-check is
// deferred to Plan 08 (noted in Plan 04-04 SUMMARY). Adding the cross-check
// to this test would currently fail because the DO accepts any non-empty
// userId.

describe("BattleRoom WS upgrade header enforcement (04-25 / T-04-08)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("rejects upgrade without X-Battle-User-Id header with 401", async () => {
    const battleId = `b-do-auth-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const res = await stub.fetch("https://do/ws", {
      headers: {
        Upgrade: "websocket",
        // deliberately omit X-Battle-User-Id
      },
    });

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("accepts upgrade with X-Battle-User-Id header (Plan 02 behaviour)", async () => {
    const battleId = `b-do-auth-ok-${crypto.randomUUID()}`;
    const id = env.BATTLE_ROOM.idFromName(battleId);
    const stub = env.BATTLE_ROOM.get(id);

    const res = await stub.fetch("https://do/ws", {
      headers: {
        Upgrade: "websocket",
        "X-Battle-User-Id": "any-user-id",
        "X-Battle-Role": "host",
      },
    });

    // Plan 02's DO accepts the upgrade as long as the header is present —
    // the Worker-layer websocketAuthGuard is responsible for attesting to
    // the header's validity. Full participant cross-check in the DO is a
    // Plan 08 refinement (tracked in Plan 04-04 SUMMARY as a deferred
    // follow-up).
    expect(res.status).toBe(101);
    // Close the accepted WS so the DO isn't left holding a socket.
    if (res.webSocket) {
      res.webSocket.accept();
      res.webSocket.close();
    }
  });
});
