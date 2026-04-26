// worker/src/durable-objects/BattleRoom.ts
// Phase 4 — BattleRoom Durable Object.
//
// One DO per battle (named via env.BATTLE_ROOM.idFromName(battleId)). Coordinates
// real-time head-to-head quiz battles: question broadcast, per-question 15s
// alarm timer, server-authoritative scoring, multi-tab eviction, sudden-death
// tiebreaker, idle-forfeit. XP settlement + full reconnect snapshot are
// deferred to Plan 08 (wiring TODOs clearly marked).
//
// CRITICAL RULES (enforced by plan's <done> greps):
//   1. The FIRST non-comment statement of `webSocketMessage` body is
//      `const receivedAtMs = Date.now();`. No imports, no logging, no reads
//      before this line. (T-04-02)
//   2. No setTimeout/setInterval anywhere — alarms only (D-31, Pitfall 1).
//   3. `correctOptionId` NEVER appears in the `question` broadcast event —
//      only in the `reveal` event after both answered or timeout.
//   4. Between the `ctx.storage.get` (runtime+config) and the matching
//      `ctx.storage.put` in `webSocketMessage`, there are ZERO `await`
//      expressions. The input gate serialises webSocketMessage; a
//      synchronous critical section is our only way to prevent interleave.
//   5. All timers use `this.ctx.storage.setAlarm`. One alarm per DO.

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import {
  BattleInboundSchema,
  type BattleInbound,
  type BattleClientHelloT,
} from "../validation/battle-schemas";
import {
  computeBattleScore,
  BATTLE_TIME_LIMIT_MS,
} from "../lib/battle-scoring";
import { computeLevel } from "../lib/xp";
import { markPoolTopicFailed } from "../workflows/BattleQuestionGenerationWorkflow";

// ─── Constants ───────────────────────────────────────────────────────────────

const LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // D-04
const POST_END_GRACE_MS = 30 * 1000; // D-28
const IDLE_FORFEIT_MISS_COUNT = 3; // D-26
const DISCONNECT_GRACE_MS = 30 * 1000; // D-25: 30s reconnect grace
// Gap 04-12: pool-generating timeout scheduled at end of opAttachGuest.
// If the battle sits in pre-battle with poolStatus='generating' for this
// long, alarm() flips poolStatus='failed' so the frontend's existing
// error pane fires deterministically. 60s pairs with the frontend's 45s
// stuck-pane watchdog (POOL_STUCK_THRESHOLD_MS): frontend surfaces the
// recoverable "Cancel / Keep-waiting / Retry" CTAs 15s BEFORE the backend
// force-fails, so a user clicking "Keep waiting" isn't immediately bounced
// to the error pane.
const POOL_TIMEOUT_MS = 60 * 1000;
const CLOSE_CODE_MOVED = 4001;
const CLOSE_CODE_INVALID = 4002;

// ─── Persistent state types (exported for test harness) ──────────────────────

export type BattlePhase =
  | "lobby"
  | "pre-battle"
  | "active"
  | "tiebreak"
  | "opponent-reconnecting" // D-25: one player disconnected, grace window active
  | "ended"
  | "expired"
  | "forfeited";

// Disconnect bucket — stored in ctx.storage under key "disconnect".
// Captures the state we need to resume a paused battle on reconnect.
export interface DisconnectRecord {
  userId: string;
  disconnectedAtMs: number;
  pausedQuestionRemainingMs: number;
  preDisconnectPhase: "active" | "tiebreak";
}

export interface BattleQuizQuestion {
  id: string;
  questionText: string;
  questionType: "mcq" | "true_false";
  options: Array<{ id: string; text: string }>;
  correctOptionId: string; // NEVER broadcast in question events
  explanation: string;
}

export interface BattleConfig {
  battleId: string;
  hostId: string;
  guestId: string | null; // null in lobby phase
  questionCount: 5 | 10 | 15;
  questions: BattleQuizQuestion[];
  reservedQuestions: BattleQuizQuestion[]; // unused pool for tiebreakers
  hostName?: string;
  guestName?: string;
  wagerAmount?: number; // populated at battle-start (Plan 08)
}

export interface AnswerRecord {
  optionId: string | null; // null = timed out
  correct: boolean;
  points: number;
  responseTimeMs: number;
  receivedAtMs: number;
}

export interface BattleRuntime {
  phase: BattlePhase;
  currentQuestionIndex: number; // 0-based; -1 before start
  questionStartedAtMs: number;
  scores: Record<string, number>;
  answered: Record<number, Record<string, AnswerRecord>>;
  consecutiveMiss: Record<string, number>;
  tiebreakerRound: number; // 0 during regular; 1+ during sudden-death
  endBroadcasted?: boolean;
}

export interface SocketAttachment {
  userId: string;
  role: "host" | "guest";
  connectedAtMs: number;
}

// ─── Op-routing envelope ─────────────────────────────────────────────────────
//
// HTTP routes (Plan 04) send operations to the DO via `stub.fetch(request)` with
// a custom `X-Battle-Op` header naming the op. Payloads arrive as JSON body.
// Ops do not upgrade the request — they're plain POST-style.
//
// Supported ops (first-party, Plan 04 HTTP wires them):
//   initLobby      — host creates the battle; schedules 5-minute lobby alarm
//   attachGuest    — guest joins; cancels the lobby alarm
//   setQuestions   — pool-loader attaches the full question list + reserves
//   startBattle    — transitions pre-battle → active; broadcasts question 0
//   snapshot       — debug/inspect DO storage (returns JSON of runtime+config)
//
// Test-only op (fires the currently-scheduled alarm synchronously for tests):
//   __testAlarm    — invokes `this.alarm()` directly regardless of scheduled time.
//                    Also reachable via vitest-pool-workers' `runDurableObjectAlarm`
//                    when an alarm is scheduled; __testAlarm remains for tests that
//                    need to force-fire an unscheduled alarm path.

// ─── Class ───────────────────────────────────────────────────────────────────

export class BattleRoom extends DurableObject<Env> {
  // No in-memory state — all persistent state lives in ctx.storage (survives
  // hibernation + isolate eviction). `this.env` and `this.ctx` come from
  // `DurableObject<Env>`.

