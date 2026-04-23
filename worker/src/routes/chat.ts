import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, desc, lt } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { sanitize } from "../middleware/sanitize";
import {
  detectRoadmapIntent,
  buildChatMessages,
  extractTopicFromMessage,
} from "../services/content-generation.service";

export const chatRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Apply auth to all chat routes
chatRoutes.use("/*", authGuard);

// Max messages returned per GET page. The UX contract is "last 50, scroll up
// for older"; we accept ?limit= up to PAGE_MAX_LIMIT but default to PAGE_DEFAULT_LIMIT.
const PAGE_DEFAULT_LIMIT = 50;
const PAGE_MAX_LIMIT = 100;

// POST /message — Send a chat message (SSE stream or workflow trigger)
chatRoutes.post("/message", sanitize, async (c) => {
  const userId = c.get("userId");
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

    // Trigger Cloudflare Workflow asynchronously
    // Pass a known ID so the Workflow can store it as workflowRunId in D1
    const workflowId = crypto.randomUUID();
    const instance = await c.env.CONTENT_WORKFLOW.create({
      id: workflowId,
      params: { topic, userId, conversationId, workflowRunId: workflowId },
    });

    // Persist assistant acknowledgment message
    await db.insert(schema.chatMessages).values({
      id: crypto.randomUUID(),
      userId,
      conversationId,
      role: "assistant",
      content: JSON.stringify({
        type: "generation_started",
        workflowRunId: instance.id,
        topic,
      }),
      createdAt: new Date(now.getTime() + 1),
    });

    return c.json(
      { type: "generation_started", workflowRunId: instance.id, topic, conversationId },
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
  const aiStream = (await c.env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    { messages, stream: true } as any
  )) as unknown as ReadableStream<Uint8Array>;

  // Tee the AI stream: one branch flows to the client, the other is consumed
  // server-side via waitUntil so we can persist the assembled assistant reply
  // to D1 AFTER the client disconnects. This is the last-mile write that
  // "chat history not persistent" was missing for plain-Q&A replies.
  //
  // Safety notes:
  // - We insert exactly ONCE, after the stream closes. Mid-stream failures
  //   abort the persistence branch without writing a partial reply.
  // - createdAt is stamped at insertion time (not `now`) so it always sorts
  //   AFTER the user message.
  // - If parsing an SSE chunk fails we fall back to accumulating raw text —
  //   this mirrors the frontend's own SSE reader behavior so the persisted
  //   content matches what the user saw.
  const [clientStream, persistStream] = aiStream.tee();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const reader = persistStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assembled = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as { response?: string; text?: string };
              const token = parsed.response ?? parsed.text;
              if (token) assembled += token;
            } catch {
              // Non-JSON chunk — treat as raw text (mirrors client reader fallback)
              assembled += data;
            }
          }
        }

        // Flush any trailing buffered fragment
        if (buffer.startsWith("data: ")) {
          const data = buffer.slice(6).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as { response?: string; text?: string };
              const token = parsed.response ?? parsed.text;
              if (token) assembled += token;
            } catch {
              assembled += data;
            }
          }
        }

        const trimmed = assembled.trim();
        if (trimmed.length === 0) return;

        await db.insert(schema.chatMessages).values({
          id: crypto.randomUUID(),
          userId,
          conversationId,
          role: "assistant",
          content: trimmed,
          // +2ms so it sorts strictly after both the user message (+0) and
          // any roadmap ack (+1) that might share the same second.
          createdAt: new Date(now.getTime() + 2),
        });
      } catch {
        // Swallow — never let a persistence failure surface to the client
        // since the stream itself already succeeded from the client's POV.
        // The worst-case cost is one orphan user message without its reply;
        // on the next reload the user still sees everything they saw live.
      }
    })()
  );

  return new Response(clientStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Conversation-Id": conversationId,
    },
  });
});

