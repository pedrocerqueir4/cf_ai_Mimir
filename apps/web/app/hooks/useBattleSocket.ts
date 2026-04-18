import { useCallback, useEffect, useRef, useState } from "react";
import { buildBattleSocketUrl } from "~/lib/api-client";
import {
  BattleOutboundSchema,
  type BattleClientOutbound,
} from "~/lib/battle-outbound-schemas";
import { useBattleStore } from "~/stores/battle-store";

/**
 * Lifecycle-reported WS status. Maps to the Zustand store's connectionState
 * via a thin projection in the main effect.
 */
export type WsStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "failed"
  | "moved";

export interface UseBattleSocketApi {
  status: WsStatus;
  send: (msg: BattleClientOutbound) => void;
  /** Reset retry count and re-open. Used by UI "try again" affordances. */
  reconnect: () => void;
}

/**
 * Reconnect backoff schedule — fires 1s, 2s, 4s, 8s after successive close
 * events. After 4 retries exhausted within 30s, the DO's disconnect-grace
 * alarm will have already elapsed → status flips to "failed" and the route
 * page navigates to a forfeit results screen.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const MAX_RETRIES = RECONNECT_DELAYS_MS.length;

/** CloseEvent.code for "battle moved to another device" (multi-tab eviction). */
const CLOSE_CODE_MOVED = 4001;
/** CloseEvent.code for "missing attachment" — DO server-side error. */
const CLOSE_CODE_INVALID = 4002;

/**
 * React hook that owns the WebSocket lifecycle for a battle room.
 *
 * - Opens WS to `/api/battle/:id/ws` (same-origin cookies travel automatically).
 * - Parses inbound messages via BattleOutboundSchema (Zod) before dispatching.
 * - Dispatches discriminated-union events to useBattleStore setters.
 * - Handles exponential-backoff reconnect on network-level closes.
 * - Recognises terminal 4001 (moved-to-another-device) and stops retrying.
 * - Sends client messages shape-restricted to `{action, optionId}` or hello.
 *
 * Contract reminder (T-04-02, SEC-06): the client NEVER sends score, timestamp,
 * responseTime, correct, points, or clientTimestamp — those are server-computed.
 * The `BattleClientOutbound` type in battle-outbound-schemas.ts is the single
 * shape this hook accepts, enforced at compile time by the `send` signature.
 */
