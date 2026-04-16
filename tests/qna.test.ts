import { describe, it, beforeAll, expect } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { setupD1, createMockAI, createMockVectorize, createTestSession } from "./setup";
import * as schema from "../worker/src/db/schema";
import { qaRoutes } from "../worker/src/routes/qa";

// ─── Test app builder ─────────────────────────────────────────────────────────

/**
 * Build a minimal Hono app mounting QA routes.
 * Pass `envOverrides` as the third arg to `app.request()` so Hono uses the merged
 * env (mocked AI + Vectorize) while preserving the real DB binding for auth lookups.
 */
function buildQAApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/qa", qaRoutes);
  return app;
}

// ─── Shared fixture state — populated once in the first beforeAll ─────────────

let QNA_COOKIE_A = "";       // signed cookie for User A
let QNA_USER_ID_A = "";      // Better Auth user ID for User A
let QNA_COOKIE_B = "";       // signed cookie for User B
let QNA_USER_B_ROADMAP_ID = "qna-roadmap-user-b";

const QNA_ROADMAP_ID = "qna-roadmap-1";
const QNA_LESSON_ID_1 = `${QNA_ROADMAP_ID}-lesson-node-1`;
const QNA_LESSON_ID_2 = `${QNA_ROADMAP_ID}-lesson-node-2`;

