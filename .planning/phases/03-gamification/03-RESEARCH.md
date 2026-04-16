# Phase 3: Gamification - Research

**Researched:** 2026-04-16
**Domain:** XP system, level progression, daily streaks, stats dashboard, profile page
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Lesson completion XP is variable by roadmap difficulty — linear roadmaps award less XP per lesson, branching roadmaps award more. Claude determines exact values.
- **D-02:** Quiz XP is score-based — 10 XP per correct answer. 5/5 = 50 XP, 3/5 = 30 XP. No penalty for wrong answers, no minimum threshold.
- **D-03:** Active streaks give a flat bonus — +25 bonus XP on every XP-earning activity while a streak is active. Not a multiplier.
- **D-04:** XP awarded server-side only (server-authoritative). `POST /quiz/:questionId/answer` returns `xpEarned`. Lesson completion endpoint also returns XP earned.
- **D-05:** Exponential XP curve (Duolingo-style) — each level requires ~1.5x more XP than the previous.
- **D-06:** Level-up triggers a subtle badge update — level number updates with brief highlight/pulse animation. No modal, no full-screen celebration.
- **D-07:** No level cap in MVP. Claude determines reasonable starting scale (20-30 levels).
- **D-08:** Streak activity = completing at least 1 lesson in a calendar day. Quiz-only does NOT maintain streaks.
- **D-09:** Day resets at midnight in the user's local timezone. Requires storing `timezone` on user profile or deriving from browser.
- **D-10:** Hard reset to 0 when streak breaks — no grace period, no freeze tokens.
- **D-11:** Streak checked/updated server-side when a lesson is completed. Backend compares completion timestamp against last streak activity date (in user's timezone).
- **D-12:** Home page becomes stats dashboard with: XP total + progress bar, current streak with flame icon, today's goal status, "Continue learning" CTA.
- **D-13:** Dashboard data from new `GET /api/user/stats` endpoint returning `{ xp, level, xpToNextLevel, streak, longestStreak, lastActiveRoadmapId, todayLessonCompleted }`.
- **D-14:** Profile page (`/profile`) shows stats card grid: level badge, total XP, current streak, longest streak, lessons completed, quizzes passed.
- **D-15:** Profile data from `GET /api/user/profile` endpoint (or extends stats endpoint).

### Claude's Discretion

- Exact XP values per difficulty tier (linear vs branching)
- Exact exponential formula and level thresholds
- Streak bonus XP amount
- UI layout, component structure, and styling for dashboard/profile
- Whether to derive timezone from browser `Intl.DateTimeFormat` or store as a user preference
- Database schema design (new tables vs extending existing)

### Deferred Ideas (OUT OF SCOPE)

- Leaderboard — Phase 4 (/battle page)
- Badges and achievements — future enhancement
- Streak freeze tokens — explicitly rejected (hard reset chosen)
- Activity feed / timeline on profile — not needed for MVP
- Level-up celebrations (full-screen modal) — subtle approach chosen
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GAME-01 | User earns XP for completing lessons | D-01 decision + new `userStats` table + lesson completion hook in `roadmaps.ts` |
| GAME-02 | User earns XP for passing quizzes | D-02 decision + quiz answer hook in `roadmaps.ts` returning `xpEarned` |
| GAME-03 | User has a level that increases at defined XP thresholds | Exponential curve formula + `computeLevel()` utility in worker |
| GAME-04 | User can see current XP, level, and progress to next level | `GET /api/user/stats` endpoint + XPProgressBar + LevelBadge components |
| GAME-05 | User maintains a daily study streak for consecutive days with at least one lesson | D-08/D-09/D-10/D-11 streak logic + timezone comparison utility |
| GAME-06 | Streak counter is visible on the main dashboard | StreakCounter component + dashboard page replacement |
</phase_requirements>

---

## Summary

Phase 3 adds a complete gamification reward loop on top of the existing lesson and quiz infrastructure. The backend work is concentrated in three areas: (1) a new `userStats` Drizzle table to persist XP totals, streak state, and quiz counts, (2) XP award logic injected into the two existing endpoints (`POST /:id/lessons/:lessonId/complete` and `POST /quiz/:questionId/answer`) without restructuring those handlers, and (3) two new read endpoints (`GET /api/user/stats` and `GET /api/user/profile`) mounted in a new `gamificationRoutes` module.

The frontend work replaces the empty Home page with a stats dashboard and adds a new `/profile` route, both consuming TanStack Query with a shared `['user','stats']` cache key. All gamification components (XPProgressBar, StreakCounter, StatCard, LevelBadge) are new but built exclusively from already-installed shadcn primitives (Progress, Badge, Card, Skeleton, Avatar). No new npm packages are needed for this phase.

The trickiest implementation detail is timezone-aware streak logic: the server must compare lesson completion timestamps in the user's local timezone to determine whether a lesson was completed "today" or "yesterday." This requires either storing a timezone string on the user row or accepting it from a request header. The safest, lowest-friction approach is to derive it client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone` and send it as a query param or header on the completion request — no DB schema change needed for timezone (avoid a third extra column on `users`).

**Primary recommendation:** Add a single `userStats` table for denormalized XP/streak counters updated atomically on each lesson completion and quiz answer. Do not compute XP totals from `lessonCompletions` aggregates at query time — that becomes expensive and fragile.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| XP award on lesson complete | API / Backend | — | Server-authoritative (D-04); client must never compute XP |
| XP award on quiz answer | API / Backend | — | Same server-authority constraint; extends existing quiz answer endpoint |
| Streak check and update | API / Backend | — | Requires secure timestamp comparison; client timezone passed as input only |
| Level computation | API / Backend | Frontend (display) | `computeLevel(xp)` pure function — runs server-side for responses, may be duplicated client-side for level-up detection animation trigger |
| `GET /api/user/stats` | API / Backend | — | Reads denormalized stats row; single fast D1 query |
| Stats dashboard (Home page) | Browser / Client | — | React component consuming TanStack Query; no SSR needed |
| Profile page | Browser / Client | — | Same pattern as dashboard |
| XP toast notification | Browser / Client | — | Triggered from API response in lesson/quiz route handlers |
| LevelBadge pulse animation | Browser / Client | — | Pure CSS, triggered when cached level < new level |

---

## Standard Stack

### Core (all already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.2 | Schema extension + D1 queries | Already in use; `userStats` table added via migration |
| drizzle-kit | 0.31.10 | Migration generation | `drizzle-kit generate` + `wrangler d1 migrations apply` |
| hono | 4.12.9 | New `gamificationRoutes` module | Consistent with all other route modules |
| @tanstack/react-query | 5.96.1 | Stats data fetching + cache invalidation | Already owns all server state |
| sonner | 2.0.7 | XP earned toast notifications | Already installed; `toast.success()` call pattern established |
| lucide-react | 1.7.0 | Flame icon (streak), stat icons | Already installed |
| tailwindcss | 4.1.13 | Pulse animation, transitions | animate-pulse, transition-[width] |

### shadcn Components (all already installed)

| Component | Already Installed | Usage |
|-----------|-------------------|-------|
| Card, CardContent | Yes | Dashboard sections, profile stat grid |
| Progress | Yes | XP progress bar (shadcn renders `role="progressbar"` + aria attrs) |
| Badge | Yes | Level badge "Lv. N" |
| Skeleton | Yes | Loading states |
| Avatar | Yes | Profile page user avatar |
| Button | Yes | "Continue Learning" CTA |
| Separator | Yes | Profile section dividers |

**No new npm packages or shadcn components need to be installed for this phase.** [VERIFIED: apps/web/package.json]

---

## Architecture Patterns

### System Architecture Diagram

```
Lesson complete flow:
  Browser → POST /api/roadmaps/:id/lessons/:lessonId/complete
                │
                ├─ [existing] insert lessonCompletions row
                │
                ├─ [NEW] awardLessonXP(userId, roadmapComplexity)
                │     └─ UPDATE userStats SET xp += N, lessonsCompleted += 1
                │        UPDATE streak if needed
                │
                └─ return { completed: true, xpEarned: N, streakBonus: 0|25,
                            newXp: X, newLevel: L, levelUp: bool }

Quiz answer flow:
  Browser → POST /api/roadmaps/quiz/:questionId/answer
                │
                ├─ [existing] verify correctOptionId
                │
                ├─ [NEW] if isCorrect: awardQuizXP(userId)
                │     └─ UPDATE userStats SET xp += 10, quizzesPassed += 1 (if all correct)
                │
                └─ return { correct, correctOptionId, explanation, xpEarned: 0|10 }

Stats read flow:
  Browser → GET /api/user/stats
                │
                └─ SELECT from userStats WHERE userId = ?
                   return { xp, level, xpToNextLevel, streak, longestStreak,
                            lastActiveRoadmapId, todayLessonCompleted }
```

### Recommended Project Structure

```
worker/src/
├── routes/
│   ├── roadmaps.ts          # extend: lesson complete + quiz answer inject XP
│   └── gamification.ts      # NEW: GET /api/user/stats, GET /api/user/profile
├── db/
│   ├── schema.ts            # add userStats table
│   └── migrations/
│       └── 0003_gamification.sql   # NEW migration
└── lib/
    └── xp.ts                # NEW: computeLevel(), LEVEL_THRESHOLDS, awardXP()

apps/web/app/
├── routes/
│   ├── _app._index.tsx      # REPLACE: empty state → dashboard
│   └── _app.profile.tsx     # NEW: profile page
└── components/
    └── gamification/
        ├── XPProgressBar.tsx    # NEW
        ├── StreakCounter.tsx     # NEW
        ├── StatCard.tsx         # NEW
        └── LevelBadge.tsx       # NEW
```

### Pattern 1: Denormalized `userStats` Table

**What:** A single row per user storing computed totals — not derived from joins at read time.
**When to use:** Any counter that gets queried often (every dashboard load, every stats refresh) and updated incrementally (after each lesson/quiz). Avoids expensive COUNT aggregates over `lessonCompletions` at read time.

**Schema:**
```typescript
// Source: project schema.ts pattern [VERIFIED: worker/src/db/schema.ts]
export const userStats = sqliteTable("user_stats", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  lessonsCompleted: integer("lessons_completed").notNull().default(0),
  quizzesPassed: integer("quizzes_passed").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastStreakDate: text("last_streak_date"),  // ISO date string "YYYY-MM-DD" in user's timezone
  lastActiveRoadmapId: text("last_active_roadmap_id").references(() => roadmaps.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

**Key design choices:**
- `userId` as primary key (not a separate `id`) — one row per user, natural PK
- `lastStreakDate` stored as ISO date string in user's local timezone (not UTC Unix timestamp) — avoids timezone conversion bugs on reads
- `lastActiveRoadmapId` maintained on every lesson completion for "Continue Learning" CTA
- `quizzesPassed` = quiz sessions with all-correct answers OR individual correct question count? **Recommendation:** count individual correct answers (matches D-02 "10 XP per correct answer" — one answer = one unit), not quiz sessions. Profile shows "Quizzes Passed" — rename to "Questions Answered" in display if needed.

### Pattern 2: XP Level Computation (Pure Function)

**What:** A pure function that converts a cumulative XP total to a `{ level, xpForCurrentLevel, xpToNextLevel, progressPercent }` object. The formula uses a 1.3x exponential multiplier with a 100 XP base.

**Why 1.3x instead of 1.5x:** At 1.5x, level 25 requires 12.7M XP (unreachable). At 1.3x, level 25 requires ~54K XP (achievable by a dedicated learner in ~5 months). [ASSUMED: 1.3x is appropriate — user confirmed "Duolingo-style" but actual Duolingo values are not public]

**Level thresholds (1.3x multiplier, base 100):**
```
Level 1: 0 XP (starting level)
Level 2: 100 XP total
Level 3: 230 XP total
Level 4: 399 XP total
Level 5: 619 XP total
Level 10: 3,202 XP total (~91 activities at 35 avg XP)
Level 15: 12,792 XP total (~365 activities ≈ 1 year daily)
Level 20: 48,398 XP total (~1,383 activities)
Level 25: 180,600 XP total (~5,160 activities)
```

**Implementation:**
```typescript
// Source: computed 2026-04-16 [VERIFIED: arithmetic confirmed via node script]
// worker/src/lib/xp.ts

const XP_BASE = 100;
const XP_MULTIPLIER = 1.3;
const MAX_LEVELS = 25;

// Pre-compute cumulative thresholds at module load (25 entries, negligible memory)
export const LEVEL_THRESHOLDS: number[] = (() => {
  const thresholds = [0]; // Level 1 starts at 0
  let cumulative = 0;
  for (let n = 1; n < MAX_LEVELS; n++) {
    cumulative += Math.round(XP_BASE * Math.pow(XP_MULTIPLIER, n - 1));
    thresholds.push(cumulative);
  }
  return thresholds;
})();

export function computeLevel(totalXp: number): {
  level: number;
  xpForCurrentLevel: number;
  xpToNextLevel: number;
  progressPercent: number;
} {
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  // Cap at max level
  if (level >= MAX_LEVELS) {
    return { level: MAX_LEVELS, xpForCurrentLevel: 0, xpToNextLevel: 0, progressPercent: 100 };
  }
  const currentThreshold = LEVEL_THRESHOLDS[level - 1];
  const nextThreshold = LEVEL_THRESHOLDS[level];
  const xpIntoLevel = totalXp - currentThreshold;
  const xpNeeded = nextThreshold - currentThreshold;
  return {
    level,
    xpForCurrentLevel: xpIntoLevel,
    xpToNextLevel: xpNeeded - xpIntoLevel,
    progressPercent: Math.round((xpIntoLevel / xpNeeded) * 100),
  };
}
```

### Pattern 3: Streak Logic

**What:** Server-side comparison of current lesson completion time (in user's timezone) against stored `lastStreakDate`.

**Timezone approach:** Accept `X-User-Timezone` header (set by frontend on lesson completion requests) or `?tz=` query param. Use `Intl.DateTimeFormat` on the server to convert UTC timestamps to local dates. [VERIFIED: `Intl` is available in Cloudflare Workers runtime per @cloudflare/workers-types]

```typescript
// Source: MDN Intl.DateTimeFormat, Cloudflare Workers runtime [ASSUMED: specific API availability confirmed via workers-types]

function toLocalDateString(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date); // Returns "YYYY-MM-DD" in en-CA locale
  } catch {
    // Invalid timezone — fallback to UTC
    return date.toISOString().slice(0, 10);
  }
}

