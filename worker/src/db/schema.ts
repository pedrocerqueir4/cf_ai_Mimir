import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// ─── Content Pipeline Tables (Phase 2) ───────────────────────────────────────

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const roadmaps = sqliteTable("roadmaps", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  topic: text("topic").notNull(),
  complexity: text("complexity", { enum: ["linear", "branching"] }).notNull().default("linear"),
  status: text("status", { enum: ["generating", "complete", "failed"] }).notNull().default("generating"),
  workflowRunId: text("workflow_run_id"),
  nodesJson: text("nodes_json").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  roadmapId: text("roadmap_id").notNull().references(() => roadmaps.id, { onDelete: "cascade" }),
  nodeId: text("node_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  order: integer("order").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const lessonCompletions = sqliteTable("lesson_completions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lessonId: text("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  completedAt: integer("completed_at", { mode: "timestamp" }).notNull(),
});

export const quizzes = sqliteTable("quizzes", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id").notNull().references(() => lessons.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id: text("id").primaryKey(),
  quizId: text("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  questionType: text("question_type", { enum: ["mcq", "true_false"] }).notNull(),
  optionsJson: text("options_json").notNull(),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation").notNull(),
  order: integer("order").notNull(),
});

// ─── Gamification Tables (Phase 3) ────────────────────────────────────────────

export const userStats = sqliteTable("user_stats", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  xp: integer("xp").notNull().default(0),
  lessonsCompleted: integer("lessons_completed").notNull().default(0),
  questionsCorrect: integer("questions_correct").notNull().default(0),
  currentStreak: integer("current_streak").notNull().default(0),
  longestStreak: integer("longest_streak").notNull().default(0),
  lastStreakDate: text("last_streak_date"),
  lastActiveRoadmapId: text("last_active_roadmap_id").references(() => roadmaps.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ─── Multiplayer Battle Tables (Phase 4) ─────────────────────────────────────
// Shared question pool (cross-user-readable, D-07) + per-battle state + ledger.
// The battles row is the source of truth for participant state — hostId/guestId
// and their matching wager/score columns replace a separate participants table.

export const battlePoolTopics = sqliteTable("battle_pool_topics", {
  id: text("id").primaryKey(),
  // UNIQUE on normalized topic — powers T-04-10 race dedup in findOrQueueTopic:
  // concurrent miss-INSERTs for the same topic deterministically fall through to
  // INSERT OR IGNORE, letting the loser SELECT the winner's row and re-use its
  // in-flight Workflow instead of scheduling a duplicate.
  topic: text("topic").notNull().unique(),
  status: text("status", { enum: ["generating", "ready", "failed"] }).notNull(),
  workflowRunId: text("workflow_run_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const battleQuizPool = sqliteTable("battle_quiz_pool", {
  id: text("id").primaryKey(),
  poolTopicId: text("pool_topic_id").notNull().references(() => battlePoolTopics.id, { onDelete: "cascade" }),
  questionText: text("question_text").notNull(),
  questionType: text("question_type", { enum: ["mcq", "true_false"] }).notNull(),
  optionsJson: text("options_json").notNull(),
  correctOptionId: text("correct_option_id").notNull(),
  explanation: text("explanation").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const battles = sqliteTable("battles", {
  id: text("id").primaryKey(),
  joinCode: text("join_code").notNull(),
  hostId: text("host_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  guestId: text("guest_id").references(() => users.id, { onDelete: "cascade" }),
  hostRoadmapId: text("host_roadmap_id").notNull().references(() => roadmaps.id, { onDelete: "cascade" }),
  guestRoadmapId: text("guest_roadmap_id").references(() => roadmaps.id, { onDelete: "cascade" }),
  winningRoadmapId: text("winning_roadmap_id").references(() => roadmaps.id, { onDelete: "set null" }),
  winningTopic: text("winning_topic"),
  poolTopicId: text("pool_topic_id").references(() => battlePoolTopics.id, { onDelete: "set null" }),
  questionCount: integer("question_count").notNull(),
  hostWagerTier: integer("host_wager_tier"),
  guestWagerTier: integer("guest_wager_tier"),
  appliedWagerTier: integer("applied_wager_tier"),
  hostWagerAmount: integer("host_wager_amount"),
  guestWagerAmount: integer("guest_wager_amount"),
  wagerAmount: integer("wager_amount"),
  status: text("status", {
    enum: ["lobby", "pre-battle", "active", "completed", "forfeited", "expired"],
  }).notNull(),
  winnerId: text("winner_id").references(() => users.id, { onDelete: "set null" }),
  hostFinalScore: integer("host_final_score"),
  guestFinalScore: integer("guest_final_score"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});
// Partial UNIQUE index on join_code (WHERE status='lobby') is appended manually
// to the generated migration SQL — Drizzle Kit does not emit partial indexes.

export const battleAnswers = sqliteTable("battle_answers", {
  id: text("id").primaryKey(),
  battleId: text("battle_id").notNull().references(() => battles.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  questionId: text("question_id").notNull().references(() => battleQuizPool.id, { onDelete: "restrict" }),
  questionIndex: integer("question_index").notNull(),
  selectedOptionId: text("selected_option_id"),
  correct: integer("correct", { mode: "boolean" }).notNull().default(false),
  responseTimeMs: integer("response_time_ms").notNull(),
  pointsAwarded: integer("points_awarded").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const battleLedger = sqliteTable("battle_ledger", {
  battleId: text("battle_id").primaryKey().references(() => battles.id, { onDelete: "cascade" }),
  winnerId: text("winner_id").references(() => users.id, { onDelete: "set null" }),
  loserId: text("loser_id").references(() => users.id, { onDelete: "set null" }),
  xpAmount: integer("xp_amount").notNull(),
  outcome: text("outcome", { enum: ["decisive", "forfeit", "both-dropped"] }).notNull(),
  settledAt: integer("settled_at", { mode: "timestamp" }).notNull(),
});

// ─── Auth Tables (Phase 1) ────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});
