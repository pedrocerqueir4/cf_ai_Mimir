// worker/src/routes/battle.ts
//
// Phase 4 Plan 04-04 — HTTP API surface for multiplayer battles. This is the
// adapter layer between:
//   - The frontend (Plans 05-07) which builds against the JSON shapes below
//   - The BattleRoom DO (Plan 02) which owns real-time battle coordination
//   - The shared question pool service (Plan 03) which warms questions per
//     topic via Workflow
//
// Every route enforces:
//   - Better Auth session (via authGuard)
//   - Input sanitization (via sanitize) on bodied requests
//   - IDOR: users may only reach battles they host OR guest, generic 403
//     for all other cases (indistinguishable from "no such battle")
//   - Rate limits on create (5/min) and join (10/min)
//
// The WS upgrade endpoint `/api/battle/:id/ws` uses the separate
// websocketAuthGuard middleware because upgrade responses must be plain-text,
// not JSON (browsers reject JSON-bodied upgrade failures), and because
// CSWSH Origin enforcement only makes sense on this single endpoint.

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as schema from "../db/schema";
import { authGuard, type AuthVariables } from "../middleware/auth-guard";
import { sanitize } from "../middleware/sanitize";
import {
  battleCreateRateLimit,
  battleJoinRateLimit,
} from "../middleware/rate-limit";
import {
  websocketAuthGuard,
  type BattleWSVariables,
} from "../middleware/websocket-auth-guard";
import { verifyOwnership } from "../middleware/idor-check";
import { generateUniqueCode } from "../lib/join-code";
import { computeWagerAmount, type WagerTier } from "../lib/battle-scoring";
import { findOrQueueTopic, sampleQuestions } from "../services/battle-pool";
import { assertTopicSafe } from "../validation/battle-prompts";

// ─── Types ───────────────────────────────────────────────────────────────────

type Vars = AuthVariables & Partial<BattleWSVariables>;

// ─── Zod schemas (strict request bodies) ─────────────────────────────────────

const CreateBattleBody = z.object({
  roadmapId: z.string().min(1),
  questionCount: z
    .literal(5)
    .or(z.literal(10))
    .or(z.literal(15)),
});

// Join accepts EITHER a `roadmapId` (user brings their own roadmap; server
// verifies ownership) OR a `presetTopic` (guest with no roadmaps picks from
// the BATTLE_STARTER_TOPICS list; the topic string itself is the handle, no
// IDOR check applies because nothing is being referenced). Exactly one must
// be present — the refinement below rejects both / neither.
const JoinBattleBody = z
  .object({
    joinCode: z.string().min(6).max(6),
    roadmapId: z.string().min(1).optional(),
    presetTopic: z.string().min(1).max(120).optional(),
  })
  .refine(
    (v) => Boolean(v.roadmapId) !== Boolean(v.presetTopic),
    { message: "Exactly one of roadmapId or presetTopic is required" },
  );

