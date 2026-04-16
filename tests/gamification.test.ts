import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "./setup";
import { roadmapRoutes } from "../worker/src/routes/roadmaps";
import { gamificationRoutes } from "../worker/src/routes/gamification";
import type { AuthVariables } from "../worker/src/middleware/auth-guard";

// ─── Test app builder ─────────────────────────────────────────────────────────
//
// Build a minimal Hono app that mounts only the routes under test.
// Pass `env` as the third arg to `app.request()` so Hono bindings resolve.
// This mirrors the qna.test.ts pattern and avoids depending on index.ts
// having every route wired (index.ts is the production entrypoint, not a test
// router — it may not include gamification routes until Phase 3 wiring lands).

function buildGameApp() {
  const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
  app.route("/api/roadmaps", roadmapRoutes);
  app.route("/api/user", gamificationRoutes);
  return app;
}

// ─── Shared fixture state ─────────────────────────────────────────────────────

let GAME_COOKIE = "";
let GAME_USER_ID = "";

describe("Gamification integration", () => {
  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("gamification@test.com");
    GAME_COOKIE = session.cookie;
    GAME_USER_ID = session.userId;

    // Seed a roadmap and lesson for XP award tests
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, current_step, nodes_json, created_at, updated_at)
       VALUES ('roadmap-1', ?, 'Test Roadmap', 'testing', 'linear', 'complete', 0, '[]', ?, ?)`
    ).bind(GAME_USER_ID, now, now).run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO lessons (id, roadmap_id, node_id, title, content, "order", created_at)
       VALUES ('lesson-1', 'roadmap-1', 'node-1', 'Test Lesson', 'Content', 1, ?)`
    ).bind(now).run();

    // Seed a quiz and question for quiz XP tests
    await env.DB.prepare(
      `INSERT OR IGNORE INTO quizzes (id, lesson_id, created_at)
       VALUES ('quiz-1', 'lesson-1', ?)`
    ).bind(now).run();

    await env.DB.prepare(
      `INSERT OR IGNORE INTO quiz_questions (id, quiz_id, question_text, question_type, options_json, correct_option_id, explanation, "order")
       VALUES ('q-1', 'quiz-1', 'Test question?', 'multiple_choice', '[]', 'opt-a', 'Because', 1)`
    ).bind().run();
  });

  describe("lesson XP award (GAME-01)", () => {
    it("awards XP on first lesson completion", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/roadmaps/roadmap-1/lessons/lesson-1/complete",
        {
          method: "POST",
          headers: { Cookie: GAME_COOKIE },
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.completed).toBe(true);
      expect(body.xpEarned).toBe(25); // linear roadmap = 25 XP
      expect(body.newXp).toBeGreaterThan(0);
    });

    it("does not double-award XP on idempotent completion", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/roadmaps/roadmap-1/lessons/lesson-1/complete",
        {
          method: "POST",
          headers: { Cookie: GAME_COOKIE },
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.xpEarned).toBe(0);
    });
  });

  describe("quiz XP award (GAME-02)", () => {
    it("awards 10 XP for correct quiz answer", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/roadmaps/quiz/q-1/answer",
        {
          method: "POST",
          headers: { Cookie: GAME_COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId: "opt-a" }),
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.correct).toBe(true);
      expect(body.xpEarned).toBe(10);
    });

    it("awards 0 XP for incorrect quiz answer", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/roadmaps/quiz/q-1/answer",
        {
          method: "POST",
          headers: { Cookie: GAME_COOKIE, "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId: "opt-wrong" }),
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.correct).toBe(false);
      expect(body.xpEarned).toBe(0);
    });
  });

  describe("stats endpoint (GAME-04, GAME-06)", () => {
    it("returns user stats with correct fields", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/user/stats?tz=UTC",
        {
          headers: { Cookie: GAME_COOKIE },
        },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body).toHaveProperty("xp");
      expect(body).toHaveProperty("level");
      expect(body).toHaveProperty("xpToNextLevel");
      expect(body).toHaveProperty("progressPercent");
      expect(body).toHaveProperty("streak");
      expect(body).toHaveProperty("longestStreak");
      expect(body).toHaveProperty("todayLessonCompleted");
      expect(body.xp).toBeGreaterThan(0); // XP from previous tests
    });

    it("includes streak field (GAME-06)", async () => {
      const app = buildGameApp();
      const res = await app.request(
        "/api/user/stats?tz=UTC",
        {
          headers: { Cookie: GAME_COOKIE },
        },
        env,
      );
      const body = await res.json() as any;
      expect(typeof body.streak).toBe("number");
    });
  });

  describe("streak logic (GAME-05)", () => {
    it("streak increments on consecutive day lesson completion", async () => {
      // Validates streak was set during lesson completion above.
      // Full multi-day streak testing requires time mocking — exhaustive pure-function
      // streak tests live in xp.test.ts (updateStreak).
      const app = buildGameApp();
      const statsRes = await app.request(
        "/api/user/stats?tz=UTC",
        {
          headers: { Cookie: GAME_COOKIE },
        },
        env,
      );
      const stats = await statsRes.json() as any;
      expect(stats.streak).toBeGreaterThanOrEqual(1);
    });
  });
});
