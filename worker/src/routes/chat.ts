import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard } from "../middleware/auth-guard";
import { sanitize } from "../middleware/sanitize";
import {
  detectRoadmapIntent,
  buildChatMessages,
  extractTopicFromMessage,
} from "../services/content-generation.service";
import {
  RoadmapOutputSchema,
  LessonOutputSchema,
  QuizOutputSchema,
} from "../validation/content-schemas";
import {
  buildRoadmapSystemPrompt,
  buildLessonSystemPrompt,
  buildQuizSystemPrompt,
  ROADMAP_JSON_SCHEMA,
  LESSON_JSON_SCHEMA,
  QUIZ_JSON_SCHEMA,
} from "../validation/roadmap-prompts";

export const chatRoutes = new Hono<{ Bindings: Env }>();

// Apply auth to all chat routes
chatRoutes.use("/*", authGuard);

// POST /message — Send a chat message (SSE stream or workflow trigger)
chatRoutes.post("/message", sanitize, async (c) => {
  const userId = c.get("userId") as string;
  const db = drizzle(c.env.DB, { schema });

  let body: { message?: string; conversationId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { message, conversationId: existingConvId } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return c.json({ error: "message is required" }, 400);
  }

  if (message.trim().length > 4000) {
    return c.json({ error: "message too long (max 4000 characters)" }, 400);
  }

  const conversationId = existingConvId ?? crypto.randomUUID();
  const trimmedMessage = message.trim();
  const now = new Date();

  // Persist user message
  await db.insert(schema.chatMessages).values({
    id: crypto.randomUUID(),
    userId,
    conversationId,
    role: "user",
    content: trimmedMessage,
    createdAt: now,
  });

  // Detect roadmap generation intent
  if (detectRoadmapIntent(trimmedMessage)) {
    const topic = extractTopicFromMessage(trimmedMessage);
    const roadmapId = crypto.randomUUID();

    // Try Cloudflare Workflow first; fall back to inline generation for local dev
    let workflowRunId: string;
    try {
      const instance = await c.env.CONTENT_WORKFLOW.create({
        params: { topic, userId, conversationId },
      });
      workflowRunId = instance.id;
    } catch {
      // Workflow binding unavailable in local dev — run inline generation
      workflowRunId = `local-${roadmapId}`;
      // Fire-and-forget inline generation
      c.executionCtx.waitUntil(
        generateRoadmapInline(c.env, topic, userId, roadmapId)
      );
    }

    // Persist assistant acknowledgment message
    await db.insert(schema.chatMessages).values({
      id: crypto.randomUUID(),
      userId,
      conversationId,
      role: "assistant",
      content: JSON.stringify({
        type: "generation_started",
        workflowRunId,
        topic,
      }),
      createdAt: new Date(now.getTime() + 1),
    });

    return c.json(
      { type: "generation_started", workflowRunId, topic, conversationId },
      202
    );
  }

  // Conversational reply — stream SSE
  const history = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.userId, userId),
        eq(schema.chatMessages.conversationId, conversationId)
      )
    )
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(20);

  // Reverse to chronological order (oldest first)
  const chronological = history.reverse();

  // Build messages for AI (exclude the message just inserted to avoid duplication)
  const priorHistory = chronological
    .filter((m) => !(m.role === "user" && m.content === trimmedMessage && m.createdAt.getTime() === now.getTime()))
    .slice(-20)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const messages = buildChatMessages(priorHistory, trimmedMessage);

  // NOTE: No response_format here — streaming is incompatible with structured output
  const aiStream = await c.env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    { messages, stream: true } as Parameters<typeof c.env.AI.run>[1]
  );

  return new Response(aiStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": conversationId,
    },
  });
});

// GET /conversations — List user's conversations with latest message preview
chatRoutes.get("/conversations", async (c) => {
  const userId = c.get("userId") as string;
  const db = drizzle(c.env.DB, { schema });

  // Fetch all messages for user, ordered newest first
  const messages = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.userId, userId))
    .orderBy(desc(schema.chatMessages.createdAt));

  // Group by conversationId — derive latest message timestamp and preview per conversation
  const conversationMap = new Map<
    string,
    { lastMessageAt: Date; preview: string }
  >();

  for (const msg of messages) {
    if (!conversationMap.has(msg.conversationId)) {
      conversationMap.set(msg.conversationId, {
        lastMessageAt: msg.createdAt,
        preview: msg.content.slice(0, 100),
      });
    }
  }

  const conversations = Array.from(conversationMap.entries()).map(
    ([conversationId, { lastMessageAt, preview }]) => ({
      conversationId,
      lastMessageAt,
      preview,
    })
  );

  return c.json(conversations);
});

// GET /conversations/:conversationId/messages — Get messages for a specific conversation
chatRoutes.get("/conversations/:conversationId/messages", async (c) => {
  const userId = c.get("userId") as string;
  const { conversationId } = c.req.param();
  const db = drizzle(c.env.DB, { schema });

  // IDOR: verify this conversation belongs to the user
  const ownerCheck = await db
    .select({ id: schema.chatMessages.id })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId)
      )
    )
    .limit(1);

  if (ownerCheck.length === 0) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  const messages = await db
    .select()
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId)
      )
    )
    .orderBy(schema.chatMessages.createdAt);

  return c.json(messages);
});

