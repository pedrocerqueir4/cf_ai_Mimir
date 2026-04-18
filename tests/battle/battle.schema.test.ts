import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";

// VALIDATION.md 04-W0-02: battle tables exist, constraints work, partial unique
// index on join_code only fires for status='lobby'.

describe("battle schema — D1 migration applies (04-W0-02)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("inserts and reads a battle_pool_topics row", async () => {
    const now = Math.floor(Date.now() / 1000);
    const id = `pool-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO battle_pool_topics (id, topic, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(id, "javascript basics", "ready", now, now).run();

    const row = await env.DB.prepare(
      `SELECT id, topic, status FROM battle_pool_topics WHERE id = ?`,
    ).bind(id).first<{ id: string; topic: string; status: string }>();
    expect(row).toEqual({ id, topic: "javascript basics", status: "ready" });
  });

  it("inserts and reads a battle_quiz_pool row", async () => {
    const now = Math.floor(Date.now() / 1000);
    const poolId = `pool-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO battle_pool_topics (id, topic, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(poolId, "react hooks", "ready", now, now).run();

    const qid = `${poolId}-q0`;
    await env.DB.prepare(
      `INSERT INTO battle_quiz_pool (id, pool_topic_id, question_text, question_type, options_json, correct_option_id, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(qid, poolId, "what is useState?", "mcq", "[]", "a", "hook", now).run();

    const row = await env.DB.prepare(
      `SELECT id, question_text FROM battle_quiz_pool WHERE id = ?`,
    ).bind(qid).first<{ id: string; question_text: string }>();
    expect(row?.id).toBe(qid);
    expect(row?.question_text).toBe("what is useState?");
  });

  it("inserts a battles row with lobby status and a join code", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = `u-${crypto.randomUUID()}`;
    const roadmapId = `r-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Alice", `alice-${userId}@test.example`, now, now).run();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roadmapId, userId, "JS Basics", "javascript basics", "linear", "complete", "[]", now, now).run();

    const battleId = `b-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(battleId, "ABCDEF", userId, roadmapId, 10, "lobby", now).run();

    const row = await env.DB.prepare(
      `SELECT id, join_code, status FROM battles WHERE id = ?`,
    ).bind(battleId).first<{ id: string; join_code: string; status: string }>();
    expect(row).toEqual({ id: battleId, join_code: "ABCDEF", status: "lobby" });
  });

  it("partial UNIQUE INDEX prevents two lobby battles with the same join code", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = `u-${crypto.randomUUID()}`;
    const roadmapId = `r-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Bob", `bob-${userId}@test.example`, now, now).run();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roadmapId, userId, "JS", "js", "linear", "complete", "[]", now, now).run();

    const code = "ZXYWVU";
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(`b-${crypto.randomUUID()}`, code, userId, roadmapId, 5, "lobby", now).run();

    // Second lobby with same code must fail the partial unique index.
    await expect(
      env.DB.prepare(
        `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(`b-${crypto.randomUUID()}`, code, userId, roadmapId, 5, "lobby", now).run(),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it("partial UNIQUE INDEX allows reuse of a join code once the original battle is no longer in lobby", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = `u-${crypto.randomUUID()}`;
    const roadmapId = `r-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Cara", `cara-${userId}@test.example`, now, now).run();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roadmapId, userId, "JS", "js", "linear", "complete", "[]", now, now).run();

    const code = "QRSTUV";
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`,
    ).bind(`b-${crypto.randomUUID()}`, code, userId, roadmapId, 5, now, now).run();

    // New lobby with the same code should succeed because the completed one
    // is outside the partial index scope (WHERE status='lobby').
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'lobby', ?)`,
    ).bind(`b-${crypto.randomUUID()}`, code, userId, roadmapId, 5, now).run();

    const rows = await env.DB.prepare(
      `SELECT status FROM battles WHERE join_code = ? ORDER BY status`,
    ).bind(code).all<{ status: string }>();
    expect(rows.results.map((r) => r.status)).toEqual(["completed", "lobby"]);
  });

  it("inserts a battle_answers row referencing a real question", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = `u-${crypto.randomUUID()}`;
    const roadmapId = `r-${crypto.randomUUID()}`;
    const poolId = `pool-${crypto.randomUUID()}`;
    const battleId = `b-${crypto.randomUUID()}`;
    const qid = `${poolId}-q0`;
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Dan", `dan-${userId}@test.example`, now, now).run();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roadmapId, userId, "JS", "js", "linear", "complete", "[]", now, now).run();
    await env.DB.prepare(
      `INSERT INTO battle_pool_topics (id, topic, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(poolId, "js", "ready", now, now).run();
    await env.DB.prepare(
      `INSERT INTO battle_quiz_pool (id, pool_topic_id, question_text, question_type, options_json, correct_option_id, explanation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(qid, poolId, "q?", "mcq", "[]", "a", "", now).run();
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
    ).bind(battleId, "WXYZAB", userId, roadmapId, 5, now).run();

    const answerId = `${battleId}-q0-${userId}`;
    await env.DB.prepare(
      `INSERT INTO battle_answers (id, battle_id, user_id, question_id, question_index, selected_option_id, correct, response_time_ms, points_awarded, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(answerId, battleId, userId, qid, 0, "a", 1_200, 900, now).run();

    const row = await env.DB.prepare(
      `SELECT points_awarded FROM battle_answers WHERE id = ?`,
    ).bind(answerId).first<{ points_awarded: number }>();
    expect(row?.points_awarded).toBe(900);
  });

  it("inserts a battle_ledger row", async () => {
    const now = Math.floor(Date.now() / 1000);
    const userId = `u-${crypto.randomUUID()}`;
    const roadmapId = `r-${crypto.randomUUID()}`;
    const battleId = `b-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(userId, "Eve", `eve-${userId}@test.example`, now, now).run();
    await env.DB.prepare(
      `INSERT INTO roadmaps (id, user_id, title, topic, complexity, status, nodes_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(roadmapId, userId, "JS", "js", "linear", "complete", "[]", now, now).run();
    await env.DB.prepare(
      `INSERT INTO battles (id, join_code, host_id, host_roadmap_id, question_count, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'completed', ?)`,
    ).bind(battleId, "LEDG01", userId, roadmapId, 5, now).run();

    await env.DB.prepare(
      `INSERT INTO battle_ledger (battle_id, winner_id, loser_id, xp_amount, outcome, settled_at)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    ).bind(battleId, userId, 50, "decisive", now).run();

    const row = await env.DB.prepare(
      `SELECT xp_amount, outcome FROM battle_ledger WHERE battle_id = ?`,
    ).bind(battleId).first<{ xp_amount: number; outcome: string }>();
    expect(row).toEqual({ xp_amount: 50, outcome: "decisive" });
  });
});