// T-04-03: server-side enum hard-gate. Any non-{10,15,20} value rejected at
// parse time. `computeWagerAmount` assumes the tier is one of these three.
const SubmitWagerBody = z.object({
  tier: z.literal(10).or(z.literal(15)).or(z.literal(20)),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const LOBBY_EXPIRY_MS = 5 * 60 * 1000;

/**
 * Pick a uniformly-random byte via crypto.getRandomValues and branch on the
 * high bit. Gives a bias-free 50/50 decision for the roadmap / tier coin flip
 * (D-01 / D-17-RANDOM-TIER).
 */
function coinFlip(): boolean {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  return b[0] >= 128;
}

/**
 * Manual battle-membership check — battles row has TWO owner columns
 * (host_id, guest_id) so verifyOwnership (which assumes a single owner column)
 * does not apply. Returns the row when the user is host OR guest, else null.
 */
async function findBattleForParticipant(
  db: ReturnType<typeof drizzle<typeof schema>>,
  battleId: string,
  userId: string,
): Promise<typeof schema.battles.$inferSelect | null> {
  const [battle] = await db
    .select()
    .from(schema.battles)
    .where(eq(schema.battles.id, battleId))
    .limit(1);
  if (!battle) return null;
  if (battle.hostId !== userId && battle.guestId !== userId) return null;
  return battle;
}

/**
 * Read current XP for a user from user_stats; returns 0 if row missing (first
 * battle of a new user). Ensures computeWagerAmount sees a number.
 */
async function readUserXp(
  db: ReturnType<typeof drizzle<typeof schema>>,
  userId: string,
): Promise<number> {
  const rows = await db
    .select({ xp: schema.userStats.xp })
    .from(schema.userStats)
    .where(eq(schema.userStats.userId, userId))
    .limit(1);
  return rows[0]?.xp ?? 0;
}

/**
 * Compute the Monday-00:00-UTC millisecond timestamp for "start of current
 * week" per D-24. UTC is DST-free, so no daylight-saving edge case applies.
 * Sunday = 0, Monday = 1, ... Saturday = 6. Rolling back `((day + 6) % 7)`
 * days lands on the most recent Monday (or the current day if today IS Monday).
 */
function startOfCurrentWeekMondayUtcMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d.getTime();
}

// ─── Router bootstrap ────────────────────────────────────────────────────────

export const battleRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

// Apply authGuard to ALL routes EXCEPT /:id/ws. The WS upgrade endpoint uses
// its own websocketAuthGuard, which also handles Origin + Upgrade-header
// checks + returns text/plain errors (browsers reject JSON on upgrade
// responses). Using c.req.path.endsWith("/ws") is safe because no other
// route in this router ends with "ws".
battleRoutes.use("/*", async (c, next) => {
  if (c.req.path.endsWith("/ws")) return next();
  return authGuard(c, next);
});

// ─── GET /leaderboard — MUST register BEFORE /:id ─────────────────────────
//
// Hono matches routes in registration order; if /:id came first it would
// match /leaderboard as a literal battle id and 404 on the IDOR check.

battleRoutes.get("/leaderboard", async (c) => {
  const windowRaw = c.req.query("window") ?? "week";
  if (windowRaw !== "week" && windowRaw !== "all") {
    return c.json({ error: "Invalid window parameter" }, 400);
  }
  const windowParam = windowRaw as "week" | "all";

  const db = drizzle(c.env.DB, { schema });
  const sinceMs = startOfCurrentWeekMondayUtcMs();
  // battle_ledger.settled_at is stored as a timestamp-seconds integer (mode:
  // timestamp via Drizzle), so compare in seconds.
  const sinceSec = Math.floor(sinceMs / 1000);

  const sinceClause =
    windowParam === "week"
      ? sql`bl.settled_at >= ${sinceSec}`
      : sql`1=1`;

  // Raw aggregation per RESEARCH.md §Leaderboard query. Drizzle's query
  // builder doesn't cleanly express CASE WHEN aggregates, so raw SQL via the
  // `sql` template tag is the idiomatic escape hatch.
  const stmt = sql`
    SELECT
      u.id AS user_id, u.name, u.image,
      COALESCE(SUM(CASE WHEN bl.winner_id = u.id THEN bl.xp_amount
                        WHEN bl.loser_id  = u.id THEN -bl.xp_amount
                        ELSE 0 END), 0) AS net_xp,
      COUNT(DISTINCT CASE WHEN bl.winner_id = u.id THEN bl.battle_id END) AS wins,
      COUNT(DISTINCT CASE WHEN bl.loser_id  = u.id THEN bl.battle_id END) AS losses
    FROM users u
    LEFT JOIN battle_ledger bl
      ON (bl.winner_id = u.id OR bl.loser_id = u.id)
      AND ${sinceClause}
    GROUP BY u.id
    HAVING net_xp <> 0
    ORDER BY net_xp DESC, u.name ASC
    LIMIT 50
  `;

  const rows = (await db.all(stmt)) as Array<{
    user_id: string;
    name: string;
    image: string | null;
    net_xp: number;
    wins: number;
    losses: number;
  }>;

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.user_id,
    name: r.name,
    image: r.image,
    netXp: Number(r.net_xp),
    wins: Number(r.wins),
    losses: Number(r.losses),
  }));

  return c.json({ window: windowParam, entries });
});

