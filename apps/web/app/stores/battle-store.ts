import { create } from "zustand";
import type {
  BattleQuestionPayload,
  BattleRevealPayload,
  BattleSnapshotPayload,
  BattleEndPayload,
} from "~/lib/battle-outbound-schemas";

// ─── Types ───────────────────────────────────────────────────────────────────

/** WS lifecycle state reported by useBattleSocket → displayed on self-card. */
export type ConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "failed"
  | "moved";

/** Opponent-side derived connection state for the opponent score-card dot. */
export type OpponentConnectionState =
  | "connected"
  | "reconnecting"
  | "forfeit-imminent";

/** High-level battle phase drives the room-route's top-level rendering. */
export type BattlePhase =
  | "connecting"
  | "active"
  | "tiebreak"
  | "ended"
  | "reconnecting"
  | "opponent-reconnecting"
  | "moved";

export interface CurrentQuestion {
  questionIndex: number;
  totalQuestions: number;
  questionText: string;
  questionType: "mcq" | "true_false";
  options: Array<{ id: string; text: string }>;
  timeLimitMs: number;
}

export interface PerUserAnswerRecord {
  optionId: string | null;
  correct: boolean;
  points: number;
}

export interface EndResultStored {
  winnerId: string | null;
  hostScore: number;
  guestScore: number;
  outcome: "decisive" | "forfeit" | "both-dropped";
  xpTransferred: number;
  /**
   * The two fields below are NOT on the server `end` event today
   * (Plan 02's endBattle emits xpTransferred:0 as a TODO). Plan 08 wires
   * the real XP settlement + adds a level-up field to the DO broadcast.
   * Storing them in the store now keeps the results-screen contract
   * stable so Plan 08 only has to populate the DO side.
   */
  leveledUp?: boolean;
  newLevel?: number;
  priorLevel?: number;
}

// ─── State shape ─────────────────────────────────────────────────────────────

export interface BattleState {
  // Identity
  battleId: string | null;
  myUserId: string | null;
  myRole: "host" | "guest" | null;
  hostId: string | null;
  guestId: string | null;
  opponentName: string | null;

  // High-level state machine
  phase: BattlePhase;
  connectionState: ConnectionState;
  opponentConnectionState: OpponentConnectionState;
  disconnectGraceRemainingMs: number | null;

  // Current question + timer
  currentQuestion: CurrentQuestion | null;
  currentQuestionIdx: number;
  totalQuestions: number;
  questionStartedAtMs: number | null;
  timeRemainingMs: number;

  // Scores — keyed by userId (hostId | guestId)
  scores: Record<string, number>;

  // Last reveal, indexed by questionIndex, then userId. Used by
  // BattleQuestion to paint correct/wrong borders at reveal time.
  lastAnswerByIdx: Record<number, Record<string, PerUserAnswerRecord>>;
  /** The correct option id for the CURRENT visible question after reveal. */
  revealCorrectOptionId: string | null;

  // Local selection state (client-only; never sent to server as score).
  mySelectedOptionId: string | null;
  myAnswerLocked: boolean;

  // Final battle outcome — populated by `end` event.
  endResult: EndResultStored | null;

  // ─── Actions ───────────────────────────────────────────────────────────
  reset: () => void;
  initBattle: (args: {
    battleId: string;
    myUserId: string;
    myRole: "host" | "guest";
    hostId: string;
    guestId: string;
    opponentName: string;
    totalQuestions: number;
  }) => void;

  // WS connection state setters
  setConnectionState: (s: ConnectionState) => void;
  setOpponentConnectionState: (s: OpponentConnectionState) => void;
  setPhase: (p: BattlePhase) => void;
  setDisconnectGraceRemainingMs: (ms: number | null) => void;

  // WS event handlers (dispatched from useBattleSocket onmessage).
  applyQuestion: (evt: BattleQuestionPayload) => void;
  applyScoreUpdate: (evt: { hostScore: number; guestScore: number }) => void;
  applyReveal: (evt: BattleRevealPayload) => void;
  applySnapshot: (evt: BattleSnapshotPayload) => void;
  applyEnd: (evt: BattleEndPayload) => void;
  applyOpponentReconnecting: (graceMs: number) => void;
  applyOpponentReconnected: () => void;
  applyMoved: () => void;

