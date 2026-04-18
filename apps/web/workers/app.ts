import { createRequestHandler } from "react-router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRateLimit, registerRateLimit } from "../../../worker/src/middleware/rate-limit";
import { sanitize } from "../../../worker/src/middleware/sanitize";
import { verifyTurnstileToken } from "../../../worker/src/middleware/verify-turnstile";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../worker/src/db/schema";
import { chatRoutes } from "../../../worker/src/routes/chat";
import { roadmapRoutes } from "../../../worker/src/routes/roadmaps";
import { qaRoutes } from "../../../worker/src/routes/qa";
import { gamificationRoutes } from "../../../worker/src/routes/gamification";
import { battleRoutes } from "../../../worker/src/routes/battle";

// Re-export Workflow entrypoint so Miniflare can find the named entrypoint
export { ContentGenerationWorkflow } from "../../../worker/src/workflows/ContentGenerationWorkflow";
export { BattleRoom } from "../../../worker/src/durable-objects/BattleRoom";
export { BattleQuestionGenerationWorkflow } from "../../../worker/src/workflows/BattleQuestionGenerationWorkflow";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

interface AppEnv {
  DB: D1Database;
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CONTENT_WORKFLOW: Workflow;
  BATTLE_QUESTION_WORKFLOW: Workflow;
  BATTLE_ROOM: DurableObjectNamespace;
  RATE_LIMITER_AUTH: RateLimit;
  RATE_LIMITER_REGISTER: RateLimit;
  RATE_LIMITER_BATTLE_CREATE: RateLimit;
  RATE_LIMITER_BATTLE_JOIN: RateLimit;
}

// ---------------------------------------------------------------------------
// PBKDF2 password hashing — Workers-compatible replacement for @noble/hashes
// scrypt.
//
// Why: @noble/hashes scryptAsync relies on Date.now() to decide when to yield
// control back to the event loop (asyncLoop). In Cloudflare Workers, Date.now()
// is frozen to the request start timestamp for the duration of the request, so
// the yield never fires. scrypt then runs as a tight synchronous loop across
// all N=16384 iterations, exceeding the Workers CPU-time budget and causing
// workerd to close the connection — resulting in "fetch failed" at Miniflare.
//
// PBKDF2 via crypto.subtle uses the native runtime implementation (no JS loop)
// and never exceeds the CPU budget regardless of iteration count.
//
// Hash format: "pbkdf2v1:<iterations>:<base64url-salt>:<base64url-hash>"
// ---------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const PBKDF2_KEY_LEN = 32; // bytes

function bufToBase64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuf(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pbkdf2Hash(password: string): Promise<string> {
  const enc = new TextEncoder();
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    PBKDF2_KEY_LEN * 8
  );
  return `pbkdf2v1:${PBKDF2_ITERATIONS}:${bufToBase64url(saltBytes)}:${bufToBase64url(derived)}`;
}

async function pbkdf2Verify({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const parts = hash.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2v1") return false;
  const iterations = parseInt(parts[1], 10);
  const saltBytes = base64urlToBuf(parts[2]);
  const expectedHash = base64urlToBuf(parts[3]);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes as BufferSource,
      iterations,
      hash: PBKDF2_HASH,
    },
    keyMaterial,
    expectedHash.byteLength * 8
  );
  // Constant-time comparison
  const a = new Uint8Array(derived);
  const b = expectedHash;
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Auth instance cache — one betterAuth instance per D1 binding reference.
// Workers isolates are reused across requests; caching avoids re-running
// Better Auth's async init (Kysely adapter setup, plugin initialization) on
// every request, which also prevents the globalThis context from being reset
// mid-flight on concurrent requests.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authCache = new WeakMap<D1Database, any>();

function getOrCreateAuth(env: AppEnv, requestUrl: string) {
  const cached = authCache.get(env.DB);
  if (cached) return cached;

  const db = drizzle(env.DB, { schema });
  const requestOrigin = new URL(requestUrl).origin;
  const baseURL = env.PUBLIC_URL || requestOrigin;
  // Trust both configured PUBLIC_URL and the actual request origin
  const origins = new Set([baseURL, requestOrigin]);

  const auth = betterAuth({
    baseURL: requestOrigin,
    database: drizzleAdapter(db, { provider: "sqlite", usePlural: true, schema }),
    trustedOrigins: [...origins],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // Disable for dev — no email provider yet
      password: {
        hash: pbkdf2Hash,
        verify: pbkdf2Verify,
      },
      sendResetPassword: async ({ url, user }) => {
        console.log(`[DEV] Password reset for ${user.email}: ${url}`);
      },
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GITHUB_CLIENT_ID
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
    },
    plugins: [multiSession({ maximumSessions: 3 })],
  });

  authCache.set(env.DB, auth);
  return auth;
}

// Hono API for /api/* routes
const api = new Hono<{ Bindings: AppEnv }>();
api.use("/*", cors());
api.use("/api/*", sanitize);
api.use("/api/auth/*", authRateLimit, registerRateLimit);

// T-01-06: Turnstile CAPTCHA required on sign-up to mitigate bot registrations.
// Runs before the Better Auth handler so failed verifications short-circuit
// without consuming the rate-limit budget on the real auth path.
api.use("/api/auth/sign-up/email", async (c, next) => {
  const token = c.req.header("cf-turnstile-response");
  if (!token) {
    return c.json(
      { error: "CAPTCHA required", turnstileRequired: true },
      403
    );
  }

  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const valid = await verifyTurnstileToken(
    token,
    c.env.TURNSTILE_SECRET_KEY,
    ip
  );
  if (!valid) {
    return c.json(
      { error: "CAPTCHA verification failed", turnstileRequired: true },
      403
    );
  }

  await next();
});

api.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const auth = getOrCreateAuth(c.env, c.req.url);
  try {
    const authRes = await auth.handler(c.req.raw);
    // Materialize the body before returning. Better Auth's response body is a
    // ReadableStream created inside the Workers V8 context. Returning the raw
    // Response object causes workerd to crash when it tries to serialize 4xx
    // responses back through Miniflare's dispatchFetch — the connection is
    // closed before a valid HTTP response is sent (manifests as "fetch failed"
    // at Miniflare). Reading the body as text and constructing a fresh Response
    // gives workerd a plain string body it can reliably transmit.
    const body = await authRes.text();
    return new Response(body, {
      status: authRes.status,
      headers: authRes.headers,
    });
  } catch (err) {
    console.error("[auth] handler error:", String(err));
    return c.json({ error: "Internal server error" }, 500);
  }
});

api.get("/api/health", (c) => c.json({ status: "ok" }));

api.route("/api/chat", chatRoutes);
api.route("/api/roadmaps", roadmapRoutes);
api.route("/api/qa", qaRoutes);
api.route("/api/user", gamificationRoutes);
api.route("/api/battle", battleRoutes);

// React Router for everything else
const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route /api/* to Hono
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env as unknown as AppEnv, ctx);
    }

    // Everything else goes to React Router
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