// ─── POST / — create battle (04-01, MULT-01) ─────────────────────────────

battleRoutes.post("/", sanitize, battleCreateRateLimit, async (c) => {
  const userId = c.get("userId")!;
  const db = drizzle(c.env.DB, { schema });

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = CreateBattleBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const { roadmapId, questionCount } = parsed.data;

  // IDOR: host can only battle on their own roadmap.
  const roadmap = await verifyOwnership(
    db as any,
    schema.roadmaps,
    roadmapId,
    userId,
    schema.roadmaps.id,
    schema.roadmaps.userId,
  );
  if (!roadmap) {
    return c.json({ error: "Roadmap not found" }, 404);
  }

  const battleId = crypto.randomUUID();
  const joinCode = await generateUniqueCode(db);
  const createdAt = new Date();
  const createdAtMs = createdAt.getTime();

  await db.insert(schema.battles).values({
    id: battleId,
    joinCode,
    hostId: userId,
    hostRoadmapId: roadmapId,
    questionCount,
    status: "lobby",
    createdAt,
  });

  // Forward to the DO — initLobby schedules the 5-minute lobby alarm and
  // wires up persistent config.
  try {
    const id = c.env.BATTLE_ROOM.idFromName(battleId);
    const stub = c.env.BATTLE_ROOM.get(id);
    await stub.fetch(
      new Request("https://do/initLobby", {
        method: "POST",
        headers: {
          "X-Battle-Op": "initLobby",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          battleId,
          hostId: userId,
          questionCount,
          hostName: (roadmap as typeof schema.roadmaps.$inferSelect).title ?? undefined,
        }),
      }),
    );
  } catch (err) {
    // DO init failure is logged but does NOT break the HTTP response —
    // Plan 02's lobby alarm is a DEFENCE-in-depth auto-destroy; the D1 row
    // with status='lobby' remains the source of truth until joined.
    console.error("[battle create] DO initLobby failed:", String(err));
  }

  return c.json({
    battleId,
    joinCode,
    questionCount,
    hostId: userId,
    expiresAt: createdAtMs + LOBBY_EXPIRY_MS,
  });
});

// ─── POST /join — guest joins via code (04-02, MULT-01) ───────────────────

