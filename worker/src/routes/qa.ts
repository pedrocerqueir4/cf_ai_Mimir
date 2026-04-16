import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { sanitize } from "../middleware/sanitize";
import { verifyOwnership } from "../middleware/idor-check";

export const qaRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Apply auth to all QA routes
qaRoutes.use("/*", authGuard);

// POST /ask — Ask a question with RAG-backed answer and citation sources
qaRoutes.post("/ask", sanitize, async (c) => {
  const userId = c.get("userId");
  const db = drizzle(c.env.DB, { schema });

  let body: { question?: string; roadmapId?: string; lessonId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { question, roadmapId, lessonId } = body;

  if (!question || typeof question !== "string" || question.trim().length === 0) {
    return c.json({ error: "question is required" }, 400);
  }

  if (!roadmapId || typeof roadmapId !== "string") {
    return c.json({ error: "roadmapId is required" }, 400);
  }

  if (question.trim().length > 1000) {
    return c.json({ error: "question too long (max 1000 characters)" }, 400);
  }

  // IDOR: verify the roadmap belongs to the current user (QNA-03)
  const roadmap = await verifyOwnership(
    db as any,
    schema.roadmaps,
    roadmapId,
    userId,
    schema.roadmaps.id,
    schema.roadmaps.userId
  );

  if (!roadmap) {
    return c.json({ error: "Roadmap not found" }, 404);
  }

  const trimmedQuestion = question.trim();

  // Step 1: Embed the question using bge-large-en-v1.5 (1024-dimensional)
  const embeddingResult = await c.env.AI.run("@cf/baai/bge-large-en-v1.5", {
    text: [trimmedQuestion],
  } as any);

  const embedding = (embeddingResult as { data: number[][] }).data[0];

  if (!embedding || embedding.length === 0) {
    return c.json({ error: "Failed to generate question embedding" }, 500);
  }

  // Step 2: Query Vectorize with metadata filter scoped to user + roadmap (QNA-03)
  // Optionally scope to specific lesson if provided
  const vectorizeFilter: Record<string, string> = {
    roadmapId,
    userId,
  };

  if (lessonId && typeof lessonId === "string") {
    vectorizeFilter.lessonId = lessonId;
  }

  const queryResult = await c.env.VECTORIZE.query(embedding, {
    topK: 5,
    returnMetadata: "all",
    filter: vectorizeFilter,
  });

  const matches = queryResult.matches ?? [];

  // Step 3: Fetch lesson titles from D1 for citation building (QNA-04)
  const citedLessonIds = [
    ...new Set(
      matches
        .map((m) => (m.metadata as Record<string, string> | undefined)?.lessonId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];

  let lessonData: Array<{ id: string; title: string; order: number }> = [];
  if (citedLessonIds.length > 0) {
    lessonData = await db
      .select({ id: schema.lessons.id, title: schema.lessons.title, order: schema.lessons.order })
      .from(schema.lessons)
      .where(inArray(schema.lessons.id, citedLessonIds));
  }

  const lessonMap = new Map(lessonData.map((l) => [l.id, { title: l.title, order: l.order }]));

  // Step 4: Build context string from matched chunks
  const contextChunks = matches.map((match, index) => {
    const meta = (match.metadata as Record<string, string> | undefined) ?? {};
    const lessonTitle = lessonMap.get(meta.lessonId ?? "")?.title ?? "Unknown Lesson";
    const chunkText = meta.chunkText ?? meta.text ?? "";
    return `[Source ${index + 1}: ${lessonTitle}]\n${chunkText}`;
  });

  const contextString = contextChunks.join("\n\n---\n\n");

  // Step 5: Generate answer grounded in context
  const systemPrompt = contextString
    ? `You are Mimir, a learning assistant. Answer the user's question based ONLY on the provided context from their learning materials. Reference lessons by their title using [Lesson: Title] format. If the context doesn't contain relevant information to answer the question, clearly say so — do not make up information.\n\nContext from learning materials:\n${contextString}`
    : "You are Mimir, a learning assistant. The user's question could not be matched to any learning content. Politely let them know that no relevant content was found in their learning materials for this roadmap.";

  const aiResponse = await c.env.AI.run(
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: trimmedQuestion },
      ],
    } as any
  );

  const answer = (aiResponse as { response?: string }).response ?? "";

  // Step 6: Build citation sources for frontend rendering (QNA-04, D-15)
  const citations = citedLessonIds.map((lId) => ({
    lessonId: lId,
    lessonTitle: lessonMap.get(lId)?.title ?? "Unknown Lesson",
    lessonOrder: lessonMap.get(lId)?.order ?? 0,
  }));

  return c.json({ answer, citations });
});
