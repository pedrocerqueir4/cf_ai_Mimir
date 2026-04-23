import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1, createMockAI, createMockVectorize } from "../setup";
import { findOrQueueTopic } from "../../worker/src/services/battle-pool";

// Debug session: battle-pool-stale-loser (2026-04-23).
//
// Regression coverage for the "dead row blocks re-queue" bug:
//
//   When BattleQuestionGenerationWorkflow's FATAL handler marked a
//   battle_pool_topics row `status='failed'` and the row was left in place
//   (no TTL / cleanup), a subsequent call to findOrQueueTopic for the same
//   normalized topic would:
//     1. Vectorize query → 0 matches (the failed run never upserted a vector,
//        or the vector was never indexed)
//     2. INSERT OR IGNORE → silently dropped by UNIQUE(topic)
//     3. selectCanonical → returns the stale 'failed' row
//     4. race=LOSER branch → returned hardcoded status='generating' despite
//        not scheduling any workflow. Caller polled forever.
//
// The fix SELECTS `status`, `workflow_started_at`, and `updated_at` and
// re-queues gravestone rows via a guarded conditional UPDATE (compare-and-
// swap). The staleness gate uses `workflow_started_at` when present (ms) and
// falls back to `updated_at` (seconds) when null — so a freshly INSERTed row
// (null started_at, just-now updated_at) is NOT treated as stale by
// concurrent MISS callers, preserving the T-04-10 race-dedup contract in
// battle.pool.race.test.ts.
//
// Five scenarios asserted:
//   (a) status='failed' stale row → re-queued, status='miss', workflow fires
//   (b) status='generating' with old workflow_started_at (silently dropped
//       after Step 0 ran) → re-queued, status='miss', workflow fires
//   (c) status='generating' with fresh workflow_started_at (< 60s) → LOSER
//       behavior preserved: status='generating', NO workflow.create
//   (d) status='ready' canonical (no Vectorize match, e.g. vector upsert
//       lagged) AND pool has enough questions → status='hit' with sampled
//       questions from the existing pool
//   (e) status='generating' with NULL workflow_started_at AND old updated_at
//       (silently dropped BEFORE Step 0 ran) → re-queued, status='miss'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function norm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!?:;]+$/g, "");
}