battleRoutes.post("/join", sanitize, battleJoinRateLimit, async (c) => {
  const userId = c.get("userId")!;
  const db = drizzle(c.env.DB, { schema });

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = JoinBattleBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const { joinCode, roadmapId, presetTopic } = parsed.data;

  const normalizedCode = joinCode.toUpperCase();
  const nowMs = Date.now();
  const lobbyCutoffMs = nowMs - LOBBY_EXPIRY_MS;

  // Lookup battle by joinCode + status='lobby' + createdAt > now-5min.
  const [battle] = await db
    .select()
    .from(schema.battles)
    .where(
      and(
        eq(schema.battles.joinCode, normalizedCode),
        eq(schema.battles.status, "lobby"),
      ),
    )
    .limit(1);

  if (!battle) {
    return c.json({ error: "No battle found with this code." }, 404);
  }

  // Lobby-window check (stale lobby rows that the DO's alarm hasn't
  // flipped yet). The partial UNIQUE index scopes to status='lobby' so an
  // expired row can safely linger, but UX-wise treat it as gone.
  const createdAtMs = battle.createdAt.getTime();
  if (createdAtMs < lobbyCutoffMs) {
    // WR-06: fire-and-forget cleanup of the zombie row so the partial
    // UNIQUE(join_code, status='lobby') index frees up. The DO's
    // expireLobby alarm is best-effort — a missed D1 write leaves the
    // status='lobby' row pinned forever without this sweeper.
    try {
      await db
        .update(schema.battles)
        .set({ status: "expired" })
        .where(eq(schema.battles.id, battle.id));
    } catch (err) {
      console.error(
        "[battle join] zombie-lobby cleanup failed",
        JSON.stringify({ battleId: battle.id, err: String(err) }),
      );
    }
    return c.json({ error: "No battle found with this code." }, 404);
  }

  if (battle.hostId === userId) {
    return c.json({ error: "Cannot join your own battle." }, 400);
  }
  if (battle.guestId) {
    return c.json({ error: "This battle already has two players." }, 400);
  }

  // IDOR: guest must own the roadmap they're bringing to the battle.
  // Preset-topic branch is exempt because there is no referenced entity to
  // own — the topic string IS the handle, validated by `assertTopicSafe`
  // to bound length / reject injection sentinels.
  let typedGuestRoadmap: typeof schema.roadmaps.$inferSelect | null = null;
  let presetTopicSafe: string | null = null;
  if (presetTopic) {
    try {
      assertTopicSafe(presetTopic);
    } catch {
      return c.json({ error: "Invalid topic" }, 400);
    }
    presetTopicSafe = presetTopic;
  } else {
    const guestRoadmap = await verifyOwnership(
      db as any,
      schema.roadmaps,
      roadmapId!,
      userId,
      schema.roadmaps.id,
      schema.roadmaps.userId,
    );
    if (!guestRoadmap) {
      return c.json({ error: "Roadmap not found" }, 404);
    }
    typedGuestRoadmap = guestRoadmap as typeof schema.roadmaps.$inferSelect;
  }

  // Fetch host's roadmap — it's guaranteed to exist because it was
  // validated at create time, but we need its topic for the pool lookup.
  const [hostRoadmapRow] = await db
    .select()
    .from(schema.roadmaps)
    .where(eq(schema.roadmaps.id, battle.hostRoadmapId))
    .limit(1);

  if (!hostRoadmapRow) {
    return c.json({ error: "Host roadmap not found" }, 500);
  }

  // Coin-flip — server picks winning roadmap uniformly (D-01). When the
  // guest is on a preset, the guest side has no roadmap row, so we synthesize
  // a `{ id: null, topic: presetTopicSafe }` shape for the winning-side
  // branch. The winning roadmap id will be null in that case, but
  // `winningTopic` still drives the pool lookup which is what matters.
  const winnerIsHost = coinFlip();
  const guestSideRoadmap:
    | typeof schema.roadmaps.$inferSelect
    | { id: null; topic: string } =
    typedGuestRoadmap ?? { id: null, topic: presetTopicSafe! };
  const winningRoadmap = winnerIsHost ? hostRoadmapRow : guestSideRoadmap;

  // Update battles row with guest + coin-flip result. Status transitions to
  // 'pre-battle' regardless of pool state — the pre-battle phase spans both
  // lobby-closed and questions-loading states. On a preset-topic join the
  // guest has no roadmap of their own; `guestRoadmapId` and (if preset won
  // the flip) `winningRoadmapId` both stay null — `winningTopic` alone
  // drives the downstream pool lookup.
  await db
    .update(schema.battles)
    .set({
      guestId: userId,
      guestRoadmapId: typedGuestRoadmap?.id ?? null,
      winningRoadmapId: winningRoadmap.id ?? null,
      winningTopic: winningRoadmap.topic,
      status: "pre-battle",
    })
    .where(eq(schema.battles.id, battle.id));

  // Notify the DO — attachGuest cancels the lobby alarm + advances to
  // pre-battle phase.
  try {
    const id = c.env.BATTLE_ROOM.idFromName(battle.id);
    const stub = c.env.BATTLE_ROOM.get(id);
    await stub.fetch(
      new Request("https://do/attachGuest", {
        method: "POST",
        headers: {
          "X-Battle-Op": "attachGuest",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ guestId: userId }),
      }),
    );
  } catch (err) {
    console.error("[battle join] DO attachGuest failed:", String(err));
  }

  // Pool lookup — hit returns sampled questions for immediate ready; miss
  // triggers a Workflow and returns 202 generating.
  let lookup: Awaited<ReturnType<typeof findOrQueueTopic>>;
  try {
    lookup = await findOrQueueTopic(c.env, winningRoadmap.topic, {
      count: battle.questionCount as 5 | 10 | 15,
      reserveCount: 5,
      seed: battle.id,
    });
  } catch (err) {
    console.error("[battle join] findOrQueueTopic failed:", String(err));
    return c.json({ error: "Failed to warm question pool" }, 500);
  }

  // Persist poolTopicId on the battles row so Plan 08 / Plan 05-07 can poll.
  await db
    .update(schema.battles)
    .set({ poolTopicId: lookup.poolTopicId })
    .where(eq(schema.battles.id, battle.id));

  if (lookup.status === "hit") {
    // Pool is ready — forward the sampled questions to the DO for broadcast
    // on startBattle.
    try {
      const id = c.env.BATTLE_ROOM.idFromName(battle.id);
      const stub = c.env.BATTLE_ROOM.get(id);
      await stub.fetch(
        new Request("https://do/setQuestions", {
          method: "POST",
          headers: {
            "X-Battle-Op": "setQuestions",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            questions: lookup.questions,
            reservedQuestions: lookup.reservedQuestions,
          }),
        }),
      );
    } catch (err) {
      console.error("[battle join] DO setQuestions failed:", String(err));
    }

    return c.json({
      status: "ready" as const,
      battleId: battle.id,
      winningRoadmapId: winningRoadmap.id ?? null,
      winningTopic: winningRoadmap.topic,
      poolTopicId: lookup.poolTopicId,
    });
  }

  // MISS or GENERATING — client polls battles row until poolStatus flips
  // to 'ready', then issues startBattle.
  return c.json(
    {
      status: "generating" as const,
      battleId: battle.id,
      winningRoadmapId: winningRoadmap.id ?? null,
      winningTopic: winningRoadmap.topic,
      poolTopicId: lookup.poolTopicId,
      workflowRunId: lookup.workflowRunId,
    },
    202,
  );
});