  // UI-driven setters
  setMySelectedOption: (optionId: string) => void;
  tickTimer: () => void;
}

// ─── Initial state ───────────────────────────────────────────────────────────

const initialState = {
  battleId: null,
  myUserId: null,
  myRole: null,
  hostId: null,
  guestId: null,
  opponentName: null,

  phase: "connecting" as BattlePhase,
  connectionState: "connecting" as ConnectionState,
  opponentConnectionState: "connected" as OpponentConnectionState,
  disconnectGraceRemainingMs: null as number | null,

  currentQuestion: null,
  currentQuestionIdx: 0,
  totalQuestions: 0,
  questionStartedAtMs: null,
  timeRemainingMs: 0,

  scores: {},
  lastAnswerByIdx: {},
  revealCorrectOptionId: null,

  mySelectedOptionId: null,
  myAnswerLocked: false,

  endResult: null,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The DO broadcasts `yourCorrect/yourPoints` FROM THE HOST'S PERSPECTIVE
 * (the DO writes `yourCorrect: hostAns?.correct` in broadcastReveal). The
 * same payload goes to both sockets, so guest clients must flip the
 * perspective to read their own result correctly.
 *
 * Returns per-user records keyed by userId so consumers just index by
 * `myUserId` / `opponentId` (== hostId or guestId).
 */
function perUserFromReveal(
  evt: BattleRevealPayload,
  hostId: string | null,
  guestId: string | null,
): Record<string, PerUserAnswerRecord> {
  const out: Record<string, PerUserAnswerRecord> = {};
  if (hostId) {
    out[hostId] = {
      optionId: null, // server doesn't echo per-user optionId in reveal — only correctness + points
      correct: evt.yourCorrect,
      points: evt.yourPoints,
    };
  }
  if (guestId) {
    out[guestId] = {
      optionId: null,
      correct: evt.opponentCorrect,
      points: evt.opponentPoints,
    };
  }
  return out;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useBattleStore = create<BattleState>((set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  initBattle: (args) =>
    set({
      ...initialState,
      battleId: args.battleId,
      myUserId: args.myUserId,
      myRole: args.myRole,
      hostId: args.hostId,
      guestId: args.guestId,
      opponentName: args.opponentName,
      totalQuestions: args.totalQuestions,
    }),

  setConnectionState: (connectionState) => {
    set({ connectionState });
    // Mirror to top-level phase when relevant.
    if (connectionState === "reconnecting") {
      set({ phase: "reconnecting" });
    } else if (connectionState === "open") {
      // Only clear self-reconnecting phase if we were in it; don't
      // stomp on opponent-reconnecting.
      if (get().phase === "reconnecting") set({ phase: "active" });
    } else if (connectionState === "moved") {
      set({ phase: "moved" });
    }
  },

  setOpponentConnectionState: (opponentConnectionState) =>
    set({ opponentConnectionState }),

  setPhase: (phase) => set({ phase }),

  setDisconnectGraceRemainingMs: (disconnectGraceRemainingMs) =>
    set({ disconnectGraceRemainingMs }),

  applyQuestion: (evt) =>
    set({
      currentQuestion: {
        questionIndex: evt.questionIndex,
        totalQuestions: evt.totalQuestions,
        questionText: evt.questionText,
        questionType: evt.questionType,
        options: evt.options,
        timeLimitMs: evt.timeLimitMs,
      },
      currentQuestionIdx: evt.questionIndex,
      totalQuestions: evt.totalQuestions,
      questionStartedAtMs: Date.now(),
      timeRemainingMs: evt.timeLimitMs,
      // Reset per-question local state.
      mySelectedOptionId: null,
      myAnswerLocked: false,
      revealCorrectOptionId: null,
      phase: "active",
    }),

  applyScoreUpdate: (evt) => {
    const { hostId, guestId } = get();
    if (!hostId) return;
    const next: Record<string, number> = { ...get().scores };
    next[hostId] = evt.hostScore;
    if (guestId) next[guestId] = evt.guestScore;
    set({ scores: next });
  },

  applyReveal: (evt) => {
    const { hostId, guestId, lastAnswerByIdx } = get();
    const perUser = perUserFromReveal(evt, hostId, guestId);
    set({
      revealCorrectOptionId: evt.correctOptionId,
      lastAnswerByIdx: {
        ...lastAnswerByIdx,
        [evt.questionIndex]: perUser,
      },
      // The server emits score-update BEFORE reveal for the answering user;
      // but the authoritative totals arrive in score-update. We don't add
      // here — just mark the answer lock cleared when the next `question`
      // arrives.
    });
  },

  applySnapshot: (evt) => {
    const { hostId, guestId } = get();
    const next: Record<string, number> = { ...get().scores };
    if (hostId) next[hostId] = evt.hostScore;
    if (guestId) next[guestId] = evt.guestScore;

    set({
      scores: next,
      currentQuestionIdx: evt.questionIndex,
      totalQuestions: evt.totalQuestions,
      timeRemainingMs: evt.remainingMs,
      // WR-08: when the snapshot omits currentQuestion we can't derive a
      // valid questionStartedAtMs — leave it null and let the next
      // `question` event re-seed. Previously fell back to a hard-coded
      // 15_000 that would silently drift if server-side limits ever change.
      questionStartedAtMs: evt.currentQuestion
        ? Date.now() - (evt.currentQuestion.timeLimitMs - evt.remainingMs)
        : null,
      phase:
        evt.phase === "completed"
          ? "ended"
          : evt.phase === "active"
            ? "active"
            : "connecting",
      currentQuestion: evt.currentQuestion
        ? {
            questionIndex: evt.currentQuestion.questionIndex,
            totalQuestions: evt.currentQuestion.totalQuestions,
            questionText: evt.currentQuestion.questionText,
            questionType: evt.currentQuestion.questionType,
            options: evt.currentQuestion.options,
            timeLimitMs: evt.currentQuestion.timeLimitMs,
          }
        : get().currentQuestion,
    });
  },

  applyEnd: (evt) => {
    const { hostId, guestId } = get();
    const next: Record<string, number> = { ...get().scores };
    if (hostId) next[hostId] = evt.hostScore;
    if (guestId) next[guestId] = evt.guestScore;
    set({
      scores: next,
      endResult: {
        winnerId: evt.winnerId,
        hostScore: evt.hostScore,
        guestScore: evt.guestScore,
        outcome: evt.outcome,
        xpTransferred: evt.xpTransferred,
        leveledUp: evt.leveledUp,
        newLevel: evt.newLevel,
      },
      phase: "ended",
    });
  },

  applyOpponentReconnecting: (graceMs) =>
    set({
      phase: "opponent-reconnecting",
      opponentConnectionState: "reconnecting",
      disconnectGraceRemainingMs: graceMs,
    }),

  applyOpponentReconnected: () =>
    set({
      phase: "active",
      opponentConnectionState: "connected",
      disconnectGraceRemainingMs: null,
    }),

  applyMoved: () =>
    set({
      phase: "moved",
      connectionState: "moved",
    }),

  setMySelectedOption: (optionId) =>
    set({
      mySelectedOptionId: optionId,
      myAnswerLocked: true,
    }),

  tickTimer: () => {
    const { questionStartedAtMs, currentQuestion, phase, revealCorrectOptionId } = get();
    if (!questionStartedAtMs || !currentQuestion) return;
    if (phase !== "active" && phase !== "tiebreak") return;
    // WR-05: once the server emits `reveal`, it has already moved on to
    // the next question. Freeze the displayed countdown so the old
    // questionStartedAtMs doesn't drift to 0 during the sub-ms gap
    // before the next `question` event re-seeds the timer.
    if (revealCorrectOptionId != null) return;
    const elapsed = Date.now() - questionStartedAtMs;
    const remaining = Math.max(0, currentQuestion.timeLimitMs - elapsed);
    set({ timeRemainingMs: remaining });
  },
}));
