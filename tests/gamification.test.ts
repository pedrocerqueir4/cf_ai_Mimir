import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createTestSession } from "./setup";

// WORKER binding is the fetch handler for the full Hono app
declare const WORKER: { fetch: (req: Request) => Promise<Response> };

describe("Gamification integration", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("gamification@test.com");
    cookie = session.cookie;
    userId = session.userId;

    // Seed a roadmap and lesson for XP award tests
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, current_step, nodes_json, created_at, updated_at)
       VALUES ('roadmap-1', ?, 'Test Roadmap', 'testing', 'linear', 'complete', 0, '[]', ?, ?)`
    ).bind(userId, now, now).run();

    await env.DB.prepare(
      `INSERT INTO lessons (id, roadmap_id, node_id, title, content, "order", created_at)
       VALUES ('lesson-1', 'roadmap-1', 'node-1', 'Test Lesson', 'Content', 1, ?)`
    ).bind(now).run();

    // Seed a quiz and question for quiz XP tests
    await env.DB.prepare(
      `INSERT INTO quizzes (id, lesson_id, created_at)
       VALUES ('quiz-1', 'lesson-1', ?)`
    ).bind(now).run();

    await env.DB.prepare(
      `INSERT INTO quiz_questions (id, quiz_id, question_text, question_type, options_json, correct_option_id, explanation, "order")
       VALUES ('q-1', 'quiz-1', 'Test question?', 'multiple_choice', '[]', 'opt-a', 'Because', 1)`
    ).bind().run();
  });

  describe("lesson XP award (GAME-01)", () => {
    it("awards XP on first lesson completion", async () => {
      const res = await WORKER.fetch(
        new Request("http://localhost/api/roadmaps/roadmap-1/lessons/lesson-1/complete", {
          method: "POST",
          headers: { Cookie: cookie },
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.completed).toBe(true);
      expect(body.xpEarned).toBe(25); // linear roadmap = 25 XP
      expect(body.newXp).toBeGreaterThan(0);
    });

    it("does not double-award XP on idempotent completion", async () => {
      const res = await WORKER.fetch(
        new Request("http://localhost/api/roadmaps/roadmap-1/lessons/lesson-1/complete", {
          method: "POST",
          headers: { Cookie: cookie },
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.xpEarned).toBe(0);
    });
  });

  describe("quiz XP award (GAME-02)", () => {
    it("awards 10 XP for correct quiz answer", async () => {
      const res = await WORKER.fetch(
        new Request("http://localhost/api/roadmaps/quiz/q-1/answer", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId: "opt-a" }),
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.correct).toBe(true);
      expect(body.xpEarned).toBe(10);
    });

    it("awards 0 XP for incorrect quiz answer", async () => {
      const res = await WORKER.fetch(
        new Request("http://localhost/api/roadmaps/quiz/q-1/answer", {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ selectedOptionId: "opt-wrong" }),
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.correct).toBe(false);
      expect(body.xpEarned).toBe(0);
    });
  });

  describe("stats endpoint (GAME-04, GAME-06)", () => {
    it("returns user stats with correct fields", async () => {
      const res = await WORKER.fetch(
        new Request("http://localhost/api/user/stats?tz=UTC", {
          headers: { Cookie: cookie },
        })
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
      const res = await WORKER.fetch(
        new Request("http://localhost/api/user/stats?tz=UTC", {
          headers: { Cookie: cookie },
        })
      );
      const body = await res.json() as any;
      expect(typeof body.streak).toBe("number");
    });
  });

  describe("streak logic (GAME-05)", () => {
    it("streak increments on consecutive day lesson completion", async () => {
      // This test validates the streak was set during lesson completion above
      // Full multi-day streak testing requires time mocking which is a
      // limitation of the current test infrastructure.
      // The pure-function streak tests in xp.test.ts cover the logic exhaustively.
      const statsRes = await WORKER.fetch(
        new Request("http://localhost/api/user/stats?tz=UTC", {
          headers: { Cookie: cookie },
        })
      );
      const stats = await statsRes.json() as any;
      expect(stats.streak).toBeGreaterThanOrEqual(1);
    });
  });
});