// ─── POST /:id/wager — wager proposal (04-12, 04-14, 04-18) ───────────────

battleRoutes.post("/:id/wager", sanitize, async (c) => {
  const userId = c.get("userId")!;
  const battleId = c.req.param("id")!;
  const db = drizzle(c.env.DB, { schema });

  const battle = await findBattleForParticipant(db, battleId, userId);
  if (!battle) {
    return c.text("Forbidden", 403);
  }
  if (battle.status !== "pre-battle") {
    return c.json({ error: "Battle is not accepting wager proposals" }, 409);
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = SubmitWagerBody.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid wager tier" }, 400);
  }
  const { tier } = parsed.data;

  // Record the user's proposed tier.
  const isHost = battle.hostId === userId;
  const xpAtProposal = await readUserXp(db, userId);

  if (isHost) {
    await db
      .update(schema.battles)
      .set({ hostWagerTier: tier })
      .where(eq(schema.battles.id, battleId));
  } else {
    await db
      .update(schema.battles)
      .set({ guestWagerTier: tier })
      .where(eq(schema.battles.id, battleId));
  }

  // Re-read battle to check whether BOTH sides have now proposed.
  const [updated] = await db
    .select()
    .from(schema.battles)
    .where(eq(schema.battles.id, battleId))
    .limit(1);

  const bothProposed =
    !!updated && updated.hostWagerTier != null && updated.guestWagerTier != null;

  if (!bothProposed || !updated) {
    return c.json({
      tier,
      xpAtProposal,
      bothProposed: false,
    });
  }

  // Both proposed — server picks applied tier with a crypto-secure coin
  // flip (D-17-RANDOM-TIER). Re-read BOTH players' XP (04-18) so the final
  // wager amounts reflect any drift between proposal and now.
  const appliedTier = coinFlip()
    ? (updated.hostWagerTier as WagerTier)
    : (updated.guestWagerTier as WagerTier);

  const hostXp = await readUserXp(db, updated.hostId);
  const guestXp = updated.guestId
    ? await readUserXp(db, updated.guestId)
    : 0;

  const hostWagerAmount = computeWagerAmount(hostXp, appliedTier);
  const guestWagerAmount = computeWagerAmount(guestXp, appliedTier);

  await db
    .update(schema.battles)
    .set({
      appliedWagerTier: appliedTier,
      hostWagerAmount,
      guestWagerAmount,
      wagerAmount: hostWagerAmount + guestWagerAmount,
    })
    .where(eq(schema.battles.id, battleId));

  return c.json({
    tier,
    xpAtProposal,
    bothProposed: true,
    appliedTier,
    hostWagerAmount,
    guestWagerAmount,
  });
});