async function seedQnaFixtures() {
  await setupD1();

  // Obtain real signed sessions for both users via Better Auth
  if (!QNA_COOKIE_A) {
    const sessionA = await createTestSession("qna-a@example.com");
    QNA_COOKIE_A = sessionA.cookie;
    QNA_USER_ID_A = sessionA.userId;
  }
  if (!QNA_COOKIE_B) {
    const sessionB = await createTestSession("qna-b@example.com");
    QNA_COOKIE_B = sessionB.cookie;
    const userBId = sessionB.userId;

    // Insert User B's roadmap (inaccessible to User A)
    const db = drizzle(env.DB, { schema });
    const now = new Date();
    await db.insert(schema.roadmaps).values({
      id: QNA_USER_B_ROADMAP_ID,
      userId: userBId,
      title: "User B Roadmap",
      topic: "Python",
      complexity: "linear",
      status: "complete",
      nodesJson: "[]",
      currentStep: 4,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  // Insert User A's roadmap and lessons (idempotent)
  const db = drizzle(env.DB, { schema });
  const now = new Date();

  await db.insert(schema.roadmaps).values({
    id: QNA_ROADMAP_ID,
    userId: QNA_USER_ID_A,
    title: "TypeScript Roadmap",
    topic: "TypeScript",
    complexity: "linear",
    status: "complete",
    nodesJson: JSON.stringify([
      { id: "node-1", title: "TS Basics", order: 0, prerequisites: [] },
      { id: "node-2", title: "TS Advanced", order: 1, prerequisites: [] },
    ]),
    currentStep: 4,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  await db.insert(schema.lessons).values({
    id: QNA_LESSON_ID_1,
    roadmapId: QNA_ROADMAP_ID,
    nodeId: "node-1",
    title: "TypeScript Basics",
    content: "## TypeScript Basics\n\nTypeScript is a typed superset of JavaScript. " +
      "It adds static type checking which helps catch errors at compile time. " +
      "Variables can be annotated with types like string, number, boolean, and more. " +
      "The TypeScript compiler checks these annotations and reports errors before runtime.",
    order: 0,
    createdAt: now,
  }).onConflictDoNothing();

  await db.insert(schema.lessons).values({
    id: QNA_LESSON_ID_2,
    roadmapId: QNA_ROADMAP_ID,
    nodeId: "node-2",
    title: "TypeScript Advanced Types",
    content: "## Advanced Types\n\nTypeScript supports generics, union types, and intersection types. " +
      "Generics allow writing reusable type-safe code. Union types allow a value to be one of " +
      "several types. Intersection types combine multiple types into one.",
    order: 1,
    createdAt: now,
  }).onConflictDoNothing();
}

// ─── QNA-01: In-lesson Q&A with RAG-backed answers ────────────────────────────

describe("QNA-01: In-lesson Q&A with RAG-backed answers", () => {
  beforeAll(async () => { await seedQnaFixtures(); });

  it("POST /api/qa/ask with lessonId scopes Vectorize query to that lesson", async () => {
    let capturedFilter: Record<string, string> | undefined;

    const mockVectorize = {
      upsert: async () => ({ count: 1 }),
      query: async (vector: number[], options: { filter?: Record<string, string> }) => {
        capturedFilter = options.filter;
        return {
          matches: [{
            id: `${QNA_LESSON_ID_1}-chunk-0`,
            score: 0.95,
            metadata: {
              lessonId: QNA_LESSON_ID_1,
              roadmapId: QNA_ROADMAP_ID,
              userId: QNA_USER_ID_A,
              chunkText: "TypeScript is a typed superset of JavaScript.",
              lessonTitle: "TypeScript Basics",
            },
          }],
        };
      },
    };

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "TypeScript is a typed superset of JavaScript." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({
          question: "What is TypeScript?",
          roadmapId: QNA_ROADMAP_ID,
          lessonId: QNA_LESSON_ID_1,
        }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    expect(capturedFilter?.lessonId).toBe(QNA_LESSON_ID_1);
    expect(capturedFilter?.roadmapId).toBe(QNA_ROADMAP_ID);
    expect(capturedFilter?.userId).toBe(QNA_USER_ID_A);
  });

  it("Q&A response includes answer text derived from lesson content", async () => {
    const expectedAnswer = "TypeScript is a typed superset of JavaScript that adds static type checking.";

    const mockVectorize = createMockVectorize([{
      id: `${QNA_LESSON_ID_1}-chunk-0`,
      score: 0.95,
      metadata: {
        lessonId: QNA_LESSON_ID_1,
        roadmapId: QNA_ROADMAP_ID,
        userId: QNA_USER_ID_A,
        chunkText: "TypeScript is a typed superset of JavaScript.",
        lessonTitle: "TypeScript Basics",
      },
    }]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: expectedAnswer };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string; sources: unknown[] };
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.answer).toBe(expectedAnswer);
  });

  it("Q&A response includes sources array with lessonId and title", async () => {
    const mockVectorize = createMockVectorize([{
      id: `${QNA_LESSON_ID_1}-chunk-0`,
      score: 0.92,
      metadata: {
        lessonId: QNA_LESSON_ID_1,
        roadmapId: QNA_ROADMAP_ID,
        userId: QNA_USER_ID_A,
        chunkText: "TypeScript adds static type checking.",
        lessonTitle: "TypeScript Basics",
      },
    }]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "TypeScript adds static type checking to JavaScript." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What does TypeScript add?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string; sources: Array<{ lessonId: string; title: string }> };
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.sources[0].lessonId).toBe(QNA_LESSON_ID_1);
    expect(typeof body.sources[0].title).toBe("string");
    expect(body.sources[0].title).toBe("TypeScript Basics");
  });
});

// ─── QNA-02: Standalone roadmap-level Q&A ────────────────────────────────────

describe("QNA-02: Standalone roadmap-level Q&A", () => {
  beforeAll(async () => { await seedQnaFixtures(); });

  it("POST /api/qa/ask without lessonId scopes to entire roadmap", async () => {
    let capturedFilter: Record<string, string> | undefined;

    const mockVectorize = {
      upsert: async () => ({ count: 1 }),
      query: async (vector: number[], options: { filter?: Record<string, string> }) => {
        capturedFilter = options.filter;
        return { matches: [] };
      },
    };

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "No relevant content found." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    // Without lessonId, filter should have roadmapId + userId but NOT lessonId
    expect(capturedFilter?.roadmapId).toBe(QNA_ROADMAP_ID);
    expect(capturedFilter?.userId).toBe(QNA_USER_ID_A);
    expect(capturedFilter?.lessonId).toBeUndefined();
  });

  it("Q&A can answer questions spanning multiple lessons in the roadmap", async () => {
    const mockVectorize = createMockVectorize([
      {
        id: `${QNA_LESSON_ID_1}-chunk-0`,
        score: 0.9,
        metadata: {
          lessonId: QNA_LESSON_ID_1,
          roadmapId: QNA_ROADMAP_ID,
          userId: QNA_USER_ID_A,
          chunkText: "TypeScript adds static type checking.",
          lessonTitle: "TypeScript Basics",
        },
      },
      {
        id: `${QNA_LESSON_ID_2}-chunk-0`,
        score: 0.85,
        metadata: {
          lessonId: QNA_LESSON_ID_2,
          roadmapId: QNA_ROADMAP_ID,
          userId: QNA_USER_ID_A,
          chunkText: "TypeScript supports generics and union types.",
          lessonTitle: "TypeScript Advanced Types",
        },
      },
    ]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "TypeScript adds static type checking and supports generics." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What are the key features of TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string; sources: Array<{ lessonId: string }> };
    const sourceLessonIds = body.sources.map((s) => s.lessonId);
    expect(sourceLessonIds).toContain(QNA_LESSON_ID_1);
    expect(sourceLessonIds).toContain(QNA_LESSON_ID_2);
  });
});

// ─── QNA-03: AI answers scoped to user's own content ─────────────────────────

describe("QNA-03: AI answers scoped to user's own content", () => {
  beforeAll(async () => { await seedQnaFixtures(); });

  it("POST /api/qa/ask requires authenticated session", async () => {
    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No Cookie header
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: createMockAI({ default: {} }), VECTORIZE: createMockVectorize([]) }
    );

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("Unauthorized");
  });

  it("Vectorize query includes userId metadata filter", async () => {
    let capturedFilter: Record<string, string> | undefined;

    const mockVectorize = {
      upsert: async () => ({ count: 1 }),
      query: async (vector: number[], options: { filter?: Record<string, string> }) => {
        capturedFilter = options.filter;
        return { matches: [] };
      },
    };

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "Answer" };
      },
    };

    const app = buildQAApp();
    await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    // userId must be in the Vectorize filter — prevents cross-user data leaks
    expect(capturedFilter?.userId).toBe(QNA_USER_ID_A);
  });

  it("User A cannot access User B's roadmap content via Q&A", async () => {
    const mockVectorize = createMockVectorize([]);
    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "Answer" };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: QNA_COOKIE_A,  // authenticated as User A
        },
        body: JSON.stringify({
          question: "What is Python?",
          roadmapId: QNA_USER_B_ROADMAP_ID,  // User B's roadmap
        }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    // IDOR check: User A cannot access User B's roadmap — must return 404
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error.toLowerCase()).toContain("not found");
  });
});

