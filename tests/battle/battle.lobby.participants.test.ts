// VALIDATION.md 04-36 (MULT-01, gap 04-11):
//
// GET /api/battle/:id must surface per-participant name/image/level/XP so
// the lobby ParticipantCard can render rich identity tiles. Plan 04-11,
// Task 3 extended the handler's SELECT to pull users.image and LEFT JOIN
// user_stats.xp; level is derived server-side via computeLevel(xp).level.
//
// Three integration cases:
//   (A) Host-only (guest not yet joined): hostName/hostImage/hostXp/hostLevel
//       populated, guest-side fields all null.
//   (B) Both players in lobby with user_stats rows: both sides populated.
//   (C) Guest has no user_stats row yet: defaults to xp:0, level:1.

import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import {
	setupD1,
	createTestSession,
	createMockAI,
	createMockVectorize,
} from "../setup";
import { battleRoutes } from "../../worker/src/routes/battle";
import type { AuthVariables } from "../../worker/src/middleware/auth-guard";

function buildApp() {
	const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
	app.route("/api/battle", battleRoutes);
	return app;
}

function testEnvWithMocks(): Env {
	const mockAI = createMockAI({});
	const mockVectorize = createMockVectorize([]);
	const mockWorkflow = {
		create: async ({ id }: { id: string }) => ({ id }),
	};
	return {
		...env,
		AI: mockAI,
		VECTORIZE: mockVectorize,
		BATTLE_QUESTION_WORKFLOW: mockWorkflow,
	} as unknown as Env;
}

async function seedRoadmap(userId: string, topic: string): Promise<string> {
	const id = `r-part-${crypto.randomUUID()}`;
	const now = Math.floor(Date.now() / 1000);
	await env.DB.prepare(
		`INSERT OR IGNORE INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'linear', 'complete', '[]', ?, ?)`,
	)
		.bind(id, userId, `Participants: ${topic}`, topic, now, now)
		.run();
	return id;
}

async function upsertUserStats(
	userId: string,
	xp: number,
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await env.DB.prepare(
		`INSERT INTO user_stats (user_id, xp, lessons_completed, questions_correct, current_streak, longest_streak, last_streak_date, last_active_roadmap_id, updated_at)
     VALUES (?, ?, 0, 0, 0, 0, NULL, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET xp = excluded.xp, updated_at = excluded.updated_at`,
	)
		.bind(userId, xp, now)
		.run();
}

async function setUserImage(userId: string, image: string): Promise<void> {
	await env.DB.prepare(`UPDATE users SET image = ? WHERE id = ?`)
		.bind(image, userId)
		.run();
}

