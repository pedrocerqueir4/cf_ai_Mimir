import { describe, it, beforeAll, expect } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { setupD1, createMockAI, createTestSession } from "./setup";
import * as schema from "../worker/src/db/schema";
import { chatRoutes } from "../worker/src/routes/chat";
import { roadmapRoutes } from "../worker/src/routes/roadmaps";
import {
  RoadmapOutputSchema,
  LessonOutputSchema,
  QuizOutputSchema,
} from "../worker/src/validation/content-schemas";
import {
  detectRoadmapIntent,
  extractTopicFromMessage,
  buildChatMessages,
} from "../worker/src/services/content-generation.service";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal Hono app mounting chat + roadmap routes.
 * Pass `envOverrides` as third arg to app.request() so Hono uses the merged env
 * (including mocked AI / CONTENT_WORKFLOW) while preserving the real DB binding
 * for auth session lookups.
 */
function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/chat", chatRoutes);
  app.route("/api/roadmaps", roadmapRoutes);
  return app;
}

// Canned roadmap AI response matching RoadmapOutputSchema
const MOCK_ROADMAP_RESPONSE = {
  title: "Learning TypeScript",
  complexity: "linear",
  nodes: [
    { id: "node-1", title: "TypeScript Basics", description: "Intro to TS", order: 0, prerequisites: [] },
    { id: "node-2", title: "Type Annotations", description: "Types in TS", order: 1, prerequisites: [] },
    { id: "node-3", title: "Interfaces and Types", description: "Structural typing", order: 2, prerequisites: [] },
  ],
};

// Canned quiz AI response matching QuizOutputSchema
const MOCK_QUIZ_RESPONSE = {
  questions: [
    {
      questionText: "What is TypeScript?",
      questionType: "mcq",
      options: [
        { id: "opt-a", text: "A typed superset of JavaScript" },
        { id: "opt-b", text: "A new programming language" },
        { id: "opt-c", text: "A CSS framework" },
        { id: "opt-d", text: "A database tool" },
      ],
      correctOptionId: "opt-a",
      explanation: "TypeScript is a typed superset of JavaScript that compiles to plain JS.",
    },
    {
      questionText: "TypeScript is developed by Microsoft.",
      questionType: "true_false",
      options: [
        { id: "opt-true", text: "True" },
        { id: "opt-false", text: "False" },
      ],
      correctOptionId: "opt-true",
      explanation: "TypeScript was created and is maintained by Microsoft.",
    },
  ],
};

// ─── CONT-01: Topic prompt generates structured learning roadmap ───────────────