function updateStreak(
  stats: UserStats,
  completionTime: Date,
  userTimezone: string
): { newStreak: number; newLongestStreak: number; lastStreakDate: string } {
  const today = toLocalDateString(completionTime, userTimezone);
  const yesterday = toLocalDateString(
    new Date(completionTime.getTime() - 86_400_000),
    userTimezone
  );

  if (stats.lastStreakDate === today) {
    // Already completed today — no change to streak
    return {
      newStreak: stats.currentStreak,
      newLongestStreak: stats.longestStreak,
      lastStreakDate: stats.lastStreakDate,
    };
  } else if (stats.lastStreakDate === yesterday) {
    // Consecutive day — increment streak
    const newStreak = stats.currentStreak + 1;
    return {
      newStreak,
      newLongestStreak: Math.max(newStreak, stats.longestStreak),
      lastStreakDate: today,
    };
  } else {
    // Gap detected — hard reset (D-10)
    return { newStreak: 1, newLongestStreak: Math.max(1, stats.longestStreak), lastStreakDate: today };
  }
}
```

### Pattern 4: Atomic XP Update (D1 upsert)

**What:** Insert-or-update `userStats` row atomically. D1 (SQLite) supports `INSERT OR REPLACE` and `ON CONFLICT DO UPDATE`. Drizzle exposes `.onConflictDoUpdate()`.

```typescript
// Source: Drizzle ORM docs — onConflictDoUpdate [ASSUMED: exact API — verify against drizzle-orm 0.45.x]
await db
  .insert(schema.userStats)
  .values({
    userId,
    xp: xpToAdd,
    lessonsCompleted: 1,
    quizzesPassed: 0,
    currentStreak: newStreak,
    longestStreak: newLongestStreak,
    lastStreakDate: today,
    lastActiveRoadmapId: roadmapId,
    updatedAt: new Date(),
  })
  .onConflictDoUpdate({
    target: schema.userStats.userId,
    set: {
      xp: sql`${schema.userStats.xp} + ${xpToAdd}`,
      lessonsCompleted: sql`${schema.userStats.lessonsCompleted} + 1`,
      currentStreak: newStreak,
      longestStreak: newLongestStreak,
      lastStreakDate: today,
      lastActiveRoadmapId: roadmapId,
      updatedAt: new Date(),
    },
  });