export function useBattleSocket(battleId: string | null): UseBattleSocketApi {
  const [status, setStatus] = useState<WsStatus>("idle");

  // Refs so the WS + timers survive across re-renders without re-opening.
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const manualCloseRef = useRef<boolean>(false);

  // Access the store imperatively — reading it reactively here would
  // cause the effect to re-fire on every store change.
  const storeApi = useBattleStore;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback((code: number, reason: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      // Remove handlers first so the close handler doesn't trigger
      // our reconnect logic on an intentional close.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(code, reason);
      }
    } catch {
      /* swallow — socket may already be closing */
    }
    wsRef.current = null;
  }, []);

  /**
   * Parse an inbound raw payload and dispatch to the store. Invalid payloads
   * (Zod parse failure) are logged + ignored — the store is not mutated.
   */
  const handleMessage = useCallback(
    (raw: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useBattleSocket] invalid JSON", err);
        return;
      }
      const result = BattleOutboundSchema.safeParse(parsed);
      if (!result.success) {
        // eslint-disable-next-line no-console
        console.warn(
          "[useBattleSocket] schema rejection",
          result.error.issues,
        );
        return;
      }
      const evt = result.data;
      const store = storeApi.getState();

      switch (evt.type) {
        case "question":
          store.applyQuestion(evt);
          return;
        case "score-update":
          store.applyScoreUpdate({
            hostScore: evt.hostScore,
            guestScore: evt.guestScore,
          });
          return;
        case "reveal":
          store.applyReveal(evt);
          return;
        case "snapshot":
          store.applySnapshot(evt);
          return;
        case "end":
          store.applyEnd(evt);
          return;
        case "waiting-for-questions":
          // Rare: pool still generating. No store mutation — UI keeps
          // "connecting" phase until the first `question` arrives.
          return;
        case "opponent-reconnecting":
          store.applyOpponentReconnecting(evt.graceMs);
          return;
        case "opponent-reconnected":
          store.applyOpponentReconnected();
          return;
        case "moved":
          // Terminal for this client — stop retrying and mark the store.
          store.applyMoved();
          return;
        case "error":
          // eslint-disable-next-line no-console
          console.error("[useBattleSocket] server error", evt.code, evt.message);
          return;
      }
    },
    [storeApi],
  );

  const connect = useCallback(() => {
    if (!battleId) return;

    // Close anything lingering before opening a new socket.
    closeSocket(1000, "reconnecting");
    clearRetryTimer();

    manualCloseRef.current = false;
    setStatus("connecting");
    storeApi.getState().setConnectionState("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildBattleSocketUrl(battleId));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[useBattleSocket] constructor threw", err);
      setStatus("failed");
      storeApi.getState().setConnectionState("failed");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("open");
      storeApi.getState().setConnectionState("open");
      retryCountRef.current = 0;

      // Send hello with last-seen question index so the DO can replay
      // a snapshot if we missed events while disconnected.
      const lastSeen = storeApi.getState().currentQuestionIdx;
      try {
        ws.send(
          JSON.stringify({
            action: "hello",
            lastSeenQuestionIdx: lastSeen,
          } satisfies BattleClientOutbound),
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useBattleSocket] hello send failed", err);
      }
    };

    ws.onmessage = (ev: MessageEvent) => {
      const raw =
        typeof ev.data === "string"
          ? ev.data
          : ev.data instanceof ArrayBuffer
            ? new TextDecoder().decode(ev.data)
            : String(ev.data);
      handleMessage(raw);
    };

    ws.onerror = () => {
      // onerror doesn't give us a close code; onclose fires right after.
      // eslint-disable-next-line no-console
      console.warn("[useBattleSocket] onerror fired — awaiting close");
    };

    ws.onclose = (ev: CloseEvent) => {
      wsRef.current = null;

      // If we initiated the close (unmount, reconnect rebuild), don't retry.
      if (manualCloseRef.current) {
        setStatus("closed");
        storeApi.getState().setConnectionState("closed");
        return;
      }

      // Terminal: multi-tab eviction. Do NOT retry — another tab now owns
      // this (battleId, userId) pair; retrying would just get us kicked again.
      if (ev.code === CLOSE_CODE_MOVED) {
        setStatus("moved");
        storeApi.getState().applyMoved();
        return;
      }

      // Invalid attachment (DO-side error) — not recoverable via reconnect.
      if (ev.code === CLOSE_CODE_INVALID) {
        setStatus("failed");
        storeApi.getState().setConnectionState("failed");
        return;
      }

      // Clean close — no retry.
      if (ev.code === 1000) {
        setStatus("closed");
        storeApi.getState().setConnectionState("closed");
        return;
      }

      // Anything else — try to reconnect with backoff.
      if (retryCountRef.current >= MAX_RETRIES) {
        setStatus("failed");
        storeApi.getState().setConnectionState("failed");
        return;
      }

      const delay = RECONNECT_DELAYS_MS[retryCountRef.current];
      retryCountRef.current += 1;
      setStatus("reconnecting");
      storeApi.getState().setConnectionState("reconnecting");

      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        connect();
      }, delay);
    };
  }, [battleId, clearRetryTimer, closeSocket, handleMessage, storeApi]);

  // Main lifecycle effect — opens on battleId change, cleans up on unmount.
  useEffect(() => {
    if (!battleId) {
      setStatus("idle");
      return;
    }
    connect();
    return () => {
      manualCloseRef.current = true;
      clearRetryTimer();
      closeSocket(1000, "navigation");
      setStatus("closed");
    };
    // `connect` depends on battleId + store/handler refs only — disabling
    // the exhaustive-deps check on this effect would hide a legitimate
    // re-open when battleId changes mid-session.
  }, [battleId, clearRetryTimer, closeSocket, connect]);

  const send = useCallback((msg: BattleClientOutbound) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // eslint-disable-next-line no-console
      console.warn("[useBattleSocket] send skipped — socket not open");
      return;
    }
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[useBattleSocket] send failed", err);
    }
  }, []);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    clearRetryTimer();
    connect();
  }, [clearRetryTimer, connect]);

  return { status, send, reconnect };
}