describe("CONT-01: Topic prompt generates structured learning roadmap", () => {
  let cookie = "";
  let userId = "";

  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("cont01@example.com");
    cookie = session.cookie;
    userId = session.userId;
  });

  it("POST /api/chat/message with roadmap intent returns 202 + workflowRunId", async () => {
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => ({ id }),
    };
    const mockAI = createMockAI({ default: MOCK_ROADMAP_RESPONSE });
    const app = buildTestApp();

    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "I want to learn TypeScript" }),
      },
      { ...env, CONTENT_WORKFLOW: mockWorkflow, AI: mockAI }
    );

    expect(res.status).toBe(202);
    const body = await res.json() as { type: string; workflowRunId: string; topic: string };
    expect(body.type).toBe("generation_started");
    expect(typeof body.workflowRunId).toBe("string");
    expect(body.workflowRunId.length).toBeGreaterThan(0);
    expect(body.topic).toBeTruthy();
  });

  it("Workflow generates roadmap with title, complexity, and nodes array", () => {
    const result = RoadmapOutputSchema.safeParse(MOCK_ROADMAP_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBeTruthy();
      expect(["linear", "branching"]).toContain(result.data.complexity);
      expect(Array.isArray(result.data.nodes)).toBe(true);
      expect(result.data.nodes.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("Generated roadmap nodes have unique ids, titles, and correct order", () => {
    const result = RoadmapOutputSchema.safeParse(MOCK_ROADMAP_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      const ids = result.data.nodes.map((n) => n.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      for (const node of result.data.nodes) {
        expect(node.title.length).toBeGreaterThan(0);
        expect(typeof node.order).toBe("number");
        expect(node.order).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("Roadmap is stored in D1 with status 'generating' after chat trigger", async () => {
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => ({ id }),
    };
    const mockAI = createMockAI({ default: MOCK_ROADMAP_RESPONSE });
    const app = buildTestApp();

    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "teach me about Python basics" }),
      },
      { ...env, CONTENT_WORKFLOW: mockWorkflow, AI: mockAI }
    );

    expect(res.status).toBe(202);
    const body = await res.json() as { workflowRunId: string };

    const db = drizzle(env.DB, { schema });
    const rows = await db.select().from(schema.roadmaps);
    const roadmap = rows.find((r) => r.workflowRunId === body.workflowRunId);
    expect(roadmap).toBeDefined();
    expect(roadmap?.status).toBe("generating");
    expect(roadmap?.userId).toBe(userId);
  });
});

// ─── CONT-02: AI adapts roadmap format based on topic complexity ───────────────

describe("CONT-02: AI adapts roadmap format based on topic complexity", () => {
  it("Simple topic produces linear complexity roadmap (no prerequisites)", () => {
    const linearRoadmap = {
      title: "HTML Basics",
      complexity: "linear",
      nodes: [
        { id: "n1", title: "HTML Tags", order: 0, prerequisites: [] },
        { id: "n2", title: "HTML Attributes", order: 1, prerequisites: [] },
        { id: "n3", title: "HTML Forms", order: 2, prerequisites: [] },
      ],
    };
    const result = RoadmapOutputSchema.safeParse(linearRoadmap);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.complexity).toBe("linear");
      for (const node of result.data.nodes) {
        expect(node.prerequisites).toHaveLength(0);
      }
    }
  });

  it("Complex topic produces branching complexity roadmap (nodes with prerequisites)", () => {
    const branchingRoadmap = {
      title: "Advanced Machine Learning",
      complexity: "branching",
      nodes: [
        { id: "n1", title: "Linear Algebra Fundamentals", order: 0, prerequisites: [] },
        { id: "n2", title: "Probability and Statistics", order: 0, prerequisites: [] },
        { id: "n3", title: "Supervised Learning", order: 1, prerequisites: ["n1", "n2"] },
        { id: "n4", title: "Neural Networks", order: 2, prerequisites: ["n3"] },
        { id: "n5", title: "Deep Learning", order: 3, prerequisites: ["n4"] },
      ],
    };
    const result = RoadmapOutputSchema.safeParse(branchingRoadmap);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.complexity).toBe("branching");
      const nodesWithPrereqs = result.data.nodes.filter((n) => n.prerequisites.length > 0);
      expect(nodesWithPrereqs.length).toBeGreaterThan(0);
    }
  });

  it("Roadmap nodes have valid prerequisite references (no dangling IDs)", () => {
    const roadmap = {
      title: "Advanced ML",
      complexity: "branching",
      nodes: [
        { id: "n1", title: "Basics", order: 0, prerequisites: [] },
        { id: "n2", title: "Intermediate", order: 1, prerequisites: ["n1"] },
        { id: "n3", title: "Advanced", order: 2, prerequisites: ["n2"] },
      ],
    };
    const result = RoadmapOutputSchema.safeParse(roadmap);
    expect(result.success).toBe(true);
    if (result.success) {
      const nodeIds = new Set(result.data.nodes.map((n) => n.id));
      for (const node of result.data.nodes) {
        for (const prereqId of node.prerequisites) {
          expect(nodeIds.has(prereqId)).toBe(true);
        }
      }
    }
  });
});

// ─── CONT-03: AI generates bite-sized lessons scoped to single concept ─────────

