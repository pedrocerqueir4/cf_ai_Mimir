import { env } from "cloudflare:workers";
import { createAuth } from "../worker/src/auth";

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
 * Creates a real Better Auth user + session and returns the signed cookie string
 * ready to pass as a `Cookie` header.
 *
 * Uses Better Auth's own sign-up/sign-in API so the token is properly signed.
 * The cookie value format is: `better-auth.session_token=<token>.<signature>`
 *
 * @param email - Unique email for this test user (use per-describe unique values)
 * @param password - Password (min 8 chars)
 * @returns Object with `cookie` (full cookie string), `userId`, and `sessionToken`
 */
export async function createTestSession(
  email: string,
  password = "TestPass123!",
): Promise<{ cookie: string; userId: string }> {
  const auth = createAuth(env as any, "http://localhost/");

  // Sign up (idempotent — if user exists sign-in will still work)
  try {
    await auth.api.signUpEmail({
      body: { email, password, name: email.split("@")[0] },
    });
  } catch {
    // User may already exist — proceed to sign in
  }

  const signInRes = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  const setCookieHeader = signInRes.headers.get("set-cookie") ?? "";

  // Extract `better-auth.session_token=<value>` from the set-cookie header
  const tokenMatch = setCookieHeader.match(/better-auth\.session_token=([^;,\s]+)/);
  if (!tokenMatch) {
    throw new Error(`Could not extract session token from set-cookie: ${setCookieHeader}`);
  }

  // Decode the percent-encoded cookie value before sending it in Cookie header
  const cookieValue = decodeURIComponent(tokenMatch[1]);
  const cookie = `better-auth.session_token=${cookieValue}`;

  // Extract userId from the response body
  const body = await signInRes.json() as { user?: { id: string } };
  const userId = body?.user?.id ?? "";

  return { cookie, userId };
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
