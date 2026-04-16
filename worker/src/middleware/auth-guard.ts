import type { Context, Next } from "hono";
import { createAuth } from "../auth";

export type AuthVariables = {
  userId: string;
  session: Record<string, unknown>;
};

export async function authGuard(c: Context<{ Bindings: Env }>, next: Next) {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  c.set("session", session);
  await next();
}
