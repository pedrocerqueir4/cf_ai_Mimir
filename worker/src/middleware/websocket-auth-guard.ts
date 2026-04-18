// worker/src/middleware/websocket-auth-guard.ts
//
// Phase 4 — WebSocket upgrade auth guard for /api/battle/:id/ws (D-34).
//
// Responsibilities (T-04-08 mitigation):
//   1. 426 unless the request carries `Upgrade: websocket`.
//   2. 403 unless Origin header is in the allowlist {PUBLIC_URL, requestOrigin}
//      (CSWSH prevention per RESEARCH.md §Pitfall 9).
//   3. 401 unless Better Auth returns a valid session.
//   4. Generic 403 (same response body for "no such battle" AND
//      "not-a-participant") — prevents battleId enumeration via differential
//      responses.
//
// On success: sets Variables.userId/battleId/role so the downstream WS upgrade
// handler can forward them to the DO via X-Battle-User-Id / X-Battle-Role /
// X-Battle-Id headers.
//
// Separate from `authGuard` (routes/auth-guard.ts) because:
//   - Upgrade-response failures must be text/plain (browsers reject handshake
//     responses with JSON bodies) — `c.text(...)` over `c.json(...)`.
//   - CSWSH + Upgrade-verb checks only make sense on this single endpoint.

import type { Context, Next } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { createAuth } from "../auth";
import * as schema from "../db/schema";

export type BattleWSVariables = {
  userId: string;
  battleId: string;
  role: "host" | "guest";
};

export async function websocketAuthGuard(
  c: Context<{ Bindings: Env; Variables: BattleWSVariables }>,
  next: Next,
) {
  // 1. Must be an Upgrade request.
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 426);
  }

  // 2. CSWSH prevention — Origin allowlist.
  const origin = c.req.header("Origin");
  const publicUrl = c.env.PUBLIC_URL;
  const requestOrigin = new URL(c.req.url).origin;
  const allowed = new Set(
    [publicUrl, requestOrigin].filter((v): v is string => !!v),
  );
  if (!origin || !allowed.has(origin)) {
    return c.text("Forbidden origin", 403);
  }

  // 3. Better Auth session validation.
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.text("Unauthorized", 401);
  }

  // 4. Battle membership check (IDOR — generic 403 for both miss AND
  //    non-participant so the two failure modes are indistinguishable to
  //    an attacker probing battleId values).
  const battleId = c.req.param("id");
  if (!battleId) return c.text("Bad request", 400);

  const db = drizzle(c.env.DB, { schema });
  const [battle] = await db
    .select()
    .from(schema.battles)
    .where(eq(schema.battles.id, battleId))
    .limit(1);

  if (!battle) return c.text("Forbidden", 403);
  if (
    battle.hostId !== session.user.id &&
    battle.guestId !== session.user.id
  ) {
    return c.text("Forbidden", 403);
  }

  c.set("userId", session.user.id);
  c.set("battleId", battleId);
  c.set("role", battle.hostId === session.user.id ? "host" : "guest");
  await next();
}
