import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, count, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { sanitize } from "../middleware/sanitize";
import { verifyOwnership } from "../middleware/idor-check";
import {
  LESSON_XP_LINEAR,
  LESSON_XP_BRANCHING,
  QUIZ_XP_PER_CORRECT,
  STREAK_BONUS_XP,
  computeLevel,
  updateStreak,
} from "../lib/xp";

export const roadmapRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// Apply auth to all roadmap routes
roadmapRoutes.use("/*", authGuard);

// GET / — List user's roadmaps with progress counts
roadmapRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = drizzle(c.env.DB, { schema });

  const userRoadmaps = await db
    .select()
    .from(schema.roadmaps)
    .where(eq(schema.roadmaps.userId, userId))
    .orderBy(sql`${schema.roadmaps.createdAt} DESC`);

  // For each roadmap, compute lesson counts and completion stats
  const results = await Promise.all(
    userRoadmaps.map(async (roadmap) => {
      const totalResult = await db
        .select({ count: count() })
        .from(schema.lessons)
        .where(eq(schema.lessons.roadmapId, roadmap.id));

      const completedResult = await db
        .select({ count: count() })
        .from(schema.lessonCompletions)
        .innerJoin(schema.lessons, eq(schema.lessonCompletions.lessonId, schema.lessons.id))
        .where(
          and(
            eq(schema.lessons.roadmapId, roadmap.id),
            eq(schema.lessonCompletions.userId, userId)
          )
        );

      return {
        id: roadmap.id,
        title: roadmap.title,
        topic: roadmap.topic,
        complexity: roadmap.complexity,
        status: roadmap.status,
        totalLessons: totalResult[0]?.count ?? 0,
        completedLessons: completedResult[0]?.count ?? 0,
        createdAt: roadmap.createdAt,
      };
    })
  );

  return c.json(results);
});

// GET /:id — Get roadmap detail with nodes and completion state
roadmapRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const roadmapId = c.req.param("id");
  const db = drizzle(c.env.DB, { schema });

  // IDOR: verify ownership before returning any data
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

  // Fetch all completed lessonIds for this user on this roadmap
  const completions = await db
    .select({ lessonId: schema.lessonCompletions.lessonId })
    .from(schema.lessonCompletions)
    .innerJoin(schema.lessons, eq(schema.lessonCompletions.lessonId, schema.lessons.id))
    .where(
      and(
        eq(schema.lessons.roadmapId, roadmapId),
        eq(schema.lessonCompletions.userId, userId)
      )
    );

  const completedLessonIds = completions.map((c) => c.lessonId);

  const typedRoadmap = roadmap as typeof schema.roadmaps.$inferSelect;

  let rawNodes: Array<{
    id: string;
    title: string;
    description?: string;
    order: number;
    prerequisites: string[];
  }> = [];
  try {
    rawNodes = JSON.parse(typedRoadmap.nodesJson);
  } catch {
    rawNodes = [];
  }

  // Build a set of completed lesson IDs for O(1) lookup
  const completedSet = new Set(completedLessonIds);

  // Enrich nodes with state, lessonId, parentId, children
  const enrichedNodes = rawNodes.map((node) => {
    // Deterministic lessonId matching ContentGenerationWorkflow
    const lessonId = `${roadmapId}-lesson-${node.id}`;

    // Compute state
    let state: "locked" | "available" | "in_progress" | "completed" = "available";

    if (completedSet.has(lessonId)) {
      state = "completed";
    } else if (node.prerequisites.length > 0) {
      // Branching: check all prerequisites are completed
      const allPrereqsComplete = node.prerequisites.every((prereqId) => {
        const prereqLessonId = `${roadmapId}-lesson-${prereqId}`;
        return completedSet.has(prereqLessonId);
      });
      state = allPrereqsComplete ? "available" : "locked";
    } else if (node.order > 0) {
      // Linear ordering fallback: all preceding nodes must be completed
      const allPrecedingComplete = rawNodes
        .filter((n) => n.order < node.order)
        .every((n) => {
          const pLessonId = `${roadmapId}-lesson-${n.id}`;
          return completedSet.has(pLessonId);
        });
      state = allPrecedingComplete ? "available" : "locked";
    }
    // else: order === 0 and no prereqs -> "available" (first node)

    // Derive parentId from prerequisites (first prerequisite is parent)
    const parentId = node.prerequisites.length > 0 ? node.prerequisites[0] : null;

    return {
      id: node.id,
      lessonId,
      title: node.title,
      description: node.description ?? "",
      order: node.order,
      parentId,
      state,
      children: [] as Array<unknown>,
    };
  });

  // Build children arrays for branching roadmaps
  for (const node of enrichedNodes) {
    if (node.parentId) {
      const parent = enrichedNodes.find((n) => n.id === node.parentId);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return c.json({
    id: typedRoadmap.id,
    userId: typedRoadmap.userId,
    title: typedRoadmap.title,
    topic: typedRoadmap.topic,
    complexity: typedRoadmap.complexity,
    status: typedRoadmap.status,
    workflowRunId: typedRoadmap.workflowRunId,
    nodes: enrichedNodes,
    completedLessonIds,
    createdAt: typedRoadmap.createdAt,
    updatedAt: typedRoadmap.updatedAt,
  });
});

