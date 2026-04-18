import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";
import { JOIN_CODE_ALPHABET } from "../../worker/src/lib/join-code";

// VALIDATION.md 04-01 (MULT-01): POST /api/battle returns a 6-character
// join code drawn from JOIN_CODE_ALPHABET, creates a battles row with
// status='lobby', and reports expiresAt = createdAt + 5min.

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/battle", battleRoutes);
  return app;
}

async function seedRoadmap(userId: string): Promise<string> {
  const roadmapId = `r-create-${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      roadmapId,
      userId,
      "Create Test Roadmap",
      "create-topic",
      "linear",
      "complete",
      "[]",
      now,
      now,
    )
    .run();
  return roadmapId;
}

describe("POST /api/battle (04-01 / MULT-01)", () => {
  let HOST_COOKIE = "";
  let HOST_ID = "";

  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("battle-create@test.example");
    HOST_COOKIE = session.cookie;
    HOST_ID = session.userId;
  });

  it("creates a battle, returns a 6-char join code from JOIN_CODE_ALPHABET", async () => {
    const roadmapId = await seedRoadmap(HOST_ID);
    const app = buildApp();
    const res = await app.request(
      "/api/battle",
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ roadmapId, questionCount: 5 }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      battleId: string;
      joinCode: string;
      questionCount: number;
      hostId: string;
      expiresAt: number;
    };

    expect(body.battleId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.joinCode).toHaveLength(6);
    for (const ch of body.joinCode) {
      expect(JOIN_CODE_ALPHABET).toContain(ch);
    }
    expect(body.questionCount).toBe(5);
    expect(body.hostId).toBe(HOST_ID);
    // expiresAt should be roughly now + 5 minutes (300_000 ms).
    expect(body.expiresAt - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    expect(body.expiresAt - Date.now()).toBeLessThan(6 * 60 * 1000);

    // D1 battles row exists with the expected shape.
    const row = await env.DB.prepare(
      `SELECT id, join_code, host_id, host_roadmap_id, question_count, status FROM battles WHERE id = ?`,
    )
      .bind(body.battleId)
      .first<{
        id: string;
        join_code: string;
        host_id: string;
        host_roadmap_id: string;
        question_count: number;
        status: string;
      }>();
    expect(row).toBeTruthy();
    expect(row!.status).toBe("lobby");
    expect(row!.host_id).toBe(HOST_ID);
    expect(row!.host_roadmap_id).toBe(roadmapId);
    expect(row!.join_code).toBe(body.joinCode);
    expect(row!.question_count).toBe(5);
  });

  it("rejects create on unowned roadmap with 404 (IDOR)", async () => {
    // Seed a roadmap owned by a DIFFERENT user
    const otherSession = await createTestSession(
      "battle-create-other@test.example",
    );
    const otherRoadmapId = await seedRoadmap(otherSession.userId);

    const app = buildApp();
    const res = await app.request(
      "/api/battle",
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ roadmapId: otherRoadmapId, questionCount: 5 }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("rejects invalid questionCount (not 5/10/15) with 400", async () => {
    const roadmapId = await seedRoadmap(HOST_ID);
    const app = buildApp();
    const res = await app.request(
      "/api/battle",
      {
        method: "POST",
        headers: { Cookie: HOST_COOKIE, "Content-Type": "application/json" },
        body: JSON.stringify({ roadmapId, questionCount: 7 }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated request with 401", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/battle",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roadmapId: "x", questionCount: 5 }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });
});
