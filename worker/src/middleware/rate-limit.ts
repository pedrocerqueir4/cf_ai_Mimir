import type { Context, Next } from "hono";

export async function authRateLimit(c: Context<{ Bindings: Env }>, next: Next) {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER_AUTH.limit({ key: ip });
  if (!success) {
    return c.json(
      { error: "Too many attempts. Wait a few minutes before trying again." },
      429
    );
  }
  await next();
}

export async function registerRateLimit(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER_REGISTER.limit({ key: ip });
  if (!success) {
    return c.json(
      { error: "Too many attempts. Wait a few minutes before trying again." },
      429
    );
  }
  await next();
}

// Phase 4 — Battle create rate-limit (T-04-DOS-CREATE).
// Keyed by session userId (preferred; battleRoutes apply authGuard before this
// middleware runs, so c.get("userId") is always populated in production). Falls
// back to CF-Connecting-IP if userId is unset (defence-in-depth for test
// setups that construct bare middleware without the authGuard ahead of it).
export async function battleCreateRateLimit(
  c: Context<{ Bindings: Env; Variables: { userId?: string } }>,
  next: Next
) {
  const key =
    c.get("userId") ?? c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER_BATTLE_CREATE.limit({ key });
  if (!success) {
    return c.json(
      { error: "Too many battles started. Wait a minute before trying again." },
      429
    );
  }
  await next();
}

// Phase 4 — Battle join rate-limit. 10/min per user (higher than create since
// legitimate users may retry after typos / stale codes).
export async function battleJoinRateLimit(
  c: Context<{ Bindings: Env; Variables: { userId?: string } }>,
  next: Next
) {
  const key =
    c.get("userId") ?? c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.RATE_LIMITER_BATTLE_JOIN.limit({ key });
  if (!success) {
    return c.json(
      { error: "Too many join attempts. Wait a minute before trying again." },
      429
    );
  }
  await next();
}
