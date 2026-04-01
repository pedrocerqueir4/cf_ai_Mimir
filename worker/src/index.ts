import { Hono } from "hono";
import { cors } from "hono/cors";
import { sanitize } from "./middleware/sanitize";

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

// Auth routes will be mounted in Plan 02

app.get("/api/health", (c) => c.json({ status: "ok" }));

export default app;