// GET /:id/lessons/:lessonId — Get lesson content with quiz questions (NO answer keys)
roadmapRoutes.get("/:id/lessons/:lessonId", async (c) => {
  const userId = c.get("userId");
  const roadmapId = c.req.param("id");
  const lessonId = c.req.param("lessonId");
  const db = drizzle(c.env.DB, { schema });

  // IDOR: verify roadmap belongs to user
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

  // Verify lesson belongs to this roadmap
  const lessonRows = await db
    .select()
    .from(schema.lessons)
    .where(
      and(
        eq(schema.lessons.id, lessonId),
        eq(schema.lessons.roadmapId, roadmapId)
      )
    )
    .limit(1);

  if (lessonRows.length === 0) {
    return c.json({ error: "Lesson not found" }, 404);
  }

  const lesson = lessonRows[0];

  // Fetch quiz questions — CRITICAL: strip correctOptionId and explanation (UX-02, Pitfall 6)
  const quiz = await db
    .select({ id: schema.quizzes.id })
    .from(schema.quizzes)
    .where(eq(schema.quizzes.lessonId, lessonId))
    .limit(1);

  let quizQuestions: Array<{
    id: string;
    questionText: string;
    questionType: string;
    optionsJson: string;
    order: number;
  }> = [];

  if (quiz.length > 0) {
    const rawQuestions = await db
      .select({
        id: schema.quizQuestions.id,
        questionText: schema.quizQuestions.questionText,
        questionType: schema.quizQuestions.questionType,
        optionsJson: schema.quizQuestions.optionsJson,
        order: schema.quizQuestions.order,
        // correctOptionId and explanation are deliberately EXCLUDED
      })
      .from(schema.quizQuestions)
      .where(eq(schema.quizQuestions.quizId, quiz[0].id))
      .orderBy(schema.quizQuestions.order);

    quizQuestions = rawQuestions;
  }

  // Check completion status for this user
  const completionCheck = await db
    .select({ id: schema.lessonCompletions.id })
    .from(schema.lessonCompletions)
    .where(
      and(
        eq(schema.lessonCompletions.lessonId, lessonId),
        eq(schema.lessonCompletions.userId, userId)
      )
    )
    .limit(1);

  // Map quiz questions to frontend-expected shape
  const mappedQuestions = quizQuestions.map((q) => ({
    id: q.id,
    type: q.questionType === "true_false" ? "true_false" : "mcq",
    question: q.questionText,
    options: JSON.parse(q.optionsJson) as Array<{ id: string; text: string }>,
    order: q.order,
  }));

  return c.json({
    id: lesson.id,
    roadmapId: lesson.roadmapId,
    nodeId: lesson.nodeId,
    title: lesson.title,
    content: lesson.content,
    order: lesson.order,
    createdAt: lesson.createdAt,
    isCompleted: completionCheck.length > 0,
    questions: mappedQuestions,
  });
});

