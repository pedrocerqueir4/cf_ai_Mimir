import { createRequestHandler } from "react-router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";

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
}

function createAuth(env: AppEnv) {
  return betterAuth({
    database: drizzleAdapter(env.DB, { provider: "sqlite", usePlural: true }),
    trustedOrigins: [env.PUBLIC_URL || "http://localhost:5173"],
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
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

api.get("/api/health", (c) => c.json({ status: "ok" }));

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
