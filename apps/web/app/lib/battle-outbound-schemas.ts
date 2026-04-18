// Frontend-side re-export of the battle WebSocket OUTBOUND schemas.
//
// The source of truth lives in `worker/src/validation/battle-schemas.ts` —
// that module is imported by the BattleRoom Durable Object AND by this
// frontend module. Single shared Zod surface so drift between server and
// client is impossible by construction.
//
// apps/web's `tsconfig.cloudflare.json` includes `"../../worker/src/**"`
// in its `include` list, so the relative import resolves cleanly at both
// typecheck and bundle time.
//
// We re-export ONLY the outbound schemas + types. The inbound schemas
// (BattleAnswerMessage, BattleClientHello) live on the server; the frontend
// sends structurally-typed literals via `useBattleSocket.send()`, so it
// doesn't need a runtime Zod parser for outbound-from-server messages.

export {
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
  BattleOutboundSchema,
  type BattleOutbound,
} from "../../../../worker/src/validation/battle-schemas";

import type { BattleOutbound } from "../../../../worker/src/validation/battle-schemas";

// Discriminated-union narrowing helpers — exposed so consumers (hook +
// store) can type-safely pattern-match on `type` without having to
// redeclare the union.
export type BattleQuestionPayload = Extract<BattleOutbound, { type: "question" }>;
export type BattleScoreUpdatePayload = Extract<BattleOutbound, { type: "score-update" }>;
export type BattleRevealPayload = Extract<BattleOutbound, { type: "reveal" }>;
export type BattleSnapshotPayload = Extract<BattleOutbound, { type: "snapshot" }>;
export type BattleEndPayload = Extract<BattleOutbound, { type: "end" }>;
export type BattleWaitingForQuestionsPayload = Extract<
  BattleOutbound,
  { type: "waiting-for-questions" }
>;
export type BattleOpponentReconnectingPayload = Extract<
  BattleOutbound,
  { type: "opponent-reconnecting" }
>;
export type BattleOpponentReconnectedPayload = Extract<
  BattleOutbound,
  { type: "opponent-reconnected" }
>;
export type BattleMovedPayload = Extract<BattleOutbound, { type: "moved" }>;
export type BattleErrorPayload = Extract<BattleOutbound, { type: "error" }>;

/**
 * Outbound FROM client TO server — the ONLY two shapes the server accepts.
 * Declared here (not re-exported from the server module) because
 * `BattleInboundSchema` is `.strict()` on the server: it rejects any extra
 * fields. Hand-typing the union makes it compile-error obvious if a dev
 * adds `{score: 123}` or `{timestamp: Date.now()}` into a client message.
 */
export type BattleClientOutbound =
  | { action: "answer"; optionId: string }
  | { action: "hello"; lastSeenQuestionIdx?: number };
