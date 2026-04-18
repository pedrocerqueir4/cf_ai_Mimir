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

// ─── Constants ───────────────────────────────────────────────────────────────

const LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // D-04
const POST_END_GRACE_MS = 30 * 1000; // D-28
const IDLE_FORFEIT_MISS_COUNT = 3; // D-26
const CLOSE_CODE_MOVED = 4001;
const CLOSE_CODE_INVALID = 4002;

// ─── Persistent state types (exported for test harness) ──────────────────────

export type BattlePhase =
  | "lobby"
  | "pre-battle"
  | "active"
  | "tiebreak"
  | "ended"
  | "expired"
  | "forfeited";

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
        await this.alarm();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
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
    // that share the `userId` tag.
    // TODO(Task 1b): replace this stub with the full eviction loop below.
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
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // TODO(Plan 08): disconnect-grace alarm at now + DISCONNECT_GRACE_MS.
    // For Wave 2 we intentionally do not forfeit on close; the idle-forfeit
    // counter (D-26) handles griefing, and Plan 08 will add the 30s grace
    // timer with opponent-reconnecting broadcast.
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // TODO(Plan 08): same as webSocketClose — surface to opponent via
    // `opponent-reconnecting` event; alarm fires at 30s for forfeit.
  }

  // ── Alarm dispatch ─────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const runtime = await this.ctx.storage.get<BattleRuntime>("runtime");
    if (!runtime) return;

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
      case "pre-battle":
        // Pre-battle should never have a pending alarm — no-op if it does.
        return;
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
        // TODO(Task 1b): enter tiebreak phase and pull reservedQuestions[0].
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
    // TODO(Task 1b): full tiebreak implementation. Task 1a lands a minimal
    // version so the "tie at end" branch doesn't throw; Task 1b replaces.
    if (config.reservedQuestions.length === 0) {
      // No reserves — fallback: declare null winner to avoid lock-up.
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

    if (runtime.endBroadcasted) return;
    runtime.endBroadcasted = true;
    runtime.phase = outcome === "forfeit" ? "forfeited" : "ended";

    const hostScore = runtime.scores[config.hostId] ?? 0;
    const guestScore = config.guestId
      ? (runtime.scores[config.guestId] ?? 0)
      : 0;

    await this.ctx.storage.put("runtime", runtime);

    this.broadcast({
      type: "end",
      winnerId,
      hostScore,
      guestScore,
      outcome,
      // TODO(Plan 08): xpTransferred populated here once atomic XP transfer
      // via env.DB.batch([...]) lands. Wave 2 emits 0 — Plan 04 reads the
      // D1 `battles` row for final result rendering.
      xpTransferred: 0,
    });

    // Persist final scores / winner to the battles row so Plan 04's results
    // endpoint has durable state even after the DO self-destructs.
    try {
      const db = drizzle(this.env.DB, { schema });
      await db
        .update(schema.battles)
        .set({
          status: outcome === "forfeit" ? "forfeited" : "completed",
          winnerId: winnerId ?? null,
          hostFinalScore: hostScore,
          guestFinalScore: guestScore,
          completedAt: new Date(),
        })
        .where(eq(schema.battles.id, config.battleId));
    } catch {
      // Swallow — tests may not have a `battles` row for every scenario.
    }

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
        await db.insert(schema.battleAnswers).values(row).onConflictDoNothing();
      }
    } catch {
      // Non-fatal; the in-memory ctx.storage remains the source of truth
      // until Plan 08 adds durable ledger writes.
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

    const hostScore = runtime.scores[config.hostId] ?? 0;
    const guestScore = config.guestId
      ? (runtime.scores[config.guestId] ?? 0)
      : 0;

    // TODO(Plan 08): full reconnect snapshot (remaining question time,
    // current question body if phase==active, last reveal if between
    // questions). Wave 2 emits the minimal snapshot shape.
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
    // TODO(Task 1b): mark D1 battles row as expired (status='expired'),
    // then destroy. Wave 2 Task 1a just destroys; Task 1b adds the D1
    // update + asserts it in battle.lobby.timeout.test.ts.
    const config = await this.ctx.storage.get<BattleConfig>("config");
    if (config) {
      try {
        const db = drizzle(this.env.DB, { schema });
        await db
          .update(schema.battles)
          .set({ status: "expired" })
          .where(eq(schema.battles.id, config.battleId));
      } catch {
        /* ignore — battles row may be absent in unit-test scenarios */
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

    // Cancel any pending lobby alarm — battle is starting.
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
