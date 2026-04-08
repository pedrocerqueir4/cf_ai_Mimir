import { createRequestHandler } from "react-router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../worker/src/db/schema";
import { chatRoutes } from "../../../worker/src/routes/chat";
import { roadmapRoutes } from "../../../worker/src/routes/roadmaps";
import { qaRoutes } from "../../../worker/src/routes/qa";

// Re-export Workflow entrypoint so Miniflare can find the named entrypoint
export { ContentGenerationWorkflow } from "../../../worker/src/workflows/ContentGenerationWorkflow";

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
}

function createAuth(env: AppEnv, requestUrl: string) {
  const db = drizzle(env.DB, { schema });
  const requestOrigin = new URL(requestUrl).origin;
  const baseURL = env.PUBLIC_URL || requestOrigin;
  // Trust both configured PUBLIC_URL and the actual request origin (handles network IP access in dev)
  const origins = new Set([baseURL, requestOrigin]);
  return betterAuth({
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
      sendVerificationEmail: async ({ url, user }) => {
        console.log(`[DEV] Verify email for ${user.email}: ${url}`);
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
    advanced: {
      defaultCallbackURL: "/auth/sign-in",
    },
  });
}

// Hono API for /api/* routes
const api = new Hono<{ Bindings: AppEnv }>();
api.use("/*", cors());

api.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env, c.req.url);
  return auth.handler(c.req.raw);
});

api.get("/api/health", (c) => c.json({ status: "ok" }));

api.route("/api/chat", chatRoutes);
api.route("/api/roadmaps", roadmapRoutes);
api.route("/api/qa", qaRoutes);

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
