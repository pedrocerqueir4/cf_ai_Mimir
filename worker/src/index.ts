import { Hono } from "hono";
import { cors } from "hono/cors";
import { sanitize } from "./middleware/sanitize";
import { createAuth } from "./auth";
import { authGuard } from "./middleware/auth-guard";

type Env = {
  DB: D1Database;
  RATE_LIMITER_AUTH: RateLimit;
  RATE_LIMITER_REGISTER: RateLimit;
  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());
app.use("/api/*", sanitize);

// Rate limiting and Turnstile imports will be added below (Task 2)

// Better Auth handles all auth routes
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Protected routes use authGuard middleware
app.use("/api/protected/*", authGuard);

// Example protected endpoint to verify auth works
app.get("/api/protected/me", (c) => {
  const userId = c.get("userId");
  return c.json({ userId });
});

app.get("/api/health", (c) => c.json({ status: "ok" }));

export default app;
