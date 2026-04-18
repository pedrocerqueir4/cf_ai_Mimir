interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  DB: D1Database;
  RATE_LIMITER_AUTH: RateLimit;
  RATE_LIMITER_REGISTER: RateLimit;
  // Phase 2: AI content pipeline bindings
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CONTENT_WORKFLOW: Workflow;
  // Phase 4: Multiplayer battle bindings
  BATTLE_ROOM: DurableObjectNamespace;
  BATTLE_QUESTION_WORKFLOW: Workflow;
  RATE_LIMITER_BATTLE_CREATE: RateLimit;
  RATE_LIMITER_BATTLE_JOIN: RateLimit;
  // Environment variables
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  // Runtime environment tag — only `"test"` unlocks DO __test* ops. Unset
  // in production wrangler config so test-only paths return 404.
  ENVIRONMENT?: string;
}