// GET /conversations — List user's conversations with latest message preview
chatRoutes.get("/conversations", async (c) => {
  const userId = c.get("userId");
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

// GET /conversations/:conversationId/messages — Cursor-paginated history.
// Query params:
//   ?before=<ISO timestamp> — return messages strictly older than this.
//     Omit for the first page (returns the most recent `limit` messages).
//   ?limit=<n> — default 50, max 100.
// Response:
//   { messages: ChatMessage[], hasMore: boolean, nextCursor: string | null }
// Messages are returned in CHRONOLOGICAL order (oldest first in the page) so
// the client can prepend older pages to the top of the list without re-sorting.
chatRoutes.get("/conversations/:conversationId/messages", async (c) => {
  const userId = c.get("userId");
  const { conversationId } = c.req.param();
  const beforeParam = c.req.query("before");
  const limitParam = c.req.query("limit");
  const db = drizzle(c.env.DB, { schema });

  // Parse & clamp limit
  let limit = PAGE_DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      limit = Math.min(parsed, PAGE_MAX_LIMIT);
    }
  }

  // Parse cursor (optional)
  let beforeDate: Date | null = null;
  if (beforeParam) {
    const parsed = new Date(beforeParam);
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: "Invalid 'before' cursor (must be ISO-8601)" }, 400);
    }
    beforeDate = parsed;
  }

  // IDOR: verify this conversation belongs to the user.
  // We check with a scoped LIMIT 1 rather than a JOIN/EXISTS so we don't
  // pull extra rows; composite index covers the lookup.
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

  // Fetch newest-first, limit+1 to detect hasMore without a second query.
  const whereClause = beforeDate
    ? and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId),
        lt(schema.chatMessages.createdAt, beforeDate)
      )
    : and(
        eq(schema.chatMessages.conversationId, conversationId),
        eq(schema.chatMessages.userId, userId)
      );

  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(whereClause)
    .orderBy(desc(schema.chatMessages.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  // Oldest of the current page becomes the next cursor (if more exist).
  const nextCursor =
    hasMore && pageRows.length > 0
      ? pageRows[pageRows.length - 1].createdAt.toISOString()
      : null;

  // Return in chronological order (oldest first) for easy prepend on the client.
  const chronological = pageRows.slice().reverse();

  return c.json({
    messages: chronological,
    hasMore,
    nextCursor,
  });
});

// GET /status/:workflowRunId — Poll workflow generation status.
// Response shape (consumed by apps/web/.../api-client.ts GenerationStatus and
// _app.chat.tsx GenerationProgressBubble):
//   { status: "generating" | "complete" | "failed",
//     roadmapId: string,
//     step: 1 | 2 | 3 }
// `step` drives the 3-icon progress bubble:
//   1 = roadmap structure persisted, lessons generating (icon 1 active)
//   2 = lessons done, quizzes+embeddings running        (icon 2 active)
//   3 = generation wrap-up                              (icon 3 active)
// When `status === "complete"` the UI ignores `step` and shows the
// "View roadmap" button; when `status === "failed"` it shows the error state.
// Clamped to [1,3] because older rows (pre-migration-0002 or mid-deploy)
// may read `current_step = 0` and would otherwise yield activeStep = -1.
chatRoutes.get("/status/:workflowRunId", async (c) => {
  const userId = c.get("userId");
  const { workflowRunId } = c.req.param();
  const db = drizzle(c.env.DB, { schema });

  // Find roadmap by workflowRunId, scoped to current user (IDOR prevention)
  const roadmap = await db
    .select({
      id: schema.roadmaps.id,
      status: schema.roadmaps.status,
      currentStep: schema.roadmaps.currentStep,
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

  // Clamp into the [1,3] range the UI knows how to render. `currentStep`
  // can legitimately be 0 on rows that existed before ContentGenerationWorkflow
  // started writing to the column — treating those as "at least step 1" is
  // safe: they either complete shortly (status flips to 'complete' and the
  // bubble skips to success state) or they fail (status='failed' → error state).
  const rawStep = roadmap[0].currentStep ?? 0;
  const step = Math.max(1, Math.min(3, rawStep || 1));

  return c.json({
    status: roadmap[0].status,
    roadmapId: roadmap[0].id,
    step,
  });
});