// ─── POST /:id/start — host transitions pre-battle → active ────────────

battleRoutes.post("/:id/start", async (c) => {
  const userId = c.get("userId")!;
  const battleId = c.req.param("id")!;
  const db = drizzle(c.env.DB, { schema });

  const battle = await findBattleForParticipant(db, battleId, userId);
  if (!battle) {
    return c.text("Forbidden", 403);
  }
  if (battle.hostId !== userId) {
    // Only host can start — guest trying to start is a 403 (same shape as
    // non-participant so we don't leak whether the request has a user at all).
    return c.text("Forbidden", 403);
  }
  if (battle.status !== "pre-battle") {
    return c.json({ error: "Battle cannot be started from its current state" }, 409);
  }
  if (battle.appliedWagerTier == null) {
    return c.json({ error: "Both players must propose a wager first" }, 409);
  }

  // 04-18: RE-compute wager amounts from CURRENT XP one more time at start,
  // so any drift between propose-time and start-time is caught. Persist the
  // re-validated values; the pre-existing values are overwritten.
  const appliedTier = battle.appliedWagerTier as WagerTier;
  const hostXp = await readUserXp(db, battle.hostId);
  const guestXp = battle.guestId ? await readUserXp(db, battle.guestId) : 0;
  const hostWagerAmount = computeWagerAmount(hostXp, appliedTier);
  const guestWagerAmount = computeWagerAmount(guestXp, appliedTier);
  const pot = hostWagerAmount + guestWagerAmount;

  await db
    .update(schema.battles)
    .set({
      hostWagerAmount,
      guestWagerAmount,
      wagerAmount: pot,
      status: "active",
    })
    .where(eq(schema.battles.id, battleId));

  // Forward to the DO — startBattle transitions phase + broadcasts Q0.
  try {
    const id = c.env.BATTLE_ROOM.idFromName(battleId);
    const stub = c.env.BATTLE_ROOM.get(id);
    await stub.fetch(
      new Request("https://do/startBattle", {
        method: "POST",
        headers: {
          "X-Battle-Op": "startBattle",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ wagerAmount: pot }),
      }),
    );
  } catch (err) {
    console.error("[battle start] DO startBattle failed:", String(err));
  }

  return c.json({
    ok: true,
    appliedTier,
    hostWagerAmount,
    guestWagerAmount,
  });
});

// ─── POST /:id/cancel — host-only cancel ────────────────────────────────

battleRoutes.post("/:id/cancel", async (c) => {
  const userId = c.get("userId")!;
  const battleId = c.req.param("id")!;
  const db = drizzle(c.env.DB, { schema });

  const battle = await findBattleForParticipant(db, battleId, userId);
  if (!battle) return c.text("Forbidden", 403);
  if (battle.hostId !== userId) return c.text("Forbidden", 403);
  if (battle.status !== "lobby" && battle.status !== "pre-battle") {
    return c.json({ error: "Battle cannot be cancelled" }, 409);
  }

  await db
    .update(schema.battles)
    .set({ status: "expired" })
    .where(eq(schema.battles.id, battleId));

  // Plan 02 DO has no explicit expireLobby op; its lobby alarm auto-fires
  // at 5min. We rely on that here — battle row is already marked expired so
  // Plan 04 endpoints respond consistently in the meantime.

  return c.json({ ok: true });
});