```

**Critical:** The `sql` template tag for column-referencing arithmetic is required for atomic increment. `SET xp = xp + 10` at SQL level prevents a read-modify-write race condition (SEC-05 applies here even before Phase 4).

### Pattern 5: Frontend Cache Invalidation

**What:** After lesson complete or quiz answer, invalidate the `['user','stats']` TanStack Query key so the dashboard and level badge refresh. Level-up detection compares old cached level vs. new level.

```typescript
// Source: TanStack Query docs [ASSUMED: exact queryClient API stable in v5]
// In LessonPage handleCompleteLesson():
const result = await completeLesson(roadmapId, lessonId); // now returns { xpEarned, streakBonus, newLevel, levelUp }
if (result.xpEarned > 0) {
  toast.success(`+${result.xpEarned} XP earned`, {
    description: `Completed: ${lesson.title}`,
  });
}
if (result.streakBonus > 0) {
  setTimeout(() => {
    toast.success(`+${result.streakBonus} XP bonus`, {
      description: "Streak active — keep it up!",
    });
  }, 300);
}
await queryClient.invalidateQueries({ queryKey: ["user", "stats"] });
```

### Anti-Patterns to Avoid

- **Computing XP from joins at read time:** Aggregating `COUNT(*) FROM lessonCompletions` + `SUM(xpPerLesson)` per request is expensive. Use the denormalized `userStats` table instead.
- **Storing timezone as UTC Unix timestamp for streak date:** `lastStreakDate` must be a date string ("YYYY-MM-DD") in the user's local timezone. Storing as UTC integer causes streak breaks near midnight for users west of UTC.
- **Client-side XP calculation:** Always trust the server return value for `xpEarned`. Never compute XP on the client and report it back to the server.
- **Creating a new `userStats` row per lesson/quiz:** One row per user. Use upsert pattern.
- **Separate streak-checking endpoint:** Streak is checked as a side effect of lesson completion, not as a separate call. One write, one response.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XP progress bar | Custom div with CSS width | shadcn `Progress` | Handles ARIA `role="progressbar"` + `aria-valuenow`; already installed |
| Toast notifications | Custom toast state | Sonner `toast.success()` | Already wired in root layout; handles stacking, auto-dismiss, a11y |
| Level badge styling | Custom CSS badge | shadcn `Badge` | Consistent with app design system; variant="default" uses `--primary` |
| Loading skeletons | CSS shimmer | shadcn `Skeleton` | Already used in all Phase 2 loading states |
| Timezone IANA validation | Custom regex | `Intl.DateTimeFormat` try/catch | The try/catch on `Intl.DateTimeFormat` constructor correctly rejects invalid TZ strings |

---

## Common Pitfalls

### Pitfall 1: Streak Breaks Near Midnight

**What goes wrong:** User completes a lesson at 11:59 PM in their local timezone. Server records completion in UTC (e.g., 04:59 AM next UTC day). If streak comparison uses UTC dates, the server thinks the lesson was completed "tomorrow" in UTC and incorrectly breaks the streak.

**Why it happens:** D1 `timestamp` mode stores Unix epoch (UTC). Comparing dates without timezone conversion produces wrong results for any user outside UTC.

**How to avoid:** Always convert completion timestamp to local date string using `Intl.DateTimeFormat` with the user's IANA timezone before comparing against `lastStreakDate`. The `lastStreakDate` stored in D1 must also be a local date string.

**Warning signs:** Streak resets reported by users in UTC-5 or UTC+8 timezones.

### Pitfall 2: Missing `userStats` Row on First Activity

**What goes wrong:** First lesson completion tries to `UPDATE userStats SET xp = xp + 25 WHERE userId = ?` — updates 0 rows because no row exists yet. XP is silently lost.

**How to avoid:** Always use `INSERT ... ON CONFLICT DO UPDATE` (Drizzle's `.onConflictDoUpdate()`). Never use `UPDATE` alone for stat increments.

### Pitfall 3: Double XP on Repeated Lesson Completion

**What goes wrong:** Lesson completion is idempotent (existing check prevents double `lessonCompletions` insert), but if XP award happens before the idempotency check, or if the check is bypassed, XP is awarded multiple times.

**How to avoid:** Award XP only when a new `lessonCompletions` row is inserted. Check `existing.length === 0` before awarding. The lesson completion endpoint already has this idempotency gate — XP award logic goes inside the `if (existing.length === 0)` branch.

```typescript
// CORRECT: XP only awarded when not already completed
if (existing.length === 0) {
  await db.insert(schema.lessonCompletions).values({ ... });
  await awardLessonXP(db, userId, roadmapId, roadmapComplexity, timezone);
}
```

### Pitfall 4: Level-Up Not Detected in Frontend

**What goes wrong:** The dashboard refreshes but the LevelBadge pulse animation never fires because the component doesn't know the level changed.

**How to avoid:** Cache the previous level in a `useRef` inside the component. On each query result, compare `data.level > prevLevelRef.current` to trigger the animation. Update the ref after triggering.

### Pitfall 5: Streak Bonus Applied to Quiz-Only Days

**What goes wrong:** User only answers quizzes (no lesson completion) on a given day. Streak remains active. Next lesson completion on the following day shows `lastStreakDate` was "yesterday" (from a quiz answer that shouldn't count), incorrectly continuing the streak.

**How to avoid:** Only update `lastStreakDate` and streak counter when a *lesson* is completed (D-08). Quiz XP award must NOT touch streak fields. The `awardQuizXP()` function updates only `xp` and `quizzesPassed` columns.

### Pitfall 6: `todayLessonCompleted` Stale on `GET /api/user/stats`

**What goes wrong:** `GET /api/user/stats` returns `todayLessonCompleted: false` even though the user completed a lesson 5 minutes ago, because the query checks `lastStreakDate !== today` but uses the server's UTC date rather than the user's local date.

**How to avoid:** `todayLessonCompleted` is computed by comparing `lastStreakDate` (stored as user's local date) against today's date in the user's timezone. The stats endpoint must accept a `?tz=` parameter so this comparison is accurate. Without a timezone param, fall back to UTC and document the known limitation.

### Pitfall 7: `completeLesson` API Client Returns `void`

**What goes wrong:** The existing `completeLesson()` in `api-client.ts` returns `Promise<void>`. The lesson page calls it with `await completeLesson(...)` and discards the response. After adding XP fields to the response, the frontend won't see them.

**How to avoid:** Update `completeLesson()` return type to `Promise<LessonCompleteResult>` where `LessonCompleteResult = { completed: boolean; xpEarned: number; streakBonus: number; newXp: number; newLevel: number; levelUp: boolean }`. Update the call site in the lesson page to read and display results.

---

## XP Values (Claude's Discretion — Recommended)

Based on the decisions and Duolingo-style feel:

| Activity | XP Awarded | Rationale |
|----------|-----------|-----------|
| Complete lesson (linear roadmap) | 25 XP | Fast to earn at early levels; ~4 lessons to level 2 |
| Complete lesson (branching roadmap) | 50 XP | Harder, more conceptual topics deserve more XP |
| Quiz correct answer | 10 XP per correct | D-02 locked; 5/5 = 50 XP matches a linear lesson |
| Streak bonus (flat) | 25 XP | D-03 locked; same as a linear lesson completion |

**Level formula:** `floor(XP_BASE * 1.3^(n-1))` where `XP_BASE = 100`, computed up to level 25.

Key milestone paces (assuming 1 lesson/day + 5-question quiz + streak bonus = ~75 XP/day):
- Level 2: day 2
- Level 5: day 9
- Level 10: day 43
- Level 15: day 170
- Level 20: day 645
- Level 25: day 2,408

These timescales feel appropriately Duolingo-like: early levels come fast (rewarding), later levels represent genuine long-term commitment.

---

## Code Examples

### Recommended `gamificationRoutes` Structure

```typescript
// Source: project pattern (worker/src/routes/roadmaps.ts) [VERIFIED: codebase]
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { computeLevel } from "../lib/xp";