// ─── QNA-04: Q&A responses cite source lessons ───────────────────────────────

describe("QNA-04: Q&A responses cite source lessons", () => {
  beforeAll(async () => { await seedQnaFixtures(); });

  it("Response sources array contains lessonId, title, and displayText", async () => {
    const mockVectorize = createMockVectorize([{
      id: `${QNA_LESSON_ID_1}-chunk-0`,
      score: 0.93,
      metadata: {
        lessonId: QNA_LESSON_ID_1,
        roadmapId: QNA_ROADMAP_ID,
        userId: QNA_USER_ID_A,
        chunkText: "TypeScript adds static type checking.",
        lessonTitle: "TypeScript Basics",
      },
    }]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "TypeScript adds static type checking [Lesson: TypeScript Basics]." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What does TypeScript add?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      answer: string;
      sources: Array<{ lessonId: string; title: string; displayText: string }>;
    };

    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBeGreaterThan(0);

    const source = body.sources[0];
    expect(typeof source.lessonId).toBe("string");
    expect(source.lessonId).toBe(QNA_LESSON_ID_1);
    expect(typeof source.title).toBe("string");
    expect(source.title.length).toBeGreaterThan(0);
    expect(typeof source.displayText).toBe("string");
    expect(source.displayText.length).toBeGreaterThan(0);
  });

  it("Citation format matches [Lesson: Title] pattern in answer text", async () => {
    const lessonTitle = "TypeScript Basics";
    const answerWithCitation = `TypeScript is a typed superset of JavaScript [Lesson: ${lessonTitle}].`;

    const mockVectorize = createMockVectorize([{
      id: `${QNA_LESSON_ID_1}-chunk-0`,
      score: 0.93,
      metadata: {
        lessonId: QNA_LESSON_ID_1,
        roadmapId: QNA_ROADMAP_ID,
        userId: QNA_USER_ID_A,
        chunkText: "TypeScript adds static type checking.",
        lessonTitle,
      },
    }]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: answerWithCitation };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { answer: string };
    expect(/\[Lesson:\s*.+\]/.test(body.answer)).toBe(true);
  });

  it("Citation lessonId references an actual lesson in the user's roadmap", async () => {
    const mockVectorize = createMockVectorize([{
      id: `${QNA_LESSON_ID_1}-chunk-0`,
      score: 0.91,
      metadata: {
        lessonId: QNA_LESSON_ID_1,
        roadmapId: QNA_ROADMAP_ID,
        userId: QNA_USER_ID_A,
        chunkText: "TypeScript is a typed superset of JavaScript.",
        lessonTitle: "TypeScript Basics",
      },
    }]);

    const mockAI = {
      run: async (model: string, _options: unknown) => {
        if (model.includes("bge-large")) return { data: [new Array(1024).fill(0.01)] };
        return { response: "TypeScript is a typed superset of JavaScript [Lesson: TypeScript Basics]." };
      },
    };

    const app = buildQAApp();
    const res = await app.request(
      "/api/qa/ask",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: QNA_COOKIE_A },
        body: JSON.stringify({ question: "What is TypeScript?", roadmapId: QNA_ROADMAP_ID }),
      },
      { ...env, AI: mockAI, VECTORIZE: mockVectorize }
    );

    expect(res.status).toBe(200);
    const body = await res.json() as {
      answer: string;
      sources: Array<{ lessonId: string; title: string }>;
    };

    // Every cited lessonId must reference a real lesson belonging to QNA_ROADMAP_ID
    const db = drizzle(env.DB, { schema });
    const lessonRows = await db
      .select({ id: schema.lessons.id, roadmapId: schema.lessons.roadmapId })
      .from(schema.lessons);

    for (const source of body.sources) {
      const lesson = lessonRows.find((l) => l.id === source.lessonId);
      expect(lesson).toBeDefined();
      expect(lesson?.roadmapId).toBe(QNA_ROADMAP_ID);
    }
  });
});