async function seedStalePoolRow(opts: {
  topic: string;
  status: "generating" | "ready" | "failed";
  workflowStartedAt?: number | null;
  /** Override updated_at (unix seconds). Defaults to now. */
  updatedAtSec?: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_pool_topics
       (id, topic, status, workflow_run_id, workflow_started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      norm(opts.topic),
      opts.status,
      id,
      opts.workflowStartedAt ?? null,
      nowSec,
      opts.updatedAtSec ?? nowSec,
    )
    .run();
  return id;
}

async function readPoolRow(id: string): Promise<{
  status: string;
  workflowRunId: string | null;
  workflowStartedAt: number | null;
} | null> {
  const row = await env.DB
    .prepare(
      `SELECT status, workflow_run_id AS workflowRunId, workflow_started_at AS workflowStartedAt
         FROM battle_pool_topics WHERE id = ?`,
    )
    .bind(id)
    .first<{ status: string; workflowRunId: string | null; workflowStartedAt: number | null }>();
  return row ?? null;
}

describe("battle pool stale loser — re-queue gravestone rows (debug battle-pool-stale-loser)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("(a) stale status='failed' row → re-queues with same canonicalId and returns status='miss'", async () => {
    const topic = `stale-failed ${crypto.randomUUID()}`;
    const staleId = await seedStalePoolRow({ topic, status: "failed" });

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]); // miss → fall through to INSERT OR IGNORE

    const createCalls: Array<{ id: string; params: unknown }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push(opts);
        return { id: opts.id };
      },
    };

    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, topic);

    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    // Canonical id is the SAME stale id we seeded (re-queue, not re-insert).
    expect(result.poolTopicId).toBe(staleId);
    expect(result.poolTopicId).toMatch(UUID_RE);
    // Contract (debug battle-pool-requeue-silent): workflowRunId on
    // re-queue is a FRESH UUID — NEVER the stale canonical id — so the
    // new Workflows instance can't collide with the terminated previous
    // run.
    expect(result.workflowRunId).toMatch(UUID_RE);
    expect(result.workflowRunId).not.toBe(staleId);

    // Exactly one workflow scheduled, with the fresh runId.
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].id).toBe(result.workflowRunId);

    // Row was flipped back to 'generating', workflow_started_at cleared,
    // and workflow_run_id persisted so honest-status callers can surface
    // the live run.
    const row = await readPoolRow(staleId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("generating");
    expect(row!.workflowRunId).toBe(result.workflowRunId);
    expect(row!.workflowRunId).not.toBe(staleId);
    expect(row!.workflowStartedAt).toBeNull();

    // No duplicate row inserted for the same topic.
    const all = await env.DB
      .prepare(`SELECT id FROM battle_pool_topics WHERE topic = ?`)
      .bind(norm(topic))
      .all<{ id: string }>();
    expect(all.results).toHaveLength(1);
    expect(all.results[0].id).toBe(staleId);
  });

  it("(b) stale status='generating' with stale workflow_started_at → re-queues (silently-dropped workflow recovery)", async () => {
    const topic = `stale-generating ${crypto.randomUUID()}`;
    // 2 minutes ago — well past the 60s staleness window.
    const staleStartedMs = Date.now() - 2 * 60 * 1000;
    const staleId = await seedStalePoolRow({
      topic,
      status: "generating",
      workflowStartedAt: staleStartedMs,
    });

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    const createCalls: Array<{ id: string }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push({ id: opts.id });
        return { id: opts.id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, topic);

    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.poolTopicId).toBe(staleId);
    expect(createCalls).toHaveLength(1);
    // Fresh workflowRunId per debug battle-pool-requeue-silent.
    expect(createCalls[0].id).toBe(result.workflowRunId);
    expect(createCalls[0].id).not.toBe(staleId);

    const row = await readPoolRow(staleId);
    expect(row!.status).toBe("generating");
    expect(row!.workflowRunId).toBe(result.workflowRunId);
    expect(row!.workflowStartedAt).toBeNull();
  });

  it("(c) fresh status='generating' row (workflow_started_at < 60s old) → LOSER behavior preserved, no workflow.create", async () => {
    const topic = `fresh-generating ${crypto.randomUUID()}`;
    // 5 seconds ago — well within the 60s window.
    const freshStartedMs = Date.now() - 5 * 1000;
    const freshId = await seedStalePoolRow({
      topic,
      status: "generating",
      workflowStartedAt: freshStartedMs,
    });

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    const createCalls: Array<{ id: string }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push({ id: opts.id });
        return { id: opts.id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, topic);

    // LOSER → generating, pointing at the existing in-flight row.
    expect(result.status).toBe("generating");
    if (result.status !== "generating") return;
    expect(result.poolTopicId).toBe(freshId);
    expect(result.workflowRunId).toBe(freshId);

    // Crucially: no duplicate workflow scheduled.
    expect(createCalls).toHaveLength(0);

    // Row is untouched — status still 'generating', workflow_started_at preserved.
    const row = await readPoolRow(freshId);
    expect(row!.status).toBe("generating");
    expect(row!.workflowStartedAt).toBe(freshStartedMs);
  });

  it("(d) status='ready' canonical with full pool but no Vectorize match → returns status='hit'", async () => {
    const topic = `ready-canonical ${crypto.randomUUID()}`;
    const readyId = await seedStalePoolRow({ topic, status: "ready" });

    // Seed 10 questions (>= 5 active + 5 reserve default) so sampleQuestions
    // does not throw.
    const nowSec = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(
        `INSERT INTO battle_quiz_pool
           (id, pool_topic_id, question_text, question_type, options_json,
            correct_option_id, explanation, created_at)
         VALUES (?, ?, ?, 'mcq', ?, 'a', 'because', ?)`,
      )
        .bind(
          `${readyId}-q${i}`,
          readyId,
          `question ${i}?`,
          JSON.stringify([
            { id: "a", text: "opt a" },
            { id: "b", text: "opt b" },
            { id: "c", text: "opt c" },
            { id: "d", text: "opt d" },
          ]),
          nowSec,
        )
        .run();
    }

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]); // no match → MISS path → canonical 'ready'

    let createCalls = 0;
    const mockWorkflow = {
      create: async ({ id }: { id: string }) => {
        createCalls++;
        return { id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, topic);

    expect(result.status).toBe("hit");
    if (result.status !== "hit") return;
    expect(result.poolTopicId).toBe(readyId);
    expect(result.questions).toHaveLength(5);
    expect(result.reservedQuestions).toHaveLength(5);
    // Hit path must not trigger any workflow.
    expect(createCalls).toBe(0);
  });

  it("(e) status='generating' with NULL workflow_started_at AND old updated_at → re-queues (dropped before Step 0 ran)", async () => {
    const topic = `stale-null-started ${crypto.randomUUID()}`;
    // Row was inserted 2 minutes ago but the workflow never stamped
    // workflow_started_at — simulates Cloudflare Workflows scheduling
    // layer dropping the run before Step 0 ran.
    const oldUpdatedAtSec = Math.floor(Date.now() / 1000) - 2 * 60;
    const staleId = await seedStalePoolRow({
      topic,
      status: "generating",
      workflowStartedAt: null,
      updatedAtSec: oldUpdatedAtSec,
    });

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    const createCalls: Array<{ id: string }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push({ id: opts.id });
        return { id: opts.id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    const result = await findOrQueueTopic(testEnv, topic);

    expect(result.status).toBe("miss");
    if (result.status !== "miss") return;
    expect(result.poolTopicId).toBe(staleId);
    expect(createCalls).toHaveLength(1);
    // Fresh workflowRunId per debug battle-pool-requeue-silent.
    expect(createCalls[0].id).toBe(result.workflowRunId);
    expect(createCalls[0].id).not.toBe(staleId);
  });

  // ───────────────────────────────────────────────────────────────────
  // Regression: debug session `battle-pool-requeue-silent` (2026-04-23).
  //
  // The bug: when the Workflows instance id is coupled to the pool topic
  // id (same UUID reused on every re-queue), miniflare's local
  // Workflow binding silently no-ops create({ id }) the SECOND time
  // because the previous instance is in a terminal state. The re-queue
  // path logs DONE but no workflow run starts — ~60s later the
  // BattleRoom pool-timeout alarm flips the row back to 'failed'.
  //
  // The fix decouples them: every schedule attempt uses a fresh UUID
  // for the Workflows instance id, persisted in
  // battle_pool_topics.workflow_run_id. This test asserts the contract
  // by driving two findOrQueueTopic calls for the same topic where the
  // first leaves the row in 'failed' state, and verifying (1) each
  // create() receives a distinct runId and (2) the pool row's
  // workflow_run_id column advances between the two calls.
  // ───────────────────────────────────────────────────────────────────
  it("regression (battle-pool-requeue-silent): two re-queues for same topic → each workflow gets a fresh instance id", async () => {
    const topic = `requeue-silent-regression ${crypto.randomUUID()}`;

    const mockAI = createMockAI({});
    const mockVectorize = createMockVectorize([]);
    const createCalls: Array<{ id: string }> = [];
    const mockWorkflow = {
      create: async (opts: { id: string; params: unknown }) => {
        createCalls.push({ id: opts.id });
        return { id: opts.id };
      },
    };
    const testEnv = {
      ...env,
      AI: mockAI,
      VECTORIZE: mockVectorize,
      BATTLE_QUESTION_WORKFLOW: mockWorkflow,
    } as unknown as Env;

    // First call: no row exists → MISS path → workflow scheduled with
    // a fresh runId.
    const first = await findOrQueueTopic(testEnv, topic);
    expect(first.status).toBe("miss");
    if (first.status !== "miss") return;
    const firstRunId = first.workflowRunId;
    expect(firstRunId).toMatch(UUID_RE);
    expect(firstRunId).not.toBe(first.poolTopicId);

    // Simulate the previous workflow failing / leaving the row as a
    // gravestone. This matches the symptom reported in the debug session:
    // BattleQuestionGenerationWorkflow's FATAL handler flips the row to
    // 'failed' so future calls treat it as re-queueable.
    await env.DB.prepare(
      `UPDATE battle_pool_topics SET status = 'failed' WHERE id = ?`,
    )
      .bind(first.poolTopicId)
      .run();

    // Second call: LOSER→REQUEUE path wins the CAS and schedules a new
    // workflow instance — MUST receive a DIFFERENT runId from the first,
    // otherwise we hit the silent-no-op bug.
    const second = await findOrQueueTopic(testEnv, topic);
    expect(second.status).toBe("miss");
    if (second.status !== "miss") return;
    expect(second.poolTopicId).toBe(first.poolTopicId);
    const secondRunId = second.workflowRunId;
    expect(secondRunId).toMatch(UUID_RE);
    expect(secondRunId).not.toBe(firstRunId);
    expect(secondRunId).not.toBe(second.poolTopicId);

    // Both create() calls got distinct ids matching each return.
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0].id).toBe(firstRunId);
    expect(createCalls[1].id).toBe(secondRunId);
    expect(createCalls[0].id).not.toBe(createCalls[1].id);

    // Pool row's workflow_run_id advanced — this is what clients poll.
    const row = await readPoolRow(first.poolTopicId);
    expect(row).not.toBeNull();
    expect(row!.status).toBe("generating");
    expect(row!.workflowRunId).toBe(secondRunId);
  });
});
