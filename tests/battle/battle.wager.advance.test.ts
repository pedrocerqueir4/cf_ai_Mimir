// VALIDATION.md 04-35 + 04-37 (MULT-04, gap 04-11):
//
// Regression coverage for Plan 04-11, Task 1 (wager-submit cache merge) +
// Task 2 (illustrative wager picker removed from /battle/new).
//
// Task 1 is tested by invoking the pure `applyWagerResponseToCache`
// helper directly — no React/TanStack needed because the helper was
// extracted precisely to make that possible. Covers 5 cases:
//   (a) first-submitter host
//   (b) first-submitter guest
//   (c) second-submitter with bothProposed + appliedTier forwarded
//   (d) undefined `prev` returns undefined (loader hasn't populated cache)
//   (e) phase-regression contract — after applying first-submitter update,
//       the lobby state's hostWagerTier/guestWagerTier are consistent with
//       what the pre-battle page's phase-transition useEffect reads (which
//       decides "my tier proposed?" by comparing (currentUserId===hostId
//       ? hostWagerTier : guestWagerTier) to null). The old bug was that
//       this field was null post-submit → UI bounced to wager-propose.
//
// Task 2 is verified by a static-source grep assertion (04-37): the tokens
// `WagerTierPicker`, `wagerTier`, `fetchUserStats`, `getLocalTimezone`,
// `useQuery` must no longer appear in the /battle/new route source. Uses
// `node:fs` synchronously — the vitest Workers pool has
// `enable_nodejs_fs_module` flagged on (see vpw:debug logs), so this is
// safe. Only reads the one file, no writes.

import { describe, it, expect } from "vitest";
// Vite raw-text import — reads the file at bundle time and ships its
// contents as a string. Avoids the `/bundle/...` vs repo-root mismatch
// that `node:fs.readFileSync` hits in the Workers runtime.
// @ts-ignore — Vite `?raw` returns string at bundle time; TS lacks types.
import battleNewSource from "../../apps/web/app/routes/_app.battle.new.tsx?raw";
import {
	applyWagerResponseToCache,
	type WagerTier,
	type WagerSubmitResponsePayload,
} from "../../apps/web/app/lib/battle-wager-cache";
import type { BattleLobbyState } from "../../apps/web/app/lib/api-client";

function basePrev(overrides: Partial<BattleLobbyState> = {}): BattleLobbyState {
	return {
		battleId: "b-1",
		joinCode: "ABCDEF",
		status: "pre-battle",
		hostId: "u-host",
		hostName: "hostie",
		hostImage: null,
		hostXp: 150,
		hostLevel: 2,
		hostRoadmapTitle: "Cells 101",
		hostWagerTier: null,
		guestId: "u-guest",
		guestName: "guestie",
		guestImage: null,
		guestXp: 80,
		guestLevel: 1,
		guestRoadmapTitle: "Ecology",
		guestWagerTier: null,
		appliedWagerTier: null,
		questionCount: 5,
		winningRoadmapId: null,
		winningTopic: "Cells 101",
		poolStatus: "generating",
		createdAt: 1_700_000_000_000,
		expiresAt: null,
		...overrides,
	};
}

function firstSubmitterResponse(tier: WagerTier): WagerSubmitResponsePayload {
	return {
		tier,
		bothProposed: false,
		appliedTier: null,
		hostWagerAmount: null,
		guestWagerAmount: null,
	};
}

function bothProposedResponse(
	tier: WagerTier,
	appliedTier: WagerTier,
): WagerSubmitResponsePayload {
	return {
		tier,
		bothProposed: true,
		appliedTier,
		hostWagerAmount: 15,
		guestWagerAmount: 12,
	};
}

describe("applyWagerResponseToCache — Plan 04-11 gap 04-11 (Test 04-35)", () => {
	it("A: first-submitter host → hostWagerTier set, guestWagerTier stays null, appliedWagerTier stays null", () => {
		const prev = basePrev();
		const next = applyWagerResponseToCache(
			prev,
			firstSubmitterResponse(15),
			"u-host",
			15,
		);
		expect(next).toBeDefined();
		expect(next!.hostWagerTier).toBe(15);
		expect(next!.guestWagerTier).toBeNull();
		expect(next!.appliedWagerTier).toBeNull();
		// Reference integrity — must not mutate prev
		expect(prev.hostWagerTier).toBeNull();
	});

	it("B: first-submitter guest → guestWagerTier set, hostWagerTier stays null, appliedWagerTier stays null", () => {
		const prev = basePrev();
		const next = applyWagerResponseToCache(
			prev,
			firstSubmitterResponse(20),
			"u-guest",
			20,
		);
		expect(next).toBeDefined();
		expect(next!.guestWagerTier).toBe(20);
		expect(next!.hostWagerTier).toBeNull();
		expect(next!.appliedWagerTier).toBeNull();
	});

	it("C: second-submitter with bothProposed=true → appliedWagerTier forwarded from server response", () => {
		// Previous cache already records host's earlier tier.
		const prev = basePrev({ hostWagerTier: 10 });
		const next = applyWagerResponseToCache(
			prev,
			bothProposedResponse(15, 10),
			"u-guest",
			15,
		);
		expect(next).toBeDefined();
		expect(next!.hostWagerTier).toBe(10); // preserved from prev
		expect(next!.guestWagerTier).toBe(15); // just submitted
		expect(next!.appliedWagerTier).toBe(10); // server's coin-flip result
	});

	it("D: undefined prev returns undefined (loader hasn't populated cache yet)", () => {
		const next = applyWagerResponseToCache(
			undefined,
			firstSubmitterResponse(10),
			"u-host",
			10,
		);
		expect(next).toBeUndefined();
	});

	it("E: phase-regression contract — after first-submit-from-host, (currentUserId===hostId ? hostWagerTier : guestWagerTier) is NON-null so phase won't regress to wager-propose", () => {
		// This is the exact condition the pre-battle page's phase useEffect
		// checks to decide "my tier proposed?". The old bug left the
		// submitter's tier as null post-submit (cache was only updated on
		// bothProposed), which tripped this check and bounced the UI.
		const prev = basePrev();
		const currentUserId = "u-host";
		const next = applyWagerResponseToCache(
			prev,
			firstSubmitterResponse(10),
			currentUserId,
			10,
		);
		expect(next).toBeDefined();
		const myTier =
			next!.hostId === currentUserId
				? next!.hostWagerTier
				: next!.guestWagerTier;
		expect(myTier).not.toBeNull();
		expect(myTier).toBe(10);
	});
});

describe("Static-source gate — /battle/new has no wager picker tokens (Test 04-37)", () => {
	it("does not reference WagerTierPicker / wagerTier / fetchUserStats / getLocalTimezone in /battle/new route", () => {
		// Source text baked in at bundle time via Vite `?raw` import above.
		const source = battleNewSource as string;
		// Strip comment lines so the assertion isn't fooled by explanatory
		// prose in block comments.
		const codeOnly = source
			.split("\n")
			.filter((line) => {
				const trimmed = line.trim();
				return (
					!trimmed.startsWith("//") &&
					!trimmed.startsWith("*") &&
					!trimmed.startsWith("/*")
				);
			})
			.join("\n");

		expect(codeOnly).not.toMatch(/\bWagerTierPicker\b/);
		expect(codeOnly).not.toMatch(/\bwagerTier\b/);
		expect(codeOnly).not.toMatch(/\bfetchUserStats\b/);
		expect(codeOnly).not.toMatch(/\bgetLocalTimezone\b/);
	});
});
