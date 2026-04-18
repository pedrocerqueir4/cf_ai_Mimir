import { z } from "zod";

// Phase 4 WebSocket envelope contracts.
// Inbound schemas use `.strict()` — SEC-06 enforcement: any message carrying
// client-supplied `score`, `timestamp`, `correct`, `responseTime`, `points`,
// etc. fails Zod parse. The DO (Plan 02) runs BattleInboundSchema.parse() as
// the FIRST validation step inside webSocketMessage, before any game logic.

// ─── Inbound (client → server) ───────────────────────────────────────────────

export const BattleAnswerMessage = z
  .object({
    action: z.literal("answer"),
    optionId: z.string().min(1).max(50),
  })
  .strict();

export const BattleClientHello = z
  .object({
    action: z.literal("hello"),
    lastSeenQuestionIdx: z.number().int().nonnegative().optional(),
  })
  .strict();

export const BattleInboundSchema = z.discriminatedUnion("action", [
  BattleAnswerMessage,
  BattleClientHello,
]);

export type BattleAnswerMessageT = z.infer<typeof BattleAnswerMessage>;
export type BattleClientHelloT = z.infer<typeof BattleClientHello>;
export type BattleInbound = z.infer<typeof BattleInboundSchema>;

// ─── Outbound (server → client) ──────────────────────────────────────────────
// No `.strict()` on outbound — server-generated, trusted. Frontend uses
// BattleOutboundSchema for runtime parse/safety at the WS boundary.

const BattleQuestionOption = z.object({
  id: z.string(),
  text: z.string(),
});

export const BattleQuestionEvent = z.object({
  type: z.literal("question"),
  questionIndex: z.number().int().nonnegative(),
  totalQuestions: z.number().int().positive(),
  questionText: z.string(),
  questionType: z.enum(["mcq", "true_false"]),
  options: z.array(BattleQuestionOption),
  timeLimitMs: z.number().int().positive(),
  // NB: correctOptionId INTENTIONALLY absent — stripped at server layer (Phase 2 pattern).
});

export const BattleScoreUpdate = z.object({
  type: z.literal("score-update"),
  hostScore: z.number().int().nonnegative(),
  guestScore: z.number().int().nonnegative(),
});

export const BattleRevealEvent = z.object({
  type: z.literal("reveal"),
  questionIndex: z.number().int().nonnegative(),
  correctOptionId: z.string(),
  yourCorrect: z.boolean(),
  opponentCorrect: z.boolean(),
  yourPoints: z.number().int().nonnegative(),
  opponentPoints: z.number().int().nonnegative(),
});

export const BattleSnapshotEvent = z.object({
  type: z.literal("snapshot"),
  phase: z.enum(["pre-battle", "active", "completed"]),
  questionIndex: z.number().int().nonnegative(),
  totalQuestions: z.number().int().positive(),
  hostScore: z.number().int().nonnegative(),
  guestScore: z.number().int().nonnegative(),
  remainingMs: z.number().int().nonnegative(),
  currentQuestion: BattleQuestionEvent.optional(),
});

export const BattleEndEvent = z.object({
  type: z.literal("end"),
  winnerId: z.string().nullable(),
  hostScore: z.number().int().nonnegative(),
  guestScore: z.number().int().nonnegative(),
  outcome: z.enum(["decisive", "forfeit", "both-dropped"]),
  xpTransferred: z.number().int().nonnegative(),
  // Plan 08 settlement fields — DO emits these on every `end`. Optional
  // on the schema so legacy captures / test fixtures that omit them still
  // parse, but production broadcasts always include them.
  hostWagerAmount: z.number().int().nonnegative().optional(),
  guestWagerAmount: z.number().int().nonnegative().optional(),
  xpDelta: z.record(z.string(), z.number().int()).optional(),
  leveledUp: z.boolean().optional(),
  newLevel: z.number().int().positive().optional(),
});

export const BattleWaitingForQuestionsEvent = z.object({
  type: z.literal("waiting-for-questions"),
  poolTopicId: z.string(),
});

export const BattleOpponentReconnectingEvent = z.object({
  type: z.literal("opponent-reconnecting"),
  graceMs: z.number().int().nonnegative(),
});

export const BattleOpponentReconnectedEvent = z.object({
  type: z.literal("opponent-reconnected"),
});

export const BattleMovedEvent = z.object({
  type: z.literal("moved"),
  reason: z.literal("battle-moved-to-another-device"),
});

export const BattleErrorEvent = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
});

export const BattleOutboundSchema = z.discriminatedUnion("type", [
  BattleQuestionEvent,
  BattleScoreUpdate,
  BattleRevealEvent,
  BattleSnapshotEvent,
  BattleEndEvent,
  BattleWaitingForQuestionsEvent,
  BattleOpponentReconnectingEvent,
  BattleOpponentReconnectedEvent,
  BattleMovedEvent,
  BattleErrorEvent,
]);

export type BattleOutbound = z.infer<typeof BattleOutboundSchema>;