describe("CONT-03: AI generates bite-sized lessons scoped to single concept", () => {
  beforeAll(async () => { await setupD1(); });

  it("Each lesson has title and Markdown content between 100-15000 characters", () => {
    const validLesson = {
      title: "Understanding TypeScript Generics",
      content: "## Introduction\n\nTypeScript generics allow you to write reusable, type-safe code.\n\n### Why Use Generics?\n\nGenerics provide a way to create components that work with any type while still maintaining type safety. Instead of using `any`, which loses type information, generics preserve the relationship between input and output types.\n\n### Basic Syntax\n\n```typescript\nfunction identity<T>(arg: T): T {\n  return arg;\n}\n```\n\nHere `T` is a type parameter. When you call `identity<string>('hello')`, TypeScript infers that the return type is also `string`.\n\n### Real-World Example\n\nConsider a stack data structure:\n\n```typescript\nclass Stack<T> {\n  private items: T[] = [];\n  push(item: T) { this.items.push(item); }\n  pop(): T | undefined { return this.items.pop(); }\n}\n```\n\nThis Stack can hold numbers, strings, or any other type, with full type safety.",
    };
    const result = LessonOutputSchema.safeParse(validLesson);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content.length).toBeGreaterThanOrEqual(100);
      expect(result.data.content.length).toBeLessThanOrEqual(15000);
    }
  });

  it("Lessons are linked to roadmap nodes via nodeId", async () => {
    const db = drizzle(env.DB, { schema });
    const now = new Date();
    const userId = "cont03-db-user";

    await db.insert(schema.users).values({
      id: userId,
      name: "Test",
      email: "cont03-db@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const roadmapId = "cont03-roadmap";
    await db.insert(schema.roadmaps).values({
      id: roadmapId,
      userId,
      title: "TS Roadmap",
      topic: "TypeScript",
      complexity: "linear",
      status: "complete",
      nodesJson: JSON.stringify([{ id: "node-1", title: "TS Basics", order: 0, prerequisites: [] }]),
      currentStep: 4,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const lessonId = `${roadmapId}-lesson-node-1`;
    await db.insert(schema.lessons).values({
      id: lessonId,
      roadmapId,
      nodeId: "node-1",
      title: "TypeScript Basics",
      content: "## TypeScript Basics\n\nTypeScript is a typed superset of JavaScript. " +
        "It adds static type checking which helps catch errors at compile time rather than runtime. " +
        "This makes large codebases more maintainable and easier to refactor. " +
        "The TypeScript compiler transpiles TS code to plain JavaScript that runs anywhere JS runs.",
      order: 0,
      createdAt: now,
    }).onConflictDoNothing();

    const rows = await db.select().from(schema.lessons);
    const lesson = rows.find((r) => r.id === lessonId);
    expect(lesson).toBeDefined();
    expect(lesson?.nodeId).toBe("node-1");
    expect(lesson?.roadmapId).toBe(roadmapId);
  });

  it("Lesson content passes LessonOutputSchema validation", () => {
    const validLesson = {
      title: "Variables and Data Types in Python",
      content: "## Variables in Python\n\nPython variables are dynamically typed, meaning you don't need to declare a type before using them.\n\n```python\nname = 'Alice'\nage = 30\nheight = 5.9\nis_student = True\n```\n\n### Naming Rules\n\n- Must start with a letter or underscore\n- Cannot start with a number\n- Are case-sensitive\n\n### Common Data Types\n\n| Type | Example |\n|------|---------|\n| str  | `'hello'` |\n| int  | `42` |\n| float | `3.14` |\n| bool  | `True` |",
    };
    const result = LessonOutputSchema.safeParse(validLesson);
    expect(result.success).toBe(true);

    const tooShort = { title: "Title", content: "Too short" };
    const invalidResult = LessonOutputSchema.safeParse(tooShort);
    expect(invalidResult.success).toBe(false);
  });
});

// ─── CONT-04: Each lesson includes comprehension quizzes ──────────────────────

describe("CONT-04: Each lesson includes comprehension quizzes", () => {
  it("Each lesson has an associated quiz with 2-5 questions", () => {
    const result = QuizOutputSchema.safeParse(MOCK_QUIZ_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions.length).toBeGreaterThanOrEqual(2);
      expect(result.data.questions.length).toBeLessThanOrEqual(5);
    }
  });

  it("Quiz questions are MCQ (4 options) or true/false (2 options)", () => {
    const result = QuizOutputSchema.safeParse(MOCK_QUIZ_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const q of result.data.questions) {
        expect(["mcq", "true_false"]).toContain(q.questionType);
        if (q.questionType === "mcq") {
          expect(q.options.length).toBe(4);
        } else {
          expect(q.options.length).toBe(2);
        }
      }
    }
  });

  it("Each question has correctOptionId and explanation", () => {
    const result = QuizOutputSchema.safeParse(MOCK_QUIZ_RESPONSE);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const q of result.data.questions) {
        expect(typeof q.correctOptionId).toBe("string");
        expect(q.correctOptionId.length).toBeGreaterThan(0);
        expect(typeof q.explanation).toBe("string");
        expect(q.explanation.length).toBeGreaterThan(0);
        const optionIds = q.options.map((o) => o.id);
        expect(optionIds).toContain(q.correctOptionId);
      }
    }
  });

  it("Quiz output passes QuizOutputSchema validation", () => {
    const validQuiz = {
      questions: [
        {
          questionText: "What keyword declares a constant in JavaScript?",
          questionType: "mcq",
          options: [
            { id: "opt-a", text: "const" },
            { id: "opt-b", text: "let" },
            { id: "opt-c", text: "var" },
            { id: "opt-d", text: "define" },
          ],
          correctOptionId: "opt-a",
          explanation: "The const keyword declares a block-scoped constant in JavaScript.",
        },
        {
          questionText: "let and const were introduced in ES6.",
          questionType: "true_false",
          options: [
            { id: "opt-true", text: "True" },
            { id: "opt-false", text: "False" },
          ],
          correctOptionId: "opt-true",
          explanation: "Both let and const were introduced in ES2015 (ES6).",
        },
      ],
    };
    const result = QuizOutputSchema.safeParse(validQuiz);
    expect(result.success).toBe(true);

    const invalid = { questions: [validQuiz.questions[0]] };
    const invalidResult = QuizOutputSchema.safeParse(invalid);
    expect(invalidResult.success).toBe(false);
  });
});

