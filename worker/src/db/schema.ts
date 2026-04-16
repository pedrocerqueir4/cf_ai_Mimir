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
