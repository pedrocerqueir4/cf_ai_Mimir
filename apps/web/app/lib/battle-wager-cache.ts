// Pure, framework-free helper for applying a wager-submit response to the
// cached BattleLobbyState. Extracted so we can unit-test the cache update
// without touching React or TanStack Query.
//
// Plan 04-11, Task 1: the pre-battle /api/battle/:id/wager handler used to
// seed the cache ONLY when the server reported bothProposed + appliedTier.
// That meant the FIRST submitter saw a stale `hostWagerTier: null` /
// `guestWagerTier: null` lobby state on the very next poll tick, and the
// phase-transition useEffect bounced the UI back to the `wager-propose`
// phase — looked like "submit did nothing". We now merge the server's
// canonical wager fields into the cache UNCONDITIONALLY on any 2xx response.

import type { BattleLobbyState } from "./api-client";

/**
 * Wager tier enum. Mirrors the literal unions in BattleLobbyState /
 * SubmitWagerResponse (api-client.ts keeps them inline rather than
 * re-exporting a named alias).
 */
export type WagerTier = 10 | 15 | 20;

/**
 * Subset of /api/battle/:id/wager response fields we care about for cache
 * propagation. Mirrors the shape of SubmitWagerResponse plus a few server
 * fields we propagate when the server says bothProposed.
 */
export interface WagerSubmitResponsePayload {
	tier: WagerTier;
	bothProposed: boolean;
	appliedTier: WagerTier | null;
	hostWagerAmount: number | null;
	guestWagerAmount: number | null;
}

/**
 * Apply the wager-submit response to the cached lobby state.
 *
 * Contract:
 *  - If `prev` is undefined (loader hasn't populated cache yet), return
 *    undefined so TanStack Query falls back to its own state. We don't
 *    synthesize a lobby out of thin air.
 *  - Otherwise produce a new BattleLobbyState with the submitter's own
 *    wager tier set (derived from `currentUserId` vs `prev.hostId`). The
 *    opponent's tier is preserved from the previous cache state — we don't
 *    invent it, only the server knows.
 *  - When both-proposed, forward the server's canonical appliedWagerTier so
 *    the pre-battle page can advance from `waiting-for-opponent` straight
 *    to `roadmap-reveal` without waiting for the next poll round-trip.
 */
export function applyWagerResponseToCache(
	prev: BattleLobbyState | undefined,
	response: WagerSubmitResponsePayload,
	currentUserId: string | null,
	selectedTier: WagerTier,
): BattleLobbyState | undefined {
	if (!prev) return prev;

	const isHost = currentUserId != null && prev.hostId === currentUserId;
	const isGuest = currentUserId != null && prev.guestId === currentUserId;

	// Prefer the tier the user just submitted (selectedTier === response.tier
	// on the happy path) over whatever was in prev for the submitter's slot.
	// Opponent's tier stays whatever the cache already knew.
	const nextHostTier: WagerTier | null = isHost
		? selectedTier
		: prev.hostWagerTier;
	const nextGuestTier: WagerTier | null = isGuest
		? selectedTier
		: prev.guestWagerTier;

	const next: BattleLobbyState = {
		...prev,
		hostWagerTier: nextHostTier,
		guestWagerTier: nextGuestTier,
	};

	// Only forward the applied-tier coin-flip result when the server reports
	// bothProposed — otherwise `appliedWagerTier` should stay null until the
	// second submitter lands.
	if (response.bothProposed && response.appliedTier != null) {
		next.appliedWagerTier = response.appliedTier;
	}

	return next;
}