// ─── GET /:id — lobby state ────────────────────────────────────────────

battleRoutes.get("/:id", async (c) => {
  const userId = c.get("userId")!;
  const battleId = c.req.param("id")!;
  const db = drizzle(c.env.DB, { schema });

  const battle = await findBattleForParticipant(db, battleId, userId);
  if (!battle) {
    // Generic 403 — same body for non-existent and non-participant to
    // prevent enumeration.
    return c.text("Forbidden", 403);
  }

  // Fetch host + guest user info (name).
  const userIds = [battle.hostId];
  if (battle.guestId) userIds.push(battle.guestId);
  const userRows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
    })
    .from(schema.users)
    .where(
      userIds.length === 2
        ? sql`${schema.users.id} IN (${userIds[0]}, ${userIds[1]})`
        : eq(schema.users.id, userIds[0]),
    );
  const userMap = new Map(userRows.map((u) => [u.id, u.name]));

  // Fetch roadmap titles.
  const roadmapIds = [battle.hostRoadmapId];
  if (battle.guestRoadmapId) roadmapIds.push(battle.guestRoadmapId);
  const roadmapRows = await db
    .select({
      id: schema.roadmaps.id,
      title: schema.roadmaps.title,
    })
    .from(schema.roadmaps)
    .where(
      roadmapIds.length === 2
        ? sql`${schema.roadmaps.id} IN (${roadmapIds[0]}, ${roadmapIds[1]})`
        : eq(schema.roadmaps.id, roadmapIds[0]),
    );
  const roadmapMap = new Map(roadmapRows.map((r) => [r.id, r.title]));

  // Fetch pool status if a poolTopicId is attached.
  let poolStatus: "generating" | "ready" | "failed" | null = null;
  if (battle.poolTopicId) {
    const [topicRow] = await db
      .select({ status: schema.battlePoolTopics.status })
      .from(schema.battlePoolTopics)
      .where(eq(schema.battlePoolTopics.id, battle.poolTopicId))
      .limit(1);
    poolStatus =
      (topicRow?.status as "generating" | "ready" | "failed" | undefined) ??
      null;
  }

  const createdAtMs = battle.createdAt.getTime();
  const expiresAt =
    battle.status === "lobby" ? createdAtMs + LOBBY_EXPIRY_MS : null;

  return c.json({
    battleId: battle.id,
    joinCode: battle.joinCode,
    status: battle.status,
    hostId: battle.hostId,
    hostName: userMap.get(battle.hostId) ?? "",
    hostRoadmapTitle: roadmapMap.get(battle.hostRoadmapId) ?? "",
    hostWagerTier: battle.hostWagerTier,
    guestId: battle.guestId,
    guestName: battle.guestId ? (userMap.get(battle.guestId) ?? null) : null,
    guestRoadmapTitle: battle.guestRoadmapId
      ? (roadmapMap.get(battle.guestRoadmapId) ?? null)
      : null,
    guestWagerTier: battle.guestWagerTier,
    appliedWagerTier: battle.appliedWagerTier,
    questionCount: battle.questionCount,
    winningRoadmapId: battle.winningRoadmapId,
    winningTopic: battle.winningTopic,
    poolStatus,
    createdAt: createdAtMs,
    expiresAt,
  });
});

// ─── GET /:id/ws — WebSocket upgrade → DO forward ──────────────────────

battleRoutes.get("/:id/ws", websocketAuthGuard, async (c) => {
  const userId = c.get("userId")!;
  const battleId = c.get("battleId")!;
  const role = c.get("role")!;

  const id = c.env.BATTLE_ROOM.idFromName(battleId);
  const stub = c.env.BATTLE_ROOM.get(id);

  const forwardReq = new Request(c.req.raw, {
    headers: {
      ...Object.fromEntries(c.req.raw.headers.entries()),
      "X-Battle-User-Id": userId,
      "X-Battle-Role": role,
      "X-Battle-Id": battleId,
    },
  });
  return stub.fetch(forwardReq);
});