async function createBattleViaRoute(
	hostCookie: string,
	roadmapId: string,
	testEnv: Env,
): Promise<{ battleId: string; joinCode: string }> {
	const app = buildApp();
	const res = await app.request(
		"/api/battle",
		{
			method: "POST",
			headers: { Cookie: hostCookie, "Content-Type": "application/json" },
			body: JSON.stringify({ roadmapId, questionCount: 5 }),
		},
		testEnv,
	);
	if (res.status !== 200) {
		throw new Error(
			`create failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as { battleId: string; joinCode: string };
}

type LobbyResponseShape = {
	hostId: string;
	hostName: string;
	hostImage: string | null;
	hostXp: number;
	hostLevel: number;
	guestId: string | null;
	guestName: string | null;
	guestImage: string | null;
	guestXp: number | null;
	guestLevel: number | null;
};

describe("GET /api/battle/:id participant fields (04-36 / gap 04-11)", () => {
	let HOST_COOKIE = "";
	let HOST_ID = "";
	let GUEST_COOKIE = "";
	let GUEST_ID = "";

	beforeAll(async () => {
		await setupD1();
		const host = await createTestSession("participants-host@test.example");
		HOST_COOKIE = host.cookie;
		HOST_ID = host.userId;
		const guest = await createTestSession("participants-guest@test.example");
		GUEST_COOKIE = guest.cookie;
		GUEST_ID = guest.userId;

		// Note: createTestSession seeds user.name = email.split("@")[0],
		// so HOST_NAME === "participants-host" and GUEST_NAME ===
		// "participants-guest" in the assertions below.
	});

	it("A: host-only lobby (guest not yet joined) → host fields populated, guest fields all null", async () => {
		const testEnv = testEnvWithMocks();
		await upsertUserStats(HOST_ID, 150);
		await setUserImage(HOST_ID, "https://cdn.example/host.png");

		const hostRoadmapId = await seedRoadmap(HOST_ID, "host-only-topic");
		const { battleId } = await createBattleViaRoute(
			HOST_COOKIE,
			hostRoadmapId,
			testEnv,
		);

		const app = buildApp();
		const res = await app.request(
			`/api/battle/${battleId}`,
			{ headers: { Cookie: HOST_COOKIE } },
			testEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LobbyResponseShape;

		expect(body.hostId).toBe(HOST_ID);
		// email.split("@")[0] — see setup.ts createTestSession note above
		expect(body.hostName).toBe("participants-host");
		expect(body.hostImage).toBe("https://cdn.example/host.png");
		expect(body.hostXp).toBe(150);
		// computeLevel thresholds: level 2 requires xp >= 100 (base), so 150 → level 2
		expect(body.hostLevel).toBeGreaterThanOrEqual(1);
		expect(body.hostLevel).toBeLessThanOrEqual(25);

		// Guest fields all null (no guest yet).
		expect(body.guestId).toBeNull();
		expect(body.guestName).toBeNull();
		expect(body.guestImage).toBeNull();
		expect(body.guestXp).toBeNull();
		expect(body.guestLevel).toBeNull();
	});

	it("B: both players in lobby with user_stats rows → both sides populated", async () => {
		const testEnv = testEnvWithMocks();
		await upsertUserStats(HOST_ID, 300);
		await upsertUserStats(GUEST_ID, 50);
		await setUserImage(HOST_ID, "https://cdn.example/host2.png");
		await setUserImage(GUEST_ID, "https://cdn.example/guest2.png");

		const hostRoadmapId = await seedRoadmap(HOST_ID, "both-joined-h");
		const guestRoadmapId = await seedRoadmap(GUEST_ID, "both-joined-g");

		const { battleId, joinCode } = await createBattleViaRoute(
			HOST_COOKIE,
			hostRoadmapId,
			testEnv,
		);

		// Guest joins.
		const app = buildApp();
		const joinRes = await app.request(
			"/api/battle/join",
			{
				method: "POST",
				headers: {
					Cookie: GUEST_COOKIE,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					joinCode,
					roadmapId: guestRoadmapId,
				}),
			},
			testEnv,
		);
		expect([200, 202]).toContain(joinRes.status);

		const res = await app.request(
			`/api/battle/${battleId}`,
			{ headers: { Cookie: HOST_COOKIE } },
			testEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LobbyResponseShape;

		expect(body.hostId).toBe(HOST_ID);
		expect(body.hostName).toBe("participants-host");
		expect(body.hostImage).toBe("https://cdn.example/host2.png");
		expect(body.hostXp).toBe(300);
		expect(body.hostLevel).toBeGreaterThanOrEqual(1);

		expect(body.guestId).toBe(GUEST_ID);
		expect(body.guestName).toBe("participants-guest");
		expect(body.guestImage).toBe("https://cdn.example/guest2.png");
		expect(body.guestXp).toBe(50);
		expect(body.guestLevel).toBeGreaterThanOrEqual(1);
	});

	it("C: guest with no user_stats row → defaults to xp: 0, level: 1", async () => {
		const testEnv = testEnvWithMocks();

		// Fresh guest WITHOUT a user_stats row (createTestSession doesn't
		// seed one — it only writes to `users` + `sessions`).
		const freshGuest = await createTestSession(
			`participants-fresh-${crypto.randomUUID().slice(0, 8)}@test.example`,
		);
		await upsertUserStats(HOST_ID, 100);

		const hostRoadmapId = await seedRoadmap(HOST_ID, "no-stats-h");
		const guestRoadmapId = await seedRoadmap(
			freshGuest.userId,
			"no-stats-g",
		);

		const { battleId, joinCode } = await createBattleViaRoute(
			HOST_COOKIE,
			hostRoadmapId,
			testEnv,
		);

		const app = buildApp();
		const joinRes = await app.request(
			"/api/battle/join",
			{
				method: "POST",
				headers: {
					Cookie: freshGuest.cookie,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					joinCode,
					roadmapId: guestRoadmapId,
				}),
			},
			testEnv,
		);
		expect([200, 202]).toContain(joinRes.status);

		// Sanity: the fresh guest really has no user_stats row.
		const statsRow = await env.DB.prepare(
			`SELECT xp FROM user_stats WHERE user_id = ?`,
		)
			.bind(freshGuest.userId)
			.first<{ xp: number }>();
		expect(statsRow).toBeNull();

		const res = await app.request(
			`/api/battle/${battleId}`,
			{ headers: { Cookie: HOST_COOKIE } },
			testEnv,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as LobbyResponseShape;

		expect(body.guestId).toBe(freshGuest.userId);
		// LEFT-JOIN default: xp -> 0, level -> 1 (computeLevel(0) === level 1)
		expect(body.guestXp).toBe(0);
		expect(body.guestLevel).toBe(1);
	});
});
