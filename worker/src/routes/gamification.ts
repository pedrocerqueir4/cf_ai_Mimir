import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { computeLevel, toLocalDateString } from "../lib/xp";

export const gamificationRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
gamificationRoutes.use("/*", authGuard);

// GET /stats — returns all gamification stats for the authenticated user
// Serves both the dashboard (D-13) and profile page (D-15)
// IDOR prevention: userId is derived from session only, never from URL params (T-03-01)
gamificationRoutes.get("/stats", async (c) => {
  const userId = c.get("userId")!;
  // T-03-02: invalid timezone only affects todayLessonCompleted display; toLocalDateString falls back to UTC
  const tz = c.req.query("tz") || "UTC";
  const db = drizzle(c.env.DB, { schema });

  // Fetch userStats row — WHERE clause uses session userId (no IDOR vector)
  const statsRows = await db
    .select()
    .from(schema.userStats)
    .where(eq(schema.userStats.userId, userId))
    .limit(1);

  // Null-coalesce missing row to zeros (first-time user with no activity yet)
  const stats = statsRows[0] ?? {
    xp: 0,
    lessonsCompleted: 0,
    questionsCorrect: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastStreakDate: null,
    lastActiveRoadmapId: null,
  };

  const levelInfo = computeLevel(stats.xp);
  const today = toLocalDateString(new Date(), tz);

  // Fetch user profile info for profile page display (D-15)
  const userRows = await db
    .select({
      name: schema.users.name,
      email: schema.users.email,
      image: schema.users.image,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const user = userRows[0] ?? { name: "", email: "", image: null };

  return c.json({
    xp: stats.xp,
    level: levelInfo.level,
    xpToNextLevel: levelInfo.xpToNextLevel,
    progressPercent: levelInfo.progressPercent,
    streak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    lastActiveRoadmapId: stats.lastActiveRoadmapId,
    todayLessonCompleted: stats.lastStreakDate === today,
    lessonsCompleted: stats.lessonsCompleted,
    questionsCorrect: stats.questionsCorrect,
    name: user.name,
    email: user.email,
    image: user.image,
  });
});