// POST /:id/lessons/:lessonId/complete — Mark lesson as complete (idempotent)
roadmapRoutes.post("/:id/lessons/:lessonId/complete", sanitize, async (c) => {
  const userId = c.get("userId");
  const roadmapId = c.req.param("id");
  const lessonId = c.req.param("lessonId");
  const db = drizzle(c.env.DB, { schema });

  // IDOR: verify roadmap ownership
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

  // Verify lesson belongs to this roadmap
  const lessonRows = await db
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .where(
      and(
        eq(schema.lessons.id, lessonId),
        eq(schema.lessons.roadmapId, roadmapId)
      )
    )
    .limit(1);

  if (lessonRows.length === 0) {
    return c.json({ error: "Lesson not found" }, 404);
  }

  // Idempotent: check if already completed
  const existing = await db
    .select({ id: schema.lessonCompletions.id })
    .from(schema.lessonCompletions)
    .where(
      and(
        eq(schema.lessonCompletions.lessonId, lessonId),
        eq(schema.lessonCompletions.userId, userId)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(schema.lessonCompletions).values({
      id: crypto.randomUUID(),
      userId,
      lessonId,
      completedAt: new Date(),
    });

    // ─── XP Award (GAME-01, D-01, D-04) ────────────────────────────────────
    // Determine XP based on roadmap complexity (D-01)
    const typedRoadmap = roadmap as typeof schema.roadmaps.$inferSelect;
    const baseXp = typedRoadmap.complexity === "branching" ? LESSON_XP_BRANCHING : LESSON_XP_LINEAR;

    // Read timezone from header (sent by frontend) — D-09
    const userTimezone = c.req.header("X-User-Timezone") || "UTC";
    const now = new Date();

    // Read current stats for streak calculation
    const currentStatsRows = await db
      .select()
      .from(schema.userStats)
      .where(eq(schema.userStats.userId, userId))
      .limit(1);

    const currentStats = currentStatsRows[0] ?? {
      xp: 0, currentStreak: 0, longestStreak: 0, lastStreakDate: null,
    };

    // Calculate streak update (D-08: lesson completion only, D-10: hard reset, D-11: server-side)
    const streakResult = updateStreak(
      { currentStreak: currentStats.currentStreak, longestStreak: currentStats.longestStreak, lastStreakDate: currentStats.lastStreakDate },
      now,
      userTimezone
    );

    // Streak bonus: +25 flat XP only when user has built a multi-day streak (D-03).
    // newStreak >= 2 means the user completed lessons on at least 2 consecutive days.
    // First-ever lesson (newStreak = 1 from reset branch) does NOT get bonus.
    const streakBonus = streakResult.newStreak >= 2 ? STREAK_BONUS_XP : 0;
    const totalXpEarned = baseXp + streakBonus;

    // Atomic upsert — INSERT on first activity, UPDATE on subsequent (Pitfall 2 prevention)
    await db
      .insert(schema.userStats)
      .values({
        userId,
        xp: totalXpEarned,
        lessonsCompleted: 1,
        questionsCorrect: 0,
        currentStreak: streakResult.newStreak,
        longestStreak: streakResult.newLongestStreak,
        lastStreakDate: streakResult.lastStreakDate,
        lastActiveRoadmapId: roadmapId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.userStats.userId,
        set: {
          xp: sql`${schema.userStats.xp} + ${totalXpEarned}`,
          lessonsCompleted: sql`${schema.userStats.lessonsCompleted} + 1`,
          currentStreak: streakResult.newStreak,
          longestStreak: streakResult.newLongestStreak,
          lastStreakDate: streakResult.lastStreakDate,
          lastActiveRoadmapId: roadmapId,
          updatedAt: now,
        },
      });

    // Compute new total XP and level for response
    const newXp = currentStats.xp + totalXpEarned;
    const levelInfo = computeLevel(newXp);
    const oldLevel = computeLevel(currentStats.xp).level;

    return c.json({
      completed: true,
      xpEarned: baseXp,
      streakBonus,
      newXp,
      newLevel: levelInfo.level,
      levelUp: levelInfo.level > oldLevel,
    });
  }

  // Already completed — return zeros (idempotent, no double XP per Pitfall 3)
  return c.json({
    completed: true,
    xpEarned: 0,
    streakBonus: 0,
    newXp: 0,
    newLevel: 0,
    levelUp: false,
  });
});

// POST /quiz/:questionId/answer — Submit quiz answer (ONLY place correctOptionId is revealed)
roadmapRoutes.post("/quiz/:questionId/answer", sanitize, async (c) => {
  const userId = c.get("userId");
  const questionId = c.req.param("questionId");
  const db = drizzle(c.env.DB, { schema });

  let body: { selectedOptionId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { selectedOptionId } = body;

  if (!selectedOptionId || typeof selectedOptionId !== "string") {
    return c.json({ error: "selectedOptionId is required" }, 400);
  }

  // Verify question belongs to a roadmap owned by current user (IDOR prevention)
  // Join: quiz_questions → quizzes → lessons → roadmaps WHERE roadmaps.userId = userId
  const questionRows = await db
    .select({
      id: schema.quizQuestions.id,
      correctOptionId: schema.quizQuestions.correctOptionId,
      explanation: schema.quizQuestions.explanation,
    })
    .from(schema.quizQuestions)
    .innerJoin(schema.quizzes, eq(schema.quizQuestions.quizId, schema.quizzes.id))
    .innerJoin(schema.lessons, eq(schema.quizzes.lessonId, schema.lessons.id))
    .innerJoin(schema.roadmaps, eq(schema.lessons.roadmapId, schema.roadmaps.id))
    .where(
      and(
        eq(schema.quizQuestions.id, questionId),
        eq(schema.roadmaps.userId, userId)
      )
    )
    .limit(1);

  if (questionRows.length === 0) {
    return c.json({ error: "Question not found" }, 404);
  }

  const question = questionRows[0];
  const correct = selectedOptionId === question.correctOptionId;

  // ─── Quiz XP Award (GAME-02, D-02, D-04) ──────────────────────────────────
  let xpEarned = 0;
  if (correct) {
    xpEarned = QUIZ_XP_PER_CORRECT; // 10 XP per correct answer

    // Atomic upsert — quiz does NOT touch streak fields (D-08, Pitfall 5)
    await db
      .insert(schema.userStats)
      .values({
        userId,
        xp: xpEarned,
        lessonsCompleted: 0,
        questionsCorrect: 1,
        currentStreak: 0,
        longestStreak: 0,
        lastStreakDate: null,
        lastActiveRoadmapId: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.userStats.userId,
        set: {
          xp: sql`${schema.userStats.xp} + ${xpEarned}`,
          questionsCorrect: sql`${schema.userStats.questionsCorrect} + 1`,
          updatedAt: new Date(),
        },
      });
  }

  // This is the ONLY endpoint that reveals correctOptionId + explanation (D-12, UX-02)
  return c.json({
    correct,
    correctOptionId: question.correctOptionId,
    explanation: question.explanation,
    xpEarned,
  });
});

// GET /:id/quiz/practice — Get practice quiz questions from completed lessons
roadmapRoutes.get("/:id/quiz/practice", async (c) => {
  const userId = c.get("userId");
  const roadmapId = c.req.param("id");
  const db = drizzle(c.env.DB, { schema });

  // IDOR: verify roadmap ownership
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

  // Fetch quiz questions from completed lessons only
  const questions = await db
    .select({
      id: schema.quizQuestions.id,
      questionText: schema.quizQuestions.questionText,
      questionType: schema.quizQuestions.questionType,
      optionsJson: schema.quizQuestions.optionsJson,
      order: schema.quizQuestions.order,
      // correctOptionId and explanation deliberately EXCLUDED (same as lesson endpoint)
    })
    .from(schema.quizQuestions)
    .innerJoin(schema.quizzes, eq(schema.quizQuestions.quizId, schema.quizzes.id))
    .innerJoin(schema.lessons, eq(schema.quizzes.lessonId, schema.lessons.id))
    .innerJoin(
      schema.lessonCompletions,
      and(
        eq(schema.lessonCompletions.lessonId, schema.lessons.id),
        eq(schema.lessonCompletions.userId, userId)
      )
    )
    .where(eq(schema.lessons.roadmapId, roadmapId));

  // Randomize and limit to 10 questions
  const shuffled = questions.sort(() => Math.random() - 0.5).slice(0, 10);

  // Map to frontend-expected shape and return bare array
  const mappedShuffled = shuffled.map((q) => ({
    id: q.id,
    type: q.questionType === "true_false" ? "true_false" : "mcq",
    question: q.questionText,
    options: JSON.parse(q.optionsJson) as Array<{ id: string; text: string }>,
    order: q.order,
  }));

  return c.json(mappedShuffled);
});