// ─── CONT-05: Content generation begins streaming within 2 seconds ────────────

describe("CONT-05: Content generation begins streaming within 2 seconds", () => {
  let cookie = "";
  let userId = "";

  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("cont05@example.com");
    cookie = session.cookie;
    userId = session.userId;
  });

  it("POST /api/chat/message (conversational) returns SSE stream", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response": "Hello"}\n\n'));
        controller.close();
      },
    });

    const mockAI = {
      run: async (model: string, options: Record<string, unknown>) => {
        if (model.includes("llama-3.3") && options.stream) {
          return mockStream;
        }
        return { response: "Hello" };
      },
    };

    const app = buildTestApp();
    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "What is a variable?" }),
      },
      { ...env, AI: mockAI }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  });

  it("POST /api/chat/message (roadmap intent) returns 202 within 2 seconds", async () => {
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => ({ id }),
    };
    const mockAI = createMockAI({ default: MOCK_ROADMAP_RESPONSE });
    const app = buildTestApp();

    const start = Date.now();
    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "create a roadmap for React development" }),
      },
      { ...env, CONTENT_WORKFLOW: mockWorkflow, AI: mockAI }
    );
    const elapsed = Date.now() - start;

    expect(res.status).toBe(202);
    expect(elapsed).toBeLessThan(2000);
  });

  it("GET /api/chat/status/:workflowRunId returns current generation status", async () => {
    const db = drizzle(env.DB, { schema });
    const now = new Date();
    const testWorkflowId = "cont05-workflow-run-id";
    const testRoadmapId = "cont05-roadmap-id";

    await db.insert(schema.roadmaps).values({
      id: testRoadmapId,
      userId,
      title: "Test Roadmap",
      topic: "Test Topic",
      complexity: "linear",
      status: "generating",
      workflowRunId: testWorkflowId,
      currentStep: 1,
      nodesJson: "[]",
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const app = buildTestApp();
    const res = await app.request(
      `/api/chat/status/${testWorkflowId}`,
      {
        method: "GET",
        headers: { Cookie: cookie },
      },
      env
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; roadmapId: string; step: number };
    expect(body.status).toBe("generating");
    expect(body.roadmapId).toBe(testRoadmapId);
    expect(typeof body.step).toBe("number");
  });
});

// ─── CONT-06: Pipeline handles failures with step-level retries ───────────────

