import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import {
  websocketAuthGuard,
  type BattleWSVariables,
} from "../../worker/src/middleware/websocket-auth-guard";

// VALIDATION.md 04-24 (SEC-06 / T-04-08): the /api/battle/:id/ws upgrade
// endpoint gates on four axes:
//   1. Upgrade header present (else 426).
//   2. Origin header in allowlist {PUBLIC_URL, requestOrigin} (else 403).
//   3. Better Auth session valid (else 401).
//   4. User is host or guest of the named battle (else 403 generic —
//      indistinguishable from "battle does not exist").
//
// We mount the middleware on a minimal Hono app and exercise each failure
// mode. The allowed Origin is http://localhost:5173 per wrangler vars.

const PUBLIC_URL = "http://localhost:5173";

function buildWsApp() {
  const app = new Hono<{ Bindings: Env; Variables: BattleWSVariables }>();
  app.get("/api/battle/:id/ws", websocketAuthGuard, async (c) => {
    // Stand-in handler — we never actually forward to the DO in these
    // tests. 200/body just confirms the guard called next().
    return c.json({
      ok: true,
      userId: c.get("userId"),
      battleId: c.get("battleId"),
      role: c.get("role"),
    });
  });
  return app;
}

async function seedBattle(
  battleId: string,
  hostId: string,
  guestId: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // Create a roadmap for the host so the battle's host_roadmap_id FK is valid.
  const roadmapId = `r-auth-ws-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roadmapId,
      hostId,
      "Auth WS test",
      "auth-ws",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO battles (id, join_code, host_id, host_roadmap_id, guest_id, question_count, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'lobby', ?)`,
  )
    .bind(
      battleId,
      `J${crypto.randomUUID().slice(0, 5)}`.toUpperCase(),
      hostId,
      roadmapId,
      guestId,
      5,
      now,
    )
    .run();
}

describe("websocketAuthGuard (04-24 / T-04-08)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";
  let OUTSIDER_COOKIE = "";
  let BATTLE_ID = "";

  beforeAll(async () => {
    await setupD1();
    const host = await createTestSession("auth-ws-host@test.example");
    HOST_COOKIE = host.cookie;
    HOST_ID = host.userId;
    const outsider = await createTestSession("auth-ws-outsider@test.example");
    OUTSIDER_COOKIE = outsider.cookie;

    BATTLE_ID = `b-auth-ws-${crypto.randomUUID()}`;
    await seedBattle(BATTLE_ID, HOST_ID, null);
  });

  it("1a. upgrade request, no Cookie → 401 Unauthorized", async () => {
    const app = buildWsApp();
    const res = await app.request(
      `/api/battle/${BATTLE_ID}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: PUBLIC_URL,
        },
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("1b. upgrade request, valid outsider cookie (not a participant) → 403 Forbidden", async () => {
    const app = buildWsApp();
    const res = await app.request(
      `/api/battle/${BATTLE_ID}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: PUBLIC_URL,
          Cookie: OUTSIDER_COOKIE,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden");
  });

  it("1c. upgrade request, valid host cookie, bad Origin (CSWSH) → 403 Forbidden", async () => {
    const app = buildWsApp();
    const res = await app.request(
      `/api/battle/${BATTLE_ID}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: "https://evil.com",
          Cookie: HOST_COOKIE,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Forbidden origin");
  });

  it("1d. upgrade request, valid cookie, correct Origin, non-existent battleId → 403 (same body as non-participant)", async () => {
    const app = buildWsApp();
    const fakeId = `b-does-not-exist-${crypto.randomUUID()}`;
    const res = await app.request(
      `/api/battle/${fakeId}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: PUBLIC_URL,
          Cookie: HOST_COOKIE,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
    // Generic 403 body — identical to 1b so attackers can't enumerate
    // existing battleIds by observing differential responses.
    expect(await res.text()).toBe("Forbidden");
  });

  it("1e. non-WS GET (no Upgrade header), valid cookie → 426", async () => {
    const app = buildWsApp();
    const res = await app.request(
      `/api/battle/${BATTLE_ID}/ws`,
      {
        headers: {
          Origin: PUBLIC_URL,
          Cookie: HOST_COOKIE,
        },
      },
      env,
    );
    expect(res.status).toBe(426);
    expect(await res.text()).toBe("Expected WebSocket");
  });

  it("1f. (positive path) host with valid cookie, correct Origin, valid WS upgrade → calls next() with userId/battleId/role set", async () => {
    const app = buildWsApp();
    const res = await app.request(
      `/api/battle/${BATTLE_ID}/ws`,
      {
        headers: {
          Upgrade: "websocket",
          Origin: PUBLIC_URL,
          Cookie: HOST_COOKIE,
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      userId: string;
      battleId: string;
      role: "host" | "guest";
    };
    expect(body.ok).toBe(true);
    expect(body.userId).toBe(HOST_ID);
    expect(body.battleId).toBe(BATTLE_ID);
    expect(body.role).toBe("host");
  });
});