// GET /status/:workflowRunId — Poll workflow generation status
chatRoutes.get("/status/:workflowRunId", async (c) => {
  const userId = c.get("userId") as string;
  const { workflowRunId } = c.req.param();
  const db = drizzle(c.env.DB, { schema });

  // Find roadmap by workflowRunId, scoped to current user (IDOR prevention)
  const roadmap = await db
    .select({
      id: schema.roadmaps.id,
      status: schema.roadmaps.status,
    })
    .from(schema.roadmaps)
    .where(
      and(
        eq(schema.roadmaps.workflowRunId, workflowRunId),
        eq(schema.roadmaps.userId, userId)
      )
    )
    .limit(1);

  if (roadmap.length === 0) {
    return c.json({ error: "Workflow not found" }, 404);
  }

  return c.json({
    status: roadmap[0].status,
    roadmapId: roadmap[0].id,
  });
});

// ─── Inline generation fallback (local dev — Workflows unavailable) ──────────

async function generateRoadmapInline(
  env: Env,
  topic: string,
  userId: string,
  roadmapId: string,
) {
  const db = drizzle(env.DB, { schema });

  try {
    // Step 1: Generate roadmap structure
    const aiResponse = await env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: buildRoadmapSystemPrompt() },
          { role: "user", content: `Create a learning roadmap for: ${topic}` },
        ],
        response_format: { type: "json_schema", json_schema: ROADMAP_JSON_SCHEMA },
      } as Parameters<typeof env.AI.run>[1],
    );

    const rawText =
      typeof aiResponse === "string"
        ? aiResponse
        : (aiResponse as { response?: string }).response ?? JSON.stringify(aiResponse);

    const validated = RoadmapOutputSchema.parse(JSON.parse(rawText));
    const now = new Date();

    await db.insert(schema.roadmaps).values({
      id: roadmapId,
      userId,
      title: validated.title,
      topic,
      complexity: validated.complexity,
      status: "generating",
      workflowRunId: `local-${roadmapId}`,
      nodesJson: JSON.stringify(validated.nodes),
      createdAt: now,
      updatedAt: now,
    });

    // Step 2: Generate lessons for each node
    const nodes = validated.nodes;
    const lessonIds: string[] = [];

    for (const node of nodes) {
      const lessonId = `${roadmapId}-lesson-${node.id}`;

      const lessonResponse = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            { role: "system", content: buildLessonSystemPrompt(topic, node.title, node.description ?? "") },
            { role: "user", content: `Write the lesson for: ${node.title}` },
          ],
          response_format: { type: "json_schema", json_schema: LESSON_JSON_SCHEMA },
        } as Parameters<typeof env.AI.run>[1],
      );

      const lessonRaw =
        typeof lessonResponse === "string"
          ? lessonResponse
          : (lessonResponse as { response?: string }).response ?? JSON.stringify(lessonResponse);

      const lessonValidated = LessonOutputSchema.parse(JSON.parse(lessonRaw));

      await db.insert(schema.lessons).values({
        id: lessonId,
        roadmapId,
        nodeId: node.id,
        title: lessonValidated.title,
        content: lessonValidated.content,
        order: node.order,
        createdAt: new Date(),
      }).onConflictDoNothing();

      lessonIds.push(lessonId);
    }

    // Step 3: Generate quizzes for each lesson
    for (const lessonId of lessonIds) {
      const lessonRows = await db.select().from(schema.lessons).where(eq(schema.lessons.id, lessonId)).limit(1);
      if (lessonRows.length === 0) continue;
      const lesson = lessonRows[0];

      const quizResponse = await env.AI.run(
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        {
          messages: [
            { role: "system", content: buildQuizSystemPrompt(lesson.content) },
            { role: "user", content: "Generate comprehension quiz questions for this lesson." },
          ],
          response_format: { type: "json_schema", json_schema: QUIZ_JSON_SCHEMA },
        } as Parameters<typeof env.AI.run>[1],
      );

      const quizRaw =
        typeof quizResponse === "string"
          ? quizResponse
          : (quizResponse as { response?: string }).response ?? JSON.stringify(quizResponse);

      const quizValidated = QuizOutputSchema.parse(JSON.parse(quizRaw));
      const quizId = `${lessonId}-quiz`;

      await db.insert(schema.quizzes).values({
        id: quizId,
        lessonId,
        createdAt: new Date(),
      }).onConflictDoNothing();

      for (let i = 0; i < quizValidated.questions.length; i++) {
        const q = quizValidated.questions[i];
        await db.insert(schema.quizQuestions).values({
          id: `${quizId}-q${i}`,
          quizId,
          questionText: q.questionText,
          questionType: q.questionType,
          optionsJson: JSON.stringify(q.options),
          correctOptionId: q.correctOptionId,
          explanation: q.explanation,
          order: i,
        }).onConflictDoNothing();
      }
    }

    // Step 4: Skip embeddings in local dev (Vectorize not available locally)
    // Mark roadmap complete
    await db.update(schema.roadmaps)
      .set({ status: "complete", updatedAt: new Date() })
      .where(eq(schema.roadmaps.id, roadmapId));

    console.log(`[DEV] Inline roadmap generation complete: ${roadmapId}`);
  } catch (error) {
    console.error("[DEV] Inline generation failed:", error);
    try {
      await db.update(schema.roadmaps)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(schema.roadmaps.id, roadmapId));
    } catch { /* best effort */ }
  }
}
