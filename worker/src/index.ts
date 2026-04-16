import { Hono } from "hono";
import { cors } from "hono/cors";
import { sanitize } from "./middleware/sanitize";
import { createAuth } from "./auth";
import { authGuard, type AuthVariables } from "./middleware/auth-guard";
import { authRateLimit } from "./middleware/rate-limit";
import {
  requireTurnstileAfterFailures,
} from "./middleware/verify-turnstile";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.use("/*", cors());
app.use("/api/*", sanitize);

// Rate limit all auth endpoints (SEC-02)
app.use("/api/auth/*", authRateLimit);

// D-05: Turnstile enforcement on sign-in after 5 failures
app.post("/api/auth/sign-in/*", requireTurnstileAfterFailures);

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