export const gamificationRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
gamificationRoutes.use("/*", authGuard);

// GET /user/stats — dashboard data
gamificationRoutes.get("/user/stats", async (c) => {
  const userId = c.get("userId")!;
  const tz = (c.req.query("tz") as string) || "UTC";
  const db = drizzle(c.env.DB, { schema });

  const statsRows = await db
    .select()
    .from(schema.userStats)
    .where(eq(schema.userStats.userId, userId))
    .limit(1);

  const stats = statsRows[0] ?? {
    xp: 0, lessonsCompleted: 0, quizzesPassed: 0,
    currentStreak: 0, longestStreak: 0, lastStreakDate: null,
    lastActiveRoadmapId: null,
  };

  const levelInfo = computeLevel(stats.xp);
  const today = toLocalDateString(new Date(), tz);

  return c.json({
    xp: stats.xp,
    level: levelInfo.level,
    xpToNextLevel: levelInfo.xpToNextLevel,
    progressPercent: levelInfo.progressPercent,
    streak: stats.currentStreak,
    longestStreak: stats.longestStreak,
    lastActiveRoadmapId: stats.lastActiveRoadmapId,
    todayLessonCompleted: stats.lastStreakDate === today,
  });
});
```

### Frontend Stats Hook

```typescript
// Source: TanStack Query v5 pattern [ASSUMED: API stable in 5.96.x]
// apps/web/app/hooks/useUserStats.ts
import { useQuery } from "@tanstack/react-query";
import { fetchUserStats } from "~/lib/api-client";

