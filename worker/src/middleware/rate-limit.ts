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