  // ── Entry point ────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWsUpgrade(request);
    }
    const op = request.headers.get("X-Battle-Op");
    if (!op) {
      return new Response("Missing X-Battle-Op", { status: 400 });
    }

    let payload: unknown = {};
    if (request.method === "POST" || request.method === "PUT") {
      try {
        const text = await request.text();
        payload = text ? JSON.parse(text) : {};
      } catch {
        return new Response("Invalid JSON payload", { status: 400 });
      }
    }

    switch (op) {
      case "initLobby":
        return this.opInitLobby(payload);
      case "attachGuest":
        return this.opAttachGuest(payload);
      case "setQuestions":
        return this.opSetQuestions(payload);
      case "startBattle":
        return this.opStartBattle(payload);
      case "snapshot":
        return this.opSnapshot();
      case "__testAlarm":
        // WR-03: test-only op; production builds MUST NOT respond. Guard by
        // the ENVIRONMENT var — only "test" unlocks. Any other value
        // (undefined in prod wrangler config) returns 404 matching an
        // unknown op, preventing accidental proxying from HTTP routes.
        if (this.env.ENVIRONMENT !== "test") {
          return new Response(`Unknown op: ${op}`, { status: 400 });
        }
        await this.alarm();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      case "__testEndBattle": {
        if (this.env.ENVIRONMENT !== "test") {
          return new Response(`Unknown op: ${op}`, { status: 400 });
        }
        const p = payload as {
          winnerId?: string | null;
          outcome?: "decisive" | "forfeit" | "both-dropped";
          hostScore?: number;
          guestScore?: number;
        };
        const cfg = await this.ctx.storage.get<BattleConfig>("config");
        const rt = await this.ctx.storage.get<BattleRuntime>("runtime");
        if (!cfg || !rt) {
          return new Response("no config/runtime", { status: 409 });
        }
        // Seed runtime scores so endBattle can persist them without
        // requiring a full simulated battle.
        if (typeof p.hostScore === "number") {
          rt.scores[cfg.hostId] = p.hostScore;
        }
        if (typeof p.guestScore === "number" && cfg.guestId) {
          rt.scores[cfg.guestId] = p.guestScore;
        }
        rt.phase = "active"; // reset any prior terminal state so endBattle proceeds
        rt.endBroadcasted = false;
        await this.ctx.storage.put("runtime", rt);
        await this.endBattle(
          p.winnerId ?? null,
          p.outcome ?? "decisive",
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      default:
        return new Response(`Unknown op: ${op}`, { status: 400 });
    }
  }

  // ── WebSocket upgrade (Hibernation accept + multi-tab eviction) ──────

  private async handleWsUpgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("X-Battle-User-Id");
    const role = (request.headers.get("X-Battle-Role") ?? "guest") as
      | "host"
      | "guest";
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Plan 08 closes the 04-25 cross-check: when a config is loaded, the
    // X-Battle-User-Id header MUST match either the host or the guest of
    // THIS battle. Worker-layer `websocketAuthGuard` already performs the
    // authoritative check, but this is defense-in-depth against direct DO
    // fetches that bypass the Worker. Generic 403 matches the Worker
    // layer's no-enumeration pattern.
    const existingConfig =
      await this.ctx.storage.get<BattleConfig>("config");
    if (existingConfig) {
      const isParticipant =
        existingConfig.hostId === userId ||
        (existingConfig.guestId !== null &&
          existingConfig.guestId === userId);
      if (!isParticipant) {
        return new Response("Forbidden", { status: 403 });
      }
    }
    // If no config exists yet (e.g. upgrade racing opInitLobby), fall
    // through; the Worker-layer guard already validated the session.

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation accept — `[userId]` is the tag, enabling filtered lookup
    // via `this.ctx.getWebSockets(userId)` for multi-tab eviction.
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({
      userId,
      role,
      connectedAtMs: Date.now(),
    } satisfies SocketAttachment);

    // D-27 multi-tab eviction: close any OLDER socket for this userId.
    // `server` is the brand-new socket we just accepted — close all others
    // that share the `userId` tag. Asserted by battle.multitab.test.ts.
    for (const existing of this.ctx.getWebSockets(userId)) {
      if (existing !== server) {
        try {
          existing.close(CLOSE_CODE_MOVED, "Battle moved to another device");
        } catch {
          // socket may already be closing — ignore
        }
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── webSocketMessage — scoring critical section ───────────────────────
  //
  // Invariant: the FIRST non-comment statement is the timestamp capture.
  // T-04-02 mitigation relies on this ordering; the plan's <done> greps
  // for the exact line.

  async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    const receivedAtMs = Date.now();
    let att: SocketAttachment;
    try {
      att = ws.deserializeAttachment() as SocketAttachment;
    } catch {
      try {
        ws.close(CLOSE_CODE_INVALID, "missing attachment");
      } catch {
        /* ignore */
      }
      return;
    }
    if (!att?.userId) {
      try {
        ws.close(CLOSE_CODE_INVALID, "missing attachment");
      } catch {
        /* ignore */
      }
      return;
    }

    // Inbound parse — BattleInboundSchema is `.strict()`, so any extra
    // field (including client-supplied score/timestamp/responseTime) is
    // rejected here before any scoring logic runs.
    let msg: BattleInbound;
    try {
      const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
      msg = BattleInboundSchema.parse(JSON.parse(text));
    } catch {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "INVALID_MESSAGE",
            message: "message rejected by schema",
          }),
        );
      } catch {
        /* ignore */
      }
      return;
    }

    if (msg.action === "hello") {
      await this.handleHello(ws, att, msg);
      return;
    }

    // msg.action === "answer"
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!runtime || !config) return;

    // ── BEGIN synchronous critical section (no awaits until the put) ──
    if (runtime.phase !== "active" && runtime.phase !== "tiebreak") return;

    const q =
      runtime.phase === "tiebreak"
        ? config.reservedQuestions[runtime.tiebreakerRound - 1]
        : config.questions[runtime.currentQuestionIndex];
    if (!q) return;

    if (runtime.answered[runtime.currentQuestionIndex]?.[att.userId]) {
      // idempotent: already scored (double-submit / late retry)
      return;
    }

    const responseTimeMs = Math.max(0, receivedAtMs - runtime.questionStartedAtMs);
    const correct = msg.optionId === q.correctOptionId;
    const points = computeBattleScore(responseTimeMs, correct);

    runtime.scores[att.userId] = (runtime.scores[att.userId] ?? 0) + points;
    runtime.answered[runtime.currentQuestionIndex] ??= {};
    runtime.answered[runtime.currentQuestionIndex][att.userId] = {
      optionId: msg.optionId,
      correct,
      points,
      responseTimeMs,
      receivedAtMs,
    };
    // D-26: any answer (right OR wrong) resets the consecutive-miss counter;
    // only null/missed answers increment it (see fillMissingAnswersAsNoAnswer).
    runtime.consecutiveMiss[att.userId] = 0;
    // ── END synchronous critical section ──

    await this.ctx.storage.put("runtime", runtime);

    this.broadcast({
      type: "score-update",
      hostScore: runtime.scores[config.hostId] ?? 0,
      guestScore: config.guestId ? (runtime.scores[config.guestId] ?? 0) : 0,
    });

    if (this.bothAnswered(runtime, config)) {
      await this.advanceQuestion();
    }
  }

  // ── Hibernation lifecycle hooks ────────────────────────────────────────

  async webSocketClose(
    ws: WebSocket,
    code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // D-27: a socket closed with CLOSE_CODE_MOVED was evicted by the
    // multi-tab guard — the user opened a second tab, so we already have
    // a live newer socket. Never trigger forfeit in that case.
    if (code === CLOSE_CODE_MOVED) return;

    let att: SocketAttachment | null;
    try {
      att = ws.deserializeAttachment() as SocketAttachment | null;
    } catch {
      return;
    }
    if (!att?.userId) return;

    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!runtime || !config) return;

    // Only start grace on an in-flight battle. Lobby/pre-battle/ended/forfeited
    // are intentionally NOT guarded — they have their own timeout paths.
    if (runtime.phase !== "active" && runtime.phase !== "tiebreak") return;

    // D-27 nuance: the user might have another live tab for THIS battle.
    // ctx.getWebSockets(userId) returns sockets tagged with userId —
    // if any survive (and aren't THIS closed one), skip the forfeit path.
    const liveForUser = this.ctx.getWebSockets(att.userId).filter(
      (s) => s !== ws,
    );
    if (liveForUser.length > 0) return;

    // Idempotency: if a disconnect bucket already exists (e.g. both
    // sockets closed in quick succession), don't overwrite the first.
    const existingDisconnect =
      await this.ctx.storage.get<DisconnectRecord>("disconnect");
    if (existingDisconnect) return;

    const nowMs = Date.now();

    // D-25 timer pause: capture the remaining question time so we can
    // resume EXACTLY where we left off on reconnect. If no question is
    // active, remaining = 0 (harmless fallthrough).
    const pausedQuestionRemainingMs = runtime.questionStartedAtMs
      ? Math.max(
          0,
          runtime.questionStartedAtMs + BATTLE_TIME_LIMIT_MS - nowMs,
        )
      : 0;

    const disconnectRecord: DisconnectRecord = {
      userId: att.userId,
      disconnectedAtMs: nowMs,
      pausedQuestionRemainingMs,
      preDisconnectPhase: runtime.phase,
    };
    await this.ctx.storage.put("disconnect", disconnectRecord);

    // Cancel the in-flight question alarm so the timer doesn't fire
    // during the grace window.
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      /* ignore */
    }

    // Schedule the 30s grace alarm (D-25). On fire, alarm() detects
    // phase === "opponent-reconnecting" and triggers endBattle(forfeit).
    await this.ctx.storage.setAlarm(nowMs + DISCONNECT_GRACE_MS);

    // Flip phase so any late-arriving answer from the opposing socket
    // won't advance the round while the grace timer is pending.
    runtime.phase = "opponent-reconnecting";
    await this.ctx.storage.put("runtime", runtime);

    // Broadcast to everyone still connected (the opposing player). The
    // disconnected user will receive the snapshot on reconnect via
    // handleHello.
    this.broadcast({
      type: "opponent-reconnecting",
      graceMs: DISCONNECT_GRACE_MS,
    });
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    // Mirror webSocketClose — a socket error without clean close is
    // treated the same as a disconnect. Delegate to the shared path.
    await this.webSocketClose(ws, 1006, "socket-error", false);
  }

  // ── Alarm dispatch ─────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    if (!runtime) return;

    // D-25: disconnect-grace alarm expiry — forfeit the disconnected user.
    // Stored in a separate ctx.storage bucket so it can be checked
    // independently of the question-timer alarm path.
    if (runtime.phase === "opponent-reconnecting") {
      const disconnect =
        await this.ctx.storage.get<DisconnectRecord>("disconnect");
      const config = await this.ctx.storage.get<BattleConfig>("config");
      if (disconnect && config) {
        const winnerId =
          disconnect.userId === config.hostId
            ? config.guestId
            : config.hostId;
        await this.ctx.storage.delete("disconnect");
        await this.endBattle(winnerId, "forfeit");
      }
      return;
    }

    switch (runtime.phase) {
      case "lobby":
        await this.expireLobby();
        return;
      case "active":
        await this.advanceQuestion();
        return;
      case "tiebreak":
        await this.advanceQuestion();
        return;
      case "ended":
      case "forfeited":
      case "expired":
        await this.destroyBattle();
        return;
      case "pre-battle": {
        // Gap 04-12: pool-generating timeout. The alarm was scheduled at
        // the end of opAttachGuest. If it fires while still in pre-battle,
        // pool generation exceeded POOL_TIMEOUT_MS. Read battles.poolTopicId
        // → battle_pool_topics.status. If still 'generating', flip it to
        // 'failed' so the frontend's existing error pane surfaces. If
        // already 'ready' or 'failed', no-op — the workflow / retry path
        // resolved it and we're racing-after-the-fact.
        const cfg = await this.ctx.storage.get<BattleConfig>("config");
        if (!cfg) return;
        try {
          const db = drizzle(this.env.DB, { schema });
          const [battleRow] = await db
            .select({ poolTopicId: schema.battles.poolTopicId })
            .from(schema.battles)
            .where(eq(schema.battles.id, cfg.battleId))
            .limit(1);
          const poolTopicId = battleRow?.poolTopicId ?? null;
          if (!poolTopicId) return;

          const [poolRow] = await db
            .select({ status: schema.battlePoolTopics.status })
            .from(schema.battlePoolTopics)
            .where(eq(schema.battlePoolTopics.id, poolTopicId))
            .limit(1);
          if (poolRow?.status === "generating") {
            await markPoolTopicFailed(this.env, poolTopicId);
            console.log(
              `[BattleRoom alarm] pool-timeout fired — marked poolTopicId="${poolTopicId}" as failed for battleId="${cfg.battleId}"`,
            );
          }
          // status === 'ready' | 'failed' → no-op.
        } catch (err) {
          console.error(
            `[BattleRoom alarm] pool-timeout branch failed for battleId="${cfg.battleId}"`,
            err,
          );
        }
        return;
      }
    }
  }

  // ── Question flow ──────────────────────────────────────────────────────

  private async startQuestion(idx: number): Promise<void> {
    const runtime = (await this.ctx.storage.get<BattleRuntime>("runtime"))!;
    const config = (await this.ctx.storage.get<BattleConfig>("config"))!;

    const now = Date.now();
    runtime.phase = runtime.phase === "tiebreak" ? "tiebreak" : "active";
    runtime.currentQuestionIndex = idx;
    runtime.questionStartedAtMs = now;
    runtime.answered[idx] ??= {};

    await this.ctx.storage.put("runtime", runtime);
    await this.ctx.storage.setAlarm(now + BATTLE_TIME_LIMIT_MS);

    const q =
      runtime.phase === "tiebreak"
        ? config.reservedQuestions[runtime.tiebreakerRound - 1]
        : config.questions[idx];
    if (!q) return;

    // Explicitly strip `correctOptionId` and `explanation` — never broadcast.
    // T-04-REVEAL-LEAK mitigation is anchored to this line; keep explicit.
    this.broadcast({
      type: "question",
      questionIndex: idx,
      totalQuestions: config.questions.length,
      questionText: q.questionText,
      questionType: q.questionType,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
      timeLimitMs: BATTLE_TIME_LIMIT_MS,
    });
  }

  private async advanceQuestion(): Promise<void> {
    // Cancel any pending alarm so a late-firing timer can't double-advance.
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      /* ignore */
    }

    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!runtime || !config) return;

    if (runtime.phase !== "active" && runtime.phase !== "tiebreak") return;

    // Fill any missing-answer slots (null for any user who didn't answer)
    // and increment consecutiveMiss for those users.
    this.fillMissingAnswersAsNoAnswer(runtime, config);

    // Broadcast reveal for this question — includes correctOptionId (allowed
    // only now, AFTER both answers locked in).
    this.broadcastReveal(runtime, config);

    // Idle-forfeit check — filled in fully by Task 1b.
    const forfeitUserId = this.pickForfeitUser(runtime, config);
    if (forfeitUserId) {
      const winner =
        forfeitUserId === config.hostId ? config.guestId : config.hostId;
      await this.persistAnswersToD1(runtime, config);
      runtime.phase = "forfeited";
      await this.ctx.storage.put("runtime", runtime);
      await this.endBattle(winner, "forfeit");
      return;
    }

    await this.ctx.storage.put("runtime", runtime);

    // Regular phase: advance within question list; if exhausted, either end
    // or enter tiebreak on a score tie.
    if (runtime.phase === "active") {
      const nextIdx = runtime.currentQuestionIndex + 1;
      if (nextIdx < config.questions.length) {
        await this.startQuestion(nextIdx);
        return;
      }
      // Regular pool exhausted — decide end vs tiebreak.
      const hostScore = runtime.scores[config.hostId] ?? 0;
      const guestScore = config.guestId
        ? (runtime.scores[config.guestId] ?? 0)
        : 0;

      await this.persistAnswersToD1(runtime, config);

      if (hostScore === guestScore) {
        // D-15: enter sudden-death tiebreak — pull reservedQuestions[0]
        // and keep looping until decisive. Asserted by battle.tiebreaker.test.ts.
        await this.enterTiebreak(runtime, config);
        return;
      }
      const winnerId = hostScore > guestScore ? config.hostId : config.guestId;
      await this.endBattle(winnerId, "decisive");
      return;
    }

    // runtime.phase === "tiebreak"
    await this.resolveTiebreakRound(runtime, config);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private bothAnswered(runtime: BattleRuntime, config: BattleConfig): boolean {
    const idx = runtime.currentQuestionIndex;
    const row = runtime.answered[idx];
    if (!row) return false;
    if (!row[config.hostId]) return false;
    if (!config.guestId) return false;
    if (!row[config.guestId]) return false;
    return true;
  }

  private fillMissingAnswersAsNoAnswer(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): void {
    const idx = runtime.currentQuestionIndex;
    runtime.answered[idx] ??= {};
    const now = Date.now();
    const participants = [config.hostId];
    if (config.guestId) participants.push(config.guestId);

    for (const userId of participants) {
      if (runtime.answered[idx][userId]) continue;
      runtime.answered[idx][userId] = {
        optionId: null,
        correct: false,
        points: 0,
        responseTimeMs: BATTLE_TIME_LIMIT_MS,
        receivedAtMs: now,
      };
      runtime.consecutiveMiss[userId] =
        (runtime.consecutiveMiss[userId] ?? 0) + 1;
    }
  }

  private pickForfeitUser(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): string | null {
    const participants = [config.hostId];
    if (config.guestId) participants.push(config.guestId);
    for (const userId of participants) {
      if ((runtime.consecutiveMiss[userId] ?? 0) >= IDLE_FORFEIT_MISS_COUNT) {
        return userId;
      }
    }
    return null;
  }

  private broadcastReveal(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): void {
    const idx = runtime.currentQuestionIndex;
    const q =
      runtime.phase === "tiebreak"
        ? config.reservedQuestions[runtime.tiebreakerRound - 1]
        : config.questions[idx];
    if (!q) return;

    const hostAns = runtime.answered[idx]?.[config.hostId];
    const guestAns = config.guestId
      ? runtime.answered[idx]?.[config.guestId]
      : undefined;

    // Reveal event: the ONLY path where `correctOptionId` is sent over WS.
    this.broadcast({
      type: "reveal",
      questionIndex: idx,
      correctOptionId: q.correctOptionId,
      yourCorrect: hostAns?.correct ?? false,
      opponentCorrect: guestAns?.correct ?? false,
      yourPoints: hostAns?.points ?? 0,
      opponentPoints: guestAns?.points ?? 0,
    });
  }

  private async enterTiebreak(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): Promise<void> {
    // D-15: sudden-death tiebreaker. Pulls reservedQuestions[round-1] and
    // broadcasts it via startQuestion. resolveTiebreakRound (called from
    // advanceQuestion when runtime.phase === "tiebreak") decides the
    // winner per D-15 rules: first correct wins, ties on correctness
    // break on points, then pull another reserve if still tied.
    if (config.reservedQuestions.length === 0) {
      // No reserves available — guard against lock-up. In production flow
      // Plan 03 ensures reservedQuestions are seeded before startBattle;
      // this branch is a safety valve.
      await this.endBattle(null, "both-dropped");
      return;
    }
    runtime.phase = "tiebreak";
    runtime.tiebreakerRound = Math.max(1, runtime.tiebreakerRound + 1);
    runtime.currentQuestionIndex = (runtime.currentQuestionIndex ?? -1) + 1;
    await this.ctx.storage.put("runtime", runtime);
    await this.startQuestion(runtime.currentQuestionIndex);
  }

  private async resolveTiebreakRound(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): Promise<void> {
    const idx = runtime.currentQuestionIndex;
    const hostAns = runtime.answered[idx]?.[config.hostId];
    const guestAns = config.guestId
      ? runtime.answered[idx]?.[config.guestId]
      : undefined;

    const hostCorrect = !!hostAns?.correct;
    const guestCorrect = !!guestAns?.correct;

    if (hostCorrect && !guestCorrect) {
      await this.persistAnswersToD1(runtime, config);
      await this.endBattle(config.hostId, "decisive");
      return;
    }
    if (guestCorrect && !hostCorrect && config.guestId) {
      await this.persistAnswersToD1(runtime, config);
      await this.endBattle(config.guestId, "decisive");
      return;
    }
    if (hostCorrect && guestCorrect && config.guestId) {
      // Both correct — higher points on THIS round wins.
      const hostPts = hostAns?.points ?? 0;
      const guestPts = guestAns?.points ?? 0;
      if (hostPts !== guestPts) {
        const winner = hostPts > guestPts ? config.hostId : config.guestId;
        await this.persistAnswersToD1(runtime, config);
        await this.endBattle(winner, "decisive");
        return;
      }
      // Perfect tie on both correctness AND points — pull another reserve.
    }

    // Neither correct (or both correct with identical points): pull next reserve.
    const nextReserveIdx = runtime.tiebreakerRound; // 0-based into reserved
    if (nextReserveIdx >= config.reservedQuestions.length) {
      // Exhausted reserves — accept the tie-breaker stalemate (rare).
      await this.persistAnswersToD1(runtime, config);
      await this.endBattle(null, "both-dropped");
      return;
    }
    runtime.tiebreakerRound += 1;
    runtime.currentQuestionIndex = idx + 1;
    await this.ctx.storage.put("runtime", runtime);
    await this.startQuestion(runtime.currentQuestionIndex);
  }

  private async endBattle(
    winnerId: string | null,
    outcome: "decisive" | "forfeit" | "both-dropped",
  ): Promise<void> {
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!runtime || !config) return;

    // Idempotency guard (short-circuit): if we've already broadcast once,
    // don't double-settle. Defense-in-depth is the ledger-row check below
    // which handles re-invocation across DO isolates (alarm + normal flow).
    if (runtime.endBroadcasted) return;

    const hostId = config.hostId;
    const guestId = config.guestId;
    const hostScore = runtime.scores[hostId] ?? 0;
    const guestScore = guestId ? (runtime.scores[guestId] ?? 0) : 0;
    const now = new Date();
    const nowMs = now.getTime();

    // ── Ledger idempotency check (SEC-05 / T-04-FORFEIT-DOUBLE) ──────
    // The battle_ledger PK is battleId, so `INSERT OR IGNORE` protects
    // against duplicate row creation, but the userStats UPDATEs would
    // still double-apply if we ran them twice. Check for an existing
    // ledger row BEFORE touching userStats.
    let alreadySettled = false;
    try {
      const existing = await this.env.DB.prepare(
        "SELECT battle_id FROM battle_ledger WHERE battle_id = ? LIMIT 1",
      )
        .bind(config.battleId)
        .first<{ battle_id: string }>();
      alreadySettled = !!existing;
    } catch {
      // On any DB error, fall through to best-effort settlement. The
      // SQL batch below will still do INSERT OR IGNORE on its own row,
      // so the worst case is broadcast without persistence.
    }

    // ── Resolve wager settlement parameters (D-17, D-19, D-21) ──────
    // Re-read battles row to get hostWagerAmount / guestWagerAmount (stored
    // by Plan 04's /start route). These are the authoritative per-user
    // stake amounts at battle-start; we don't trust runtime memory.
    let hostWagerAmount = 0;
    let guestWagerAmount = 0;
    try {
      const battleRow = await this.env.DB.prepare(
        "SELECT host_wager_amount, guest_wager_amount FROM battles WHERE id = ? LIMIT 1",
      )
        .bind(config.battleId)
        .first<{
          host_wager_amount: number | null;
          guest_wager_amount: number | null;
        }>();
      if (battleRow) {
        hostWagerAmount = battleRow.host_wager_amount ?? 0;
        guestWagerAmount = battleRow.guest_wager_amount ?? 0;
      }
    } catch {
      // No battles row (test scenarios) — default to 0 stakes.
    }

    // D-21: determine loserId and xpTransferred based on outcome.
    //   decisive  → winner receives opponent's stake, loser loses own stake
    //   forfeit   → non-forfeiting player wins opponent's stake
    //   both-dropped → xp_amount = 0, no XP movement (wagers implicitly refunded)
    let loserId: string | null = null;
    let xpTransferred = 0;
    if (outcome !== "both-dropped" && winnerId && guestId) {
      if (winnerId === hostId) {
        loserId = guestId;
        xpTransferred = guestWagerAmount; // winner gets loser's stake
      } else if (winnerId === guestId) {
        loserId = hostId;
        xpTransferred = hostWagerAmount;
      }
    }

    // ── Pre-batch: read winner's current XP for level-up detection ──
    // Needed BEFORE the batch so we can compute old-level accurately.
    let priorWinnerXp = 0;
    if (winnerId && xpTransferred > 0 && !alreadySettled) {
      try {
        const row = await this.env.DB.prepare(
          "SELECT xp FROM user_stats WHERE user_id = ? LIMIT 1",
        )
          .bind(winnerId)
          .first<{ xp: number }>();
        priorWinnerXp = row?.xp ?? 0;
      } catch {
        priorWinnerXp = 0;
      }
    }

    // ── Atomic batch: update battles row + ledger + userStats XP ─────
    // env.DB.batch([...]) is a single SQL transaction with automatic
    // rollback on any statement failure (SEC-05 / T-04-04). Raw
    // D1PreparedStatements because Drizzle 0.45's db.batch() is less
    // well-documented for this repo and the raw prepare path maps
    // directly to the Cloudflare D1 batch semantics.
    if (!alreadySettled) {
      const stmts: D1PreparedStatement[] = [];

      // (1) Update battles row status/winner/finalScores
      stmts.push(
        this.env.DB.prepare(
          "UPDATE battles SET status = ?, winner_id = ?, host_final_score = ?, guest_final_score = ?, completed_at = ? WHERE id = ?",
        ).bind(
          outcome === "forfeit" ? "forfeited" : "completed",
          winnerId ?? null,
          hostScore,
          guestScore,
          Math.floor(nowMs / 1000),
          config.battleId,
        ),
      );

      // (2) INSERT OR IGNORE ledger row — PK on battle_id provides the
      // idempotency key against a raced second call.
      stmts.push(
        this.env.DB.prepare(
          "INSERT OR IGNORE INTO battle_ledger (battle_id, winner_id, loser_id, xp_amount, outcome, settled_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(
          config.battleId,
          winnerId ?? null,
          loserId,
          xpTransferred,
          outcome,
          Math.floor(nowMs / 1000),
        ),
      );

      // (3) XP mutations — only added when there's a real transfer.
      // SQL expression `xp = xp ± ?` is the atomic increment pattern
      // (no read-modify-write race). D-19 allows negative XP — no floor
      // constraint on this column. UPSERT (INSERT ... ON CONFLICT DO UPDATE)
      // is required because user_stats rows are NOT seeded on signup —
      // they're only created on first lesson complete / first quiz answer
      // (worker/src/routes/roadmaps.ts:386, :490). A user who battles before
      // completing any lesson has no row, and a plain UPDATE silently
      // no-ops in SQLite/D1 (gap closed by 04-16-PLAN; see
      // .planning/debug/xp-transfer-not-reflected-in-profile.md).
      if (xpTransferred > 0 && winnerId && loserId) {
        const settledAtSec = Math.floor(nowMs / 1000);
        stmts.push(
          this.env.DB.prepare(
            `INSERT INTO user_stats
               (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, updated_at)
               VALUES (?, ?, 0, 0, 0, 0, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               xp = xp - ?,
               updated_at = ?`,
          ).bind(loserId, -xpTransferred, settledAtSec, xpTransferred, settledAtSec),
        );
        stmts.push(
          this.env.DB.prepare(
            `INSERT INTO user_stats
               (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, updated_at)
               VALUES (?, ?, 0, 0, 0, 0, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               xp = xp + ?,
               updated_at = ?`,
          ).bind(winnerId, xpTransferred, settledAtSec, xpTransferred, settledAtSec),
        );
      }

      try {
        await this.env.DB.batch(stmts);
      } catch {
        // D1 batch executes as a SINGLE SQL transaction with automatic
        // rollback on any statement failure (SEC-05). On failure here
        // (e.g. FK drift, transient D1 error, missing battles row in
        // unit-test scenarios), NONE of the statements committed —
        // XP is NOT in a partial state. We still transition DO runtime
        // to ended/forfeited so clients get their terminal event, and
        // force xpTransferred → 0 so the end event doesn't advertise
        // a transfer that didn't happen. Ctx.storage remains the
        // source of truth for DO-level state.
        xpTransferred = 0;
      }
    }

    // ── Level-up detection (post-batch) ──────────────────────────────
    let leveledUp = false;
    let newLevel: number | undefined;
    if (!alreadySettled && winnerId && xpTransferred > 0) {
      const newXp = priorWinnerXp + xpTransferred;
      const oldLevel = computeLevel(priorWinnerXp).level;
      const newLevelInfo = computeLevel(newXp);
      leveledUp = newLevelInfo.level > oldLevel;
      newLevel = newLevelInfo.level;
    }

    // ── Runtime state transition + broadcast ─────────────────────────
    runtime.endBroadcasted = true;
    runtime.phase = outcome === "forfeit" ? "forfeited" : "ended";
    await this.ctx.storage.put("runtime", runtime);

    // Per-client xpDelta record: winner gets +xpTransferred, loser −xpTransferred.
    const xpDelta: Record<string, number> = {};
    if (xpTransferred > 0 && winnerId && loserId) {
      xpDelta[winnerId] = xpTransferred;
      xpDelta[loserId] = -xpTransferred;
    }

    this.broadcast({
      type: "end",
      winnerId,
      hostScore,
      guestScore,
      outcome,
      xpTransferred,
      hostWagerAmount,
      guestWagerAmount,
      xpDelta,
      leveledUp,
      newLevel,
    });

    // Post-end grace window: Plan 04 clients may fetch the battles row
    // immediately after the end event; 30s later the DO self-destructs.
    await this.ctx.storage.setAlarm(Date.now() + POST_END_GRACE_MS);
  }

  private async persistAnswersToD1(
    runtime: BattleRuntime,
    config: BattleConfig,
  ): Promise<void> {
    // Writes the per-question answer rows for the regular round to
    // `battle_answers`. Called from advanceQuestion after regular pool
    // exhaustion / tiebreak resolution. Tiebreaker questions persist only
    // if they're in the battle_quiz_pool (which they are — reserved pool is
    // sampled from the same topic pool).
    try {
      const db = drizzle(this.env.DB, { schema });
      const rows: Array<{
        id: string;
        battleId: string;
        userId: string;
        questionId: string;
        questionIndex: number;
        selectedOptionId: string | null;
        correct: boolean;
        responseTimeMs: number;
        pointsAwarded: number;
        createdAt: Date;
      }> = [];

      for (const [idxStr, perUser] of Object.entries(runtime.answered)) {
        const idx = Number(idxStr);
        const isTiebreakRound =
          runtime.phase === "tiebreak" && idx >= config.questions.length;
        const q = isTiebreakRound
          ? config.reservedQuestions[idx - config.questions.length]
          : config.questions[idx];
        if (!q) continue;
        for (const [userId, a] of Object.entries(perUser)) {
          rows.push({
            id: `${config.battleId}-q${idx}-${userId}`,
            battleId: config.battleId,
            userId,
            questionId: q.id,
            questionIndex: idx,
            selectedOptionId: a.optionId,
            correct: a.correct,
            responseTimeMs: a.responseTimeMs,
            pointsAwarded: a.points,
            createdAt: new Date(),
          });
        }
      }

      for (const row of rows) {
        try {
          await db
            .insert(schema.battleAnswers)
            .values(row)
            .onConflictDoNothing();
        } catch (err) {
          // WR-07: per-row FK / schema drift is non-fatal for battle
          // progression (ctx.storage is source of truth), BUT silent
          // failure leaves `battle_answers` analytics unreliable and
          // breaks the hard-refresh fallback path on the results route.
          // Log structured context so drift is observable.
          console.error(
            "[BattleRoom persistAnswersToD1] row insert failed",
            JSON.stringify({
              battleId: config.battleId,
              rowId: row.id,
              userId: row.userId,
              questionIndex: row.questionIndex,
              err: String(err),
            }),
          );
        }
      }
    } catch (err) {
      // WR-07: outer failure (e.g. D1 binding unavailable) is also
      // non-fatal to the DO, but MUST be logged so ops can investigate
      // missing analytics or broken results fallbacks.
      console.error(
        "[BattleRoom persistAnswersToD1] batch failed",
        JSON.stringify({ battleId: config.battleId, err: String(err) }),
      );
    }
  }

  private async handleHello(
    ws: WebSocket,
    att: SocketAttachment,
    _msg: BattleClientHelloT,
  ): Promise<void> {
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!runtime || !config) {
      try {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "NO_BATTLE",
            message: "battle not initialised",
          }),
        );
      } catch {
        /* ignore */
      }
      return;
    }

    // ── Reconnect resumption (D-25) ──────────────────────────────────
    // If a disconnect bucket exists for THIS userId, cancel the grace
    // alarm and resume the paused question timer so the disconnect
    // window does not count toward the 15s answer timer.
    const disconnect =
      await this.ctx.storage.get<DisconnectRecord>("disconnect");
    if (
      disconnect &&
      disconnect.userId === att.userId &&
      runtime.phase === "opponent-reconnecting"
    ) {
      const nowMs = Date.now();
      const remaining = Math.max(0, disconnect.pausedQuestionRemainingMs);

      // Cancel the pending 30s grace alarm. If `remaining > 0`, replace
      // with a fresh question alarm; otherwise let advanceQuestion
      // handle the zero-time case on its normal flow.
      try {
        await this.ctx.storage.deleteAlarm();
      } catch {
        /* ignore */
      }

      // Resume: reset questionStartedAtMs so `started + 15s = now +
      // remaining`. This preserves the elapsed-before-disconnect and
      // makes the total question budget unchanged by the pause window.
      runtime.questionStartedAtMs = nowMs - (BATTLE_TIME_LIMIT_MS - remaining);
      runtime.phase = disconnect.preDisconnectPhase;
      await this.ctx.storage.put("runtime", runtime);

      if (remaining > 0) {
        await this.ctx.storage.setAlarm(nowMs + remaining);
      } else {
        // No time left → fire the alarm immediately to advance round.
        await this.ctx.storage.setAlarm(nowMs);
      }

      await this.ctx.storage.delete("disconnect");

      // Announce to the OTHER connected socket that the disconnect has
      // cleared. `broadcast` reaches every live peer including the
      // reconnecting one — the snapshot below is the reconnecting
      // client's authoritative state source; the opponent-reconnected
      // event is strictly UI signal.
      this.broadcast({ type: "opponent-reconnected" });
    }

    // ── Always: send a full snapshot to the reconnecting client ─────
    // Server-derived, never trusts client state. Strips correctOptionId
    // and explanation from any embedded question (T-04-REVEAL-LEAK).
    const hostScore = runtime.scores[config.hostId] ?? 0;
    const guestScore = config.guestId
      ? (runtime.scores[config.guestId] ?? 0)
      : 0;
    const currentIdx = runtime.currentQuestionIndex;
    const q =
      runtime.phase === "tiebreak"
        ? config.reservedQuestions[runtime.tiebreakerRound - 1]
        : currentIdx >= 0
          ? config.questions[currentIdx]
          : undefined;
    const remainingMs =
      runtime.phase === "active" || runtime.phase === "tiebreak"
        ? Math.max(
            0,
            runtime.questionStartedAtMs + BATTLE_TIME_LIMIT_MS - Date.now(),
          )
        : 0;

    try {
      ws.send(
        JSON.stringify({
          type: "snapshot",
          phase:
            runtime.phase === "ended" || runtime.phase === "forfeited"
              ? "completed"
              : runtime.phase === "active" || runtime.phase === "tiebreak"
                ? "active"
                : "pre-battle",
          questionIndex: Math.max(0, currentIdx),
          totalQuestions: config.questions.length,
          hostScore,
          guestScore,
          remainingMs,
          currentQuestion: q
            ? {
                type: "question",
                questionIndex: Math.max(0, currentIdx),
                totalQuestions: config.questions.length,
                questionText: q.questionText,
                questionType: q.questionType,
                options: q.options.map((o) => ({ id: o.id, text: o.text })),
                timeLimitMs: BATTLE_TIME_LIMIT_MS,
              }
            : undefined,
          reconnectedUserId: att.userId,
        }),
      );
    } catch {
      /* ignore */
    }
  }

  private async destroyBattle(): Promise<void> {
    await this.ctx.storage.deleteAll();
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      /* ignore */
    }
  }

  private async expireLobby(): Promise<void> {
    // D-04: 5-min lobby auto-destroy. Marks the battles D1 row as expired
    // (so Plan 04's lobby-poll endpoint returns 410/Gone) then destroys the
    // DO. Asserted by battle.lobby.timeout.test.ts.
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (config) {
      try {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.battles)
          .set({ status: "expired" })
          .where(eq(schema.battles.id, config.battleId));
      } catch (err) {
        // WR-06: a missed write leaves a zombie status='lobby' row that
        // pins the partial UNIQUE(join_code) index. The /join handler
        // has a fallback sweeper for the same condition, but log here
        // so ops visibility exists for manual cleanup when neither path
        // reaches the row.
        console.error(
          "[BattleRoom expireLobby] D1 write failed",
          JSON.stringify({ battleId: config.battleId, err: String(err) }),
        );
      }
    }
    await this.destroyBattle();
  }

  private broadcast(obj: unknown): void {
    const payload = JSON.stringify(obj);
    for (const peer of this.ctx.getWebSockets()) {
      try {
        peer.send(payload);
      } catch {
        // socket may be closing / closed — skip
      }
    }
  }

  // ── Op handlers ────────────────────────────────────────────────────────

  private async opInitLobby(payload: unknown): Promise<Response> {
    const p = payload as {
      battleId?: string;
      hostId?: string;
      questionCount?: 5 | 10 | 15;
      hostName?: string;
    };
    if (!p.battleId || !p.hostId || !p.questionCount) {
      return new Response("missing battleId/hostId/questionCount", { status: 400 });
    }

    const config: BattleConfig = {
      battleId: p.battleId,
      hostId: p.hostId,
      guestId: null,
      questionCount: p.questionCount,
      questions: [],
      reservedQuestions: [],
      hostName: p.hostName,
    };
    const runtime: BattleRuntime = {
      phase: "lobby",
      currentQuestionIndex: -1,
      questionStartedAtMs: 0,
      scores: { [p.hostId]: 0 },
      answered: {},
      consecutiveMiss: { [p.hostId]: 0 },
      tiebreakerRound: 0,
    };
    await this.ctx.storage.put("config", config);
    await this.ctx.storage.put("runtime", runtime);
    await this.ctx.storage.setAlarm(Date.now() + LOBBY_TIMEOUT_MS);

    return new Response(JSON.stringify({ ok: true, phase: runtime.phase }), {
      headers: { "content-type": "application/json" },
    });
  }

  private async opAttachGuest(payload: unknown): Promise<Response> {
    const p = payload as { guestId?: string; guestName?: string };
    if (!p.guestId) return new Response("missing guestId", { status: 400 });

    const config = await this.ctx.storage.get<BattleConfig>("config");
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    if (!config || !runtime) {
      return new Response("no lobby initialised", { status: 409 });
    }
    if (runtime.phase !== "lobby") {
      return new Response("lobby not joinable", { status: 409 });
    }

    config.guestId = p.guestId;
    config.guestName = p.guestName;
    runtime.phase = "pre-battle";
    runtime.scores[p.guestId] = 0;
    runtime.consecutiveMiss[p.guestId] = 0;

    await this.ctx.storage.put("config", config);
    await this.ctx.storage.put("runtime", runtime);

    // Cancel lobby-timeout alarm — guest is in.
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      /* ignore */
    }

    // Gap 04-12: schedule pool-timeout alarm. runtime.phase is now
    // 'pre-battle' (set earlier in this handler). The alarm's pre-battle
    // branch in alarm() reads battles.poolTopicId → battle_pool_topics.status
    // and flips to 'failed' if still 'generating' at the 60s mark. One-shot
    // — alarm() does NOT re-schedule.
    await this.ctx.storage.setAlarm(Date.now() + POOL_TIMEOUT_MS);

    return new Response(JSON.stringify({ ok: true, phase: runtime.phase }), {
      headers: { "content-type": "application/json" },
    });
  }

  private async opSetQuestions(payload: unknown): Promise<Response> {
    const p = payload as {
      questions?: BattleQuizQuestion[];
      reservedQuestions?: BattleQuizQuestion[];
    };
    if (!Array.isArray(p.questions)) {
      return new Response("missing questions[]", { status: 400 });
    }

    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (!config) return new Response("no config", { status: 409 });

    config.questions = p.questions;
    config.reservedQuestions = p.reservedQuestions ?? [];
    await this.ctx.storage.put("config", config);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }

  private async opStartBattle(payload: unknown): Promise<Response> {
    const p = payload as { wagerAmount?: number };
    const config = await this.ctx.storage.get<BattleConfig>("config");
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    if (!config || !runtime) {
      return new Response("no config/runtime", { status: 409 });
    }
    if (config.questions.length === 0) {
      return new Response("no questions loaded", { status: 409 });
    }

    if (typeof p?.wagerAmount === "number") {
      config.wagerAmount = p.wagerAmount;
      await this.ctx.storage.put("config", config);
    }

    // Cancel any pending lobby OR pool-timeout alarm — battle is starting.
    // (Gap 04-12: the pool-timeout alarm scheduled in opAttachGuest is
    // cleared here so it can't fire after the transition to active.)
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      /* ignore */
    }

    runtime.phase = "active";
    runtime.currentQuestionIndex = -1; // startQuestion sets to 0
    await this.ctx.storage.put("runtime", runtime);

    await this.startQuestion(0);

    return new Response(JSON.stringify({ ok: true, phase: "active" }), {
      headers: { "content-type": "application/json" },
    });
  }

  private async opSnapshot(): Promise<Response> {
    const config = await this.ctx.storage.get<BattleConfig>("config");
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    return new Response(
      JSON.stringify({ config: config ?? null, runtime: runtime ?? null }),
      { headers: { "content-type": "application/json" } },
    );
  }
}