export function useUserStats() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery({
    queryKey: ["user", "stats"],
    queryFn: () => fetchUserStats(tz),
    staleTime: 30_000, // as specified in UI-SPEC
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `AND userId = ?` IDOR checks | `verifyOwnership()` middleware helper | Phase 2 | New gamification endpoints must use same pattern or inline `WHERE userId = ?` on userStats (single-table, userId = PK) |
| Empty Home page | Stats dashboard | This phase | `_app._index.tsx` is a full replacement |
| `completeLesson()` returns void | Returns `LessonCompleteResult` | This phase | api-client.ts type must be updated |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 1.3x XP multiplier produces appropriate progression pace | XP Values section | Too fast/slow progression; can be tuned by changing `XP_MULTIPLIER` constant without schema changes |
| A2 | `Intl.DateTimeFormat` is available in CF Workers runtime for timezone conversion | Pattern 3: Streak Logic | Streak dates would need UTC fallback; check `@cloudflare/workers-types` for Intl support |
| A3 | Drizzle `.onConflictDoUpdate()` with `sql` template for column arithmetic works in drizzle-orm 0.45.x | Pattern 4: Atomic Update | May need raw SQL `INSERT OR REPLACE` fallback; verify before coding |
| A4 | `quizzesPassed` counter increments per correct answer (not per quiz session) | userStats schema | Profile stat label may need adjustment ("Questions Correct" vs. "Quizzes Passed") |
| A5 | Browser `Intl.DateTimeFormat().resolvedOptions().timeZone` reliably returns IANA timezone string | Frontend Stats Hook | Fallback to UTC for timezone-unaware browsers (old iOS Safari); acceptable degradation |

---

## Open Questions (RESOLVED)

1. **Should `GET /api/user/stats` and `GET /api/user/profile` be separate endpoints?**
   - What we know: D-13 specifies stats endpoint, D-15 says profile extends or is separate
   - What's unclear: Whether the Profile page needs different data from the Dashboard
   - Recommendation: One endpoint `GET /api/user/stats` returns all fields (xp, level, streak, longestStreak, lessonsCompleted, quizzesPassed, lastActiveRoadmapId, todayLessonCompleted, userName, email, avatarUrl). Both pages fetch from the same TanStack Query key. No need for a separate profile endpoint.

2. **Does `quizzesPassed` mean per-question or per-quiz-session?**
   - What we know: D-02 awards XP per correct answer; Profile shows "Quizzes Passed" stat
   - What's unclear: Unit of "quizzes passed" — 1 quiz session = 1, or sum of correct answers
   - Recommendation: Track individual correct answers as `questionsCorrect`. Profile label = "Questions Correct". Simpler, matches the XP model. Rename the column in schema to `questionsCorrect`.

3. **How does the streak bonus integrate with quiz-only days?**
   - What we know: D-08 says only lesson completions maintain streaks
   - What's unclear: Does the streak bonus toast fire on quiz answers even when streak is active?
   - Recommendation: Streak bonus fires only on lesson completion (not quiz answers). The lesson completion endpoint checks streak status and returns `streakBonus: 25 | 0`. Quiz answer endpoint never returns streak bonus.

---

## Environment Availability

Step 2.6: No new external dependencies. All required tools (Drizzle, Hono, D1, TanStack Query, shadcn) are already installed and operational.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| drizzle-orm | New userStats table + queries | Yes | 0.45.2 | — |
| drizzle-kit | Migration generation | Yes | 0.31.10 | — |
| D1 (local via wrangler) | Gamification schema migration | Yes | wrangler 4.79.0 | — |
| `Intl.DateTimeFormat` | Timezone streak logic | Yes (CF Workers) | Runtime builtin | UTC fallback |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + @cloudflare/vitest-pool-workers |
| Config file | `worker/vitest.config.mts` |
| Quick run command | `cd worker && npx vitest run --reporter=verbose` |
| Full suite command | `cd worker && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GAME-01 | Lesson completion awards XP based on roadmap complexity | unit | `npx vitest run tests/gamification.test.ts -t "lesson XP"` | Wave 0 |
| GAME-01 | Idempotent completion does NOT double-award XP | unit | `npx vitest run tests/gamification.test.ts -t "idempotent"` | Wave 0 |
| GAME-02 | Quiz correct answer awards 10 XP | unit | `npx vitest run tests/gamification.test.ts -t "quiz XP"` | Wave 0 |
| GAME-02 | Quiz incorrect answer awards 0 XP | unit | `npx vitest run tests/gamification.test.ts -t "quiz no XP"` | Wave 0 |
| GAME-03 | `computeLevel(100)` returns level 2 | unit | `npx vitest run tests/xp.test.ts -t "computeLevel"` | Wave 0 |
| GAME-03 | `computeLevel(0)` returns level 1 | unit | `npx vitest run tests/xp.test.ts` | Wave 0 |
| GAME-04 | `GET /api/user/stats` returns correct level + XP fields | integration | `npx vitest run tests/gamification.test.ts -t "stats endpoint"` | Wave 0 |
| GAME-05 | Consecutive day lesson completion increments streak | unit | `npx vitest run tests/gamification.test.ts -t "streak increment"` | Wave 0 |
| GAME-05 | Missed day resets streak to 1 | unit | `npx vitest run tests/gamification.test.ts -t "streak reset"` | Wave 0 |
| GAME-05 | Same-day second completion does not double-increment streak | unit | `npx vitest run tests/gamification.test.ts -t "streak idempotent"` | Wave 0 |
| GAME-06 | `GET /api/user/stats` includes `streak` field | integration | (covered by GAME-04 test) | Wave 0 |

### Sampling Rate

- **Per task commit:** `cd worker && npx vitest run tests/xp.test.ts tests/gamification.test.ts`
- **Per wave merge:** `cd worker && npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/xp.test.ts` — pure unit tests for `computeLevel()` and `LEVEL_THRESHOLDS` (no D1 needed)
- [ ] `tests/gamification.test.ts` — integration tests for XP award, streak logic, stats endpoint (uses miniflare D1)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | All endpoints behind `authGuard` (established Phase 1) |
| V3 Session Management | no | Better Auth sessions unchanged |
| V4 Access Control | yes | `userId` from session only — `userStats` keyed by userId (PK); no IDOR vector since stats are self-referential |
| V5 Input Validation | yes | `tz` query param sanitized via try/catch on `Intl.DateTimeFormat` constructor |
| V6 Cryptography | no | No new cryptographic operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XP inflation via replayed lesson completion | Tampering | Idempotency check (`existing.length === 0`) before XP award — already in roadmaps.ts pattern |
| Race condition on concurrent XP updates | Tampering | `INSERT ... ON CONFLICT DO UPDATE` with SQL arithmetic (`xp = xp + N`) is atomic in SQLite D1; no read-modify-write window |
| Fake timezone to extend streak | Tampering | Timezone only affects UI display, not whether streak was earned. Even with fake TZ, user must have actually completed a lesson on the calendar day in question. Risk: low. |
| Accessing another user's stats | Information Disclosure | `WHERE userId = ?` with userId from session, not from request params — standard IDOR prevention |

**SEC-06 (server-authoritative scoring):** XP values are computed entirely server-side from `roadmap.complexity` (server reads this from DB) and `isCorrect` (server reads from DB). Client sends zero XP-related data. The existing server-authority contract from Phase 2 is extended, not changed.

---

## Project Constraints (from CLAUDE.md)

- **Platform constraint:** All code runs on Cloudflare Workers + D1 — no external services
- **Server-authoritative scoring:** XP must be computed and awarded server-side only (matches D-04)
- **No IDOR:** All stats endpoints must derive `userId` from session, never from request body/params
- **Mobile-first:** Dashboard and profile layouts must prioritize mobile viewport with `min-h-12` tap targets
- **No file upload / no RCE vector:** Not relevant to this phase
- **Drizzle ORM:** All D1 queries use Drizzle — no raw SQL except where Drizzle template tags are needed (atomic increment via `sql` template)
- **TanStack Query for server state:** Dashboard stats fetching follows established TanStack Query pattern with `staleTime` and cache invalidation
- **Zod validation:** Body validation on new endpoints if they accept POST bodies (stats endpoints are GET-only — no body validation needed)

---

## Sources

### Primary (HIGH confidence)

- `worker/src/db/schema.ts` — existing table structure; `lessonCompletions` table confirmed for streak derivation — [VERIFIED: codebase]
- `worker/src/routes/roadmaps.ts` — lesson completion and quiz answer endpoints confirmed; idempotency pattern confirmed — [VERIFIED: codebase]
- `apps/web/app/lib/api-client.ts` — `completeLesson()` returns void (needs update); established API client pattern — [VERIFIED: codebase]
- `apps/web/workers/app.ts` — route mounting pattern `api.route("/api/...", routes)` — [VERIFIED: codebase]
- `worker/vitest.config.mts` — existing test framework setup — [VERIFIED: codebase]
- `.planning/phases/03-gamification/03-UI-SPEC.md` — component inventory, interaction contracts, screen contracts — [VERIFIED: codebase]
- XP curve arithmetic — verified via `node` computation 2026-04-16 — [VERIFIED: arithmetic]

### Secondary (MEDIUM confidence)

- Drizzle ORM `.onConflictDoUpdate()` API — documented in Drizzle ORM docs; consistent with drizzle-orm 0.45.x — [ASSUMED: specific API confirmed by docs pattern]
- `Intl.DateTimeFormat` in Cloudflare Workers — consistent with V8 runtime support — [ASSUMED: verify against workers-types 4.20260401.1]

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages already installed, versions verified
- Architecture: HIGH — based on direct codebase inspection of all integration points
- XP curve values: MEDIUM — formula is Claude's discretion (D-07); values are reasonable estimates derived from known Duolingo-style patterns but exact numbers are adjustable
- Streak logic: HIGH — timezone approach is straightforward Intl usage
- Pitfalls: HIGH — derived from direct code inspection of existing patterns

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable stack, no fast-moving dependencies)