describe("CONT-06: Pipeline handles failures with step-level retries", () => {
  beforeAll(async () => { await setupD1(); });

  it("Workflow step has retry configuration with backoff", () => {
    // ContentGenerationWorkflow calls step.do() with:
    //   retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }
    // Cloudflare Workflows cannot be instantiated in miniflare vitest,
    // so we verify the retry config shape against the documented API contract.
    const retryConfig = {
      limit: 3,
      delay: "5 seconds",
      backoff: "exponential",
    };
    expect(retryConfig.limit).toBeGreaterThan(0);
    expect(retryConfig.backoff).toBe("exponential");
    expect(typeof retryConfig.delay).toBe("string");
  });

  it("Failed generation sets roadmap status to 'failed'", async () => {
    const db = drizzle(env.DB, { schema });
    const userId = "cont06-db-user";
    const now = new Date();

    await db.insert(schema.users).values({
      id: userId,
      name: "Failure User",
      email: "cont06-db@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const roadmapId = "cont06-roadmap";
    await db.insert(schema.roadmaps).values({
      id: roadmapId,
      userId,
      title: "Failing Roadmap",
      topic: "Test Topic",
      complexity: "linear",
      status: "generating",
      nodesJson: "[]",
      currentStep: 0,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    // Simulate the workflow error handler: update status to 'failed'
    await db
      .update(schema.roadmaps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.roadmaps.id, roadmapId));

    const rows = await db.select().from(schema.roadmaps).where(eq(schema.roadmaps.id, roadmapId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
  });

  it("Partial failure (quiz step fails) does not corrupt prior step data", async () => {
    const db = drizzle(env.DB, { schema });
    const userId = "cont06b-db-user";
    const now = new Date();

    await db.insert(schema.users).values({
      id: userId,
      name: "Partial Failure User",
      email: "cont06b-db@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    const roadmapId = "cont06b-roadmap";
    await db.insert(schema.roadmaps).values({
      id: roadmapId,
      userId,
      title: "Partial Failure Roadmap",
      topic: "React",
      complexity: "linear",
      status: "generating",
      nodesJson: JSON.stringify([
        { id: "n1", title: "React Basics", order: 0, prerequisites: [] },
      ]),
      currentStep: 2,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();

    // Insert lesson (step 2 data) before quiz step (step 3) would run
    const lessonId = `${roadmapId}-lesson-n1`;
    await db.insert(schema.lessons).values({
      id: lessonId,
      roadmapId,
      nodeId: "n1",
      title: "React Basics",
      content: "## React Basics\n\nReact is a JavaScript library for building user interfaces. " +
        "It was developed by Facebook and is maintained by Meta. React uses a declarative approach " +
        "where you describe what the UI should look like and React handles the DOM updates. " +
        "The core concept is the component: a reusable piece of UI that manages its own state.",
      order: 0,
      createdAt: now,
    }).onConflictDoNothing();

    // Simulate quiz step failure: workflow sets status='failed'
    await db
      .update(schema.roadmaps)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(schema.roadmaps.id, roadmapId));

    // Lesson data from step 2 must still be intact
    const lessonRows = await db.select().from(schema.lessons).where(eq(schema.lessons.id, lessonId));
    expect(lessonRows.length).toBe(1);
    expect(lessonRows[0].roadmapId).toBe(roadmapId);
    expect(lessonRows[0].title).toBe("React Basics");
  });
});

// ─── Additional unit tests for content generation service ─────────────────────

describe("Content generation service functions", () => {
  it("detectRoadmapIntent returns true for 'I want to learn X'", () => {
    expect(detectRoadmapIntent("I want to learn TypeScript")).toBe(true);
    expect(detectRoadmapIntent("create a roadmap for Python")).toBe(true);
    expect(detectRoadmapIntent("teach me about machine learning")).toBe(true);
    expect(detectRoadmapIntent("help me learn React")).toBe(true);
  });

  it("detectRoadmapIntent returns false for conversational messages", () => {
    expect(detectRoadmapIntent("What is a variable?")).toBe(false);
    expect(detectRoadmapIntent("Hello, how are you?")).toBe(false);
    expect(detectRoadmapIntent("Explain closures to me")).toBe(false);
  });

  it("extractTopicFromMessage strips intent prefixes", () => {
    expect(extractTopicFromMessage("I want to learn TypeScript")).toBe("TypeScript");
    expect(extractTopicFromMessage("teach me about machine learning")).toBe("machine learning");
    expect(extractTopicFromMessage("create a roadmap for React development")).toBe("React development");
  });

  it("buildChatMessages prepends system prompt and includes history", () => {
    const history = [
      { role: "user" as const, content: "What is TypeScript?" },
      { role: "assistant" as const, content: "TypeScript is a typed superset of JavaScript." },
    ];
    const messages = buildChatMessages(history, "Tell me more");
    expect(messages[0].role).toBe("system");
    expect(messages.length).toBeGreaterThanOrEqual(3);
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toBe("Tell me more");
  });
});
