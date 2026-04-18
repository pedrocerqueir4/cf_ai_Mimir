import { env } from "cloudflare:workers";

// Miniflare D1's exec() only accepts a single SQL statement per call.
// Each statement uses IF NOT EXISTS so calling setupD1() multiple times is safe.
const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at INTEGER,
    refresh_token_expires_at INTEGER,
    scope TEXT,
    password TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verifications (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roadmaps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    complexity TEXT NOT NULL DEFAULT 'linear',
    status TEXT NOT NULL DEFAULT 'generating',
    workflow_run_id TEXT,
    current_step INTEGER NOT NULL DEFAULT 0,
    nodes_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS lesson_completions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    completed_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_option_id TEXT NOT NULL,
    explanation TEXT NOT NULL,
    "order" INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    xp INTEGER NOT NULL DEFAULT 0,
    lessons_completed INTEGER NOT NULL DEFAULT 0,
    questions_correct INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_streak_date TEXT,
    last_active_roadmap_id TEXT REFERENCES roadmaps(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
  )`,
  // Phase 4 battle tables — must match worker/src/db/schema.ts
  `CREATE TABLE IF NOT EXISTS battle_pool_topics (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    status TEXT NOT NULL,
    workflow_run_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS battle_quiz_pool (
    id TEXT PRIMARY KEY,
    pool_topic_id TEXT NOT NULL REFERENCES battle_pool_topics(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_option_id TEXT NOT NULL,
    explanation TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS battles (
    id TEXT PRIMARY KEY,
    join_code TEXT NOT NULL,
    host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    host_roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
    guest_roadmap_id TEXT REFERENCES roadmaps(id) ON DELETE CASCADE,
    winning_roadmap_id TEXT REFERENCES roadmaps(id) ON DELETE SET NULL,
    winning_topic TEXT,
    pool_topic_id TEXT REFERENCES battle_pool_topics(id) ON DELETE SET NULL,
    question_count INTEGER NOT NULL,
    host_wager_tier INTEGER,
    guest_wager_tier INTEGER,
    applied_wager_tier INTEGER,
    host_wager_amount INTEGER,
    guest_wager_amount INTEGER,
    wager_amount INTEGER,
    status TEXT NOT NULL,
    winner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    host_final_score INTEGER,
    guest_final_score INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_battles_lobby_joincode ON battles(join_code) WHERE status = 'lobby'`,
  `CREATE INDEX IF NOT EXISTS idx_battles_host_status ON battles(host_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_battles_guest_status ON battles(guest_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_battles_completed_at ON battles(completed_at)`,
  `CREATE TABLE IF NOT EXISTS battle_answers (
    id TEXT PRIMARY KEY,
    battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES battle_quiz_pool(id) ON DELETE RESTRICT,
    question_index INTEGER NOT NULL,
    selected_option_id TEXT,
    correct INTEGER NOT NULL DEFAULT 0,
    response_time_ms INTEGER NOT NULL,
    points_awarded INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS battle_ledger (
    battle_id TEXT PRIMARY KEY REFERENCES battles(id) ON DELETE CASCADE,
    winner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    loser_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    xp_amount INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    settled_at INTEGER NOT NULL
  )`,
];

// Apply D1 migrations before tests run.
// Uses prepare().run() instead of exec() — exec() requires a trailing semicolon
// in miniflare's D1 implementation and rejects multi-line DDL without one.
// Each statement uses IF NOT EXISTS so calling setupD1() multiple times is safe.
export async function setupD1() {
  for (const sql of CREATE_STATEMENTS) {
    await env.DB.prepare(sql).run();
  }
}

/**
 * Replicates better-call's signCookieValue so we can produce a valid signed
 * cookie without going through Better Auth's HTTP API.
 *
 * Format: encodeURIComponent("<token>.<base64-hmac-sha256>")
 * The base64 signature must be exactly 44 chars and end with "=" (standard
 * base64 with padding) — this is what better-call's getSignedCookie validates.
 *
 * Better Auth uses DEFAULT_SECRET ("better-auth-secret-12345678901234567890")
 * when no BETTER_AUTH_SECRET env var is set, which is the case in miniflare tests.
 */
async function signCookieValue(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  // Standard base64 (NOT base64url) — better-call uses btoa()
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  return encodeURIComponent(`${token}.${signature}`);
}

/**
 * Creates a test user + session directly in D1, bypassing Better Auth's HTTP
 * API (which blocks login when requireEmailVerification: true).
 *
 * Inserts a pre-verified user and a session row, then produces the signed
 * cookie that Better Auth's authGuard will accept.
 *
 * @param email - Unique email for this test user (use per-describe unique values)
 * @returns Object with `cookie` (full cookie string) and `userId`
 */
export async function createTestSession(
  email: string,
  _password = "TestPass123!",
): Promise<{ cookie: string; userId: string }> {
  // Better Auth default secret — used when BETTER_AUTH_SECRET is not set
  const BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890";

  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  // Raw session token stored in DB — Better Auth looks up sessions by this value
  const sessionToken = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // Session expires 7 days from now (stored as Unix seconds in the integer column)
  const expiresAt = now + 60 * 60 * 24 * 7;

  // Insert a pre-verified user (email_verified = 1 bypasses requireEmailVerification)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, email_verified, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).bind(userId, email.split("@")[0], email, now, now).run();

  // Fetch the actual userId in case the user already existed (OR IGNORE)
  const existingUser = await env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`,
  ).bind(email).first<{ id: string }>();

  const actualUserId = existingUser?.id ?? userId;

  // Insert a session row — token is the raw value Better Auth looks up in DB
  const actualSessionId = existingUser ? crypto.randomUUID() : sessionId;
  await env.DB.prepare(
    `INSERT INTO sessions (id, expires_at, token, created_at, updated_at, user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(actualSessionId, expiresAt, sessionToken, now, now, actualUserId).run();

  // Produce the signed cookie value that Better Auth's authGuard accepts
  const signedValue = await signCookieValue(sessionToken, BETTER_AUTH_SECRET);
  const cookie = `better-auth.session_token=${signedValue}`;

  return { cookie, userId: actualUserId };
}

/** Creates a mock AI binding that returns canned JSON responses */
export function createMockAI(responses: Record<string, unknown>) {
  return {
    run: async (model: string, _options: unknown) => {
      if (model.includes("llama-3.3")) {
        const key = Object.keys(responses).find(k => model.includes(k)) || "default";
        return { response: JSON.stringify(responses[key] || responses["default"]) };
      }
      if (model.includes("bge-large")) {
        // Return a fake 1024-dimensional embedding
        return { data: [new Array(1024).fill(0.01)] };
      }
      throw new Error(`Unmocked model: ${model}`);
    },
  };
}

/** Creates a mock Vectorize binding for testing RAG queries */
export function createMockVectorize(
  results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = []
) {
  return {
    upsert: async () => ({ count: 1 }),
    query: async () => ({
      matches: results.map(r => ({
        id: r.id,
        score: r.score,
        metadata: r.metadata || {},
      })),
    }),
  };
}
