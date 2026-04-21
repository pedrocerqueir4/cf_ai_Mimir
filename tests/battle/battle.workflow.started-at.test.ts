import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";
import {
  markWorkflowStarted,
  nullWorkflowStartedAt,
} from "../../worker/src/workflows/BattleQuestionGenerationWorkflow";
// BLOCKER-3: static-source regression case — mirrors the Test 04-37 pattern
// (see tests/battle/battle.wager.advance.test.ts:32). The Vite `?raw`
// resolver reads the workflow source file at bundle time and ships it as
// a string, sidestepping `node:fs` path issues in the Workers test pool.
// @ts-ignore — Vite `?raw` returns string at bundle time; TS lacks types.
import workflowSource from "../../worker/src/workflows/BattleQuestionGenerationWorkflow.ts?raw";

// VALIDATION.md 04-41 (MULT-01, MULT-02, gap 04-12):
// Observability helpers markWorkflowStarted + nullWorkflowStartedAt.
//   - markWorkflowStarted stamps workflow_started_at = Date.now() (unix ms —
//     distinct from createdAt/updatedAt which use Drizzle mode:"timestamp"
//     i.e. unix seconds; the millisecond precision is required for the
//     60s in-flight window used by POST /:id/pool/retry).
//   - nullWorkflowStartedAt sets it back to NULL (called by the retry
//     endpoint before re-firing the workflow).
//   - Both refresh updated_at (battle_pool_topics.updated_at is mode:
//     "timestamp" → unix seconds — a 1.1s setTimeout between write and
//     read ensures strict ordering despite second-level precision).
//
// Case D [BLOCKER-3] static-source assertion: the record-workflow-started
// step.do must exist in BattleQuestionGenerationWorkflow.ts AND appear
// BEFORE generate-battle-questions in source order AND invoke
// markWorkflowStarted( in its body. Mirrors the Test 04-37 static-source
// precedent since miniflare cannot drive Cloudflare Workflows to test
// step ordering at runtime.

async function seedGeneratingPoolTopic(
  poolTopicId: string,
  topic: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO battle_pool_topics (id, topic, status, workflow_run_id, created_at, updated_at)
     VALUES (?, ?, 'generating', ?, ?, ?)`,
  )
    .bind(poolTopicId, `${topic}-${poolTopicId}`, poolTopicId, now, now)
    .run();
}

describe("Workflow observability helpers (04-41 / gap 04-12)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("A: markWorkflowStarted stamps workflow_started_at = now and refreshes updated_at", async () => {
    const poolTopicId = `pt-wfstart-A-${crypto.randomUUID()}`;
    await seedGeneratingPoolTopic(poolTopicId, "wfstart-A-topic");

    const priorUpdatedAt = await env.DB.prepare(
      `SELECT updated_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ updated_at: number }>();

    // 1.1s wait so updated_at can strictly increase on SQLite (unix seconds).
    await new Promise((r) => setTimeout(r, 1100));

    const tBefore = Date.now();
    await markWorkflowStarted(env as unknown as Env, poolTopicId);
    const tAfter = Date.now();

    const row = await env.DB.prepare(
      `SELECT workflow_started_at, updated_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ workflow_started_at: number; updated_at: number }>();

    expect(row).not.toBeNull();
    expect(row!.workflow_started_at).not.toBeNull();
    // ±2s wall-clock tolerance.
    expect(row!.workflow_started_at).toBeGreaterThanOrEqual(tBefore - 2_000);
    expect(row!.workflow_started_at).toBeLessThanOrEqual(tAfter + 2_000);

    expect(row!.updated_at).toBeGreaterThan(priorUpdatedAt?.updated_at ?? 0);
  });

  it("B: nullWorkflowStartedAt sets workflow_started_at back to NULL", async () => {
    const poolTopicId = `pt-wfstart-B-${crypto.randomUUID()}`;
    await seedGeneratingPoolTopic(poolTopicId, "wfstart-B-topic");

    await markWorkflowStarted(env as unknown as Env, poolTopicId);
    const stamped = await env.DB.prepare(
      `SELECT workflow_started_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ workflow_started_at: number | null }>();
    expect(stamped?.workflow_started_at).not.toBeNull();

    await new Promise((r) => setTimeout(r, 1100));
    await nullWorkflowStartedAt(env as unknown as Env, poolTopicId);

    const row = await env.DB.prepare(
      `SELECT workflow_started_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ workflow_started_at: number | null }>();
    expect(row?.workflow_started_at).toBeNull();
  });

  it("C: markWorkflowStarted is idempotent — second call overwrites with newer timestamp", async () => {
    const poolTopicId = `pt-wfstart-C-${crypto.randomUUID()}`;
    await seedGeneratingPoolTopic(poolTopicId, "wfstart-C-topic");

    await markWorkflowStarted(env as unknown as Env, poolTopicId);
    const first = await env.DB.prepare(
      `SELECT workflow_started_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ workflow_started_at: number }>();

    await new Promise((r) => setTimeout(r, 1100));
    await markWorkflowStarted(env as unknown as Env, poolTopicId);
    const second = await env.DB.prepare(
      `SELECT workflow_started_at FROM battle_pool_topics WHERE id = ?`,
    )
      .bind(poolTopicId)
      .first<{ workflow_started_at: number }>();

    expect(second?.workflow_started_at).toBeGreaterThan(
      first?.workflow_started_at ?? 0,
    );
  });

  // ─── BLOCKER-3: static-source regression case ─────────────────────────
  // The observability stamp (04-12 Task 3 record-workflow-started step) has
  // no direct integration coverage — miniflare cannot drive Cloudflare
  // Workflows. This assertion reads the workflow source as a string and
  // verifies (i) the step exists, (ii) it appears BEFORE the main question
  // generation step in source order, and (iii) it invokes markWorkflowStarted
  // in its body. Pattern mirrors Test 04-37 in battle.wager.advance.test.ts.
  it("D: record-workflow-started step precedes generate-battle-questions and invokes markWorkflowStarted", () => {
    const source = workflowSource as string;

    // Strip comment lines so the assertions aren't fooled by explanatory
    // prose in block/line comments (matches 04-37's approach).
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

    // (i) the step literal exists as a step.do name in a step.do(...) call.
    expect(codeOnly).toMatch(/step\.do\(\s*["']record-workflow-started["']/);

    // (ii) source-order check: record-workflow-started appears BEFORE
    // generate-battle-questions in the file.
    const recordIdx = codeOnly.indexOf('"record-workflow-started"');
    const recordIdxSingle = codeOnly.indexOf("'record-workflow-started'");
    const genIdx = codeOnly.indexOf('"generate-battle-questions"');
    const genIdxSingle = codeOnly.indexOf("'generate-battle-questions'");
    const firstRecord = [recordIdx, recordIdxSingle]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    const firstGen = [genIdx, genIdxSingle]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    expect(firstRecord).toBeDefined();
    expect(firstGen).toBeDefined();
    expect(firstRecord!).toBeLessThan(firstGen!);

    // (iii) the body of the record-workflow-started step.do(...) call
    // contains a markWorkflowStarted( invocation. Because step.do(...) bodies
    // can span many lines, take a window [firstRecord, firstGen] — the
    // body of record-workflow-started MUST be entirely before
    // generate-battle-questions — and assert the helper call is within it.
    const windowText = codeOnly.slice(firstRecord!, firstGen!);
    expect(windowText).toMatch(/markWorkflowStarted\s*\(/);
  });
});
