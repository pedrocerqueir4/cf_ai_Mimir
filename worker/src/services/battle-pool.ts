import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { TOPIC_MAX_LEN, assertTopicSafe } from "../validation/battle-prompts";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Vectorize namespace for battle topic vectors (D-08). Isolated from lesson-rag. */
export const BATTLE_TOPICS_NAMESPACE = "battle-topics";

/**
 * Cosine similarity threshold for topic match (D-08).
 * STRICT greater than: score 0.85 → miss, score > 0.85 → hit.
 */
export const POOL_SIMILARITY_THRESHOLD = 0.85;

/** Number of questions generated per topic (D-09). */
export const POOL_QUESTION_COUNT = 20;

/**
 * Staleness window for an in-flight workflow (matches BattleRoom
 * POOL_TIMEOUT_MS and POOL_RETRY_INFLIGHT_WINDOW_MS in routes/battle.ts).
 *
 * A row with status='generating' whose workflow_started_at is older than this
 * window is considered stale — the workflow was silently dropped by the
 * Cloudflare Workflows runtime, the DO alarm didn't fire (e.g., the battle
 * was abandoned before setAlarm ran), or the scheduling succeeded but never
 * executed. findOrQueueTopic will re-fire the workflow in that case rather
 * than leave the caller polling forever.
 */
const POOL_GENERATING_STALENESS_MS = 60 * 1000;

const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BattleQuizQuestion {
  id: string;
  questionText: string;
  questionType: "mcq" | "true_false";
  options: Array<{ id: string; text: string }>;
  correctOptionId: string;
  explanation: string;
}

export type PoolLookupResult =
  | {
      status: "hit";
      poolTopicId: string;
      questions: BattleQuizQuestion[];
      reservedQuestions: BattleQuizQuestion[];
    }
  | {
      status: "miss";
      poolTopicId: string;
      workflowRunId: string;
    }
  | {
      // Another request inserted the same topic first — workflow is in flight.
      status: "generating";
      poolTopicId: string;
      workflowRunId: string;
    };

export interface FindOrQueueOptions {
  /** How many questions to return for the active round. Default 5. */
  count?: 5 | 10 | 15;
  /** How many extra questions to reserve for tiebreakers. Default 5. */
  reserveCount?: number;
  /** Deterministic shuffle seed (defaults to poolTopicId). */
  seed?: string;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Canonicalize a raw topic string for equality + embedding.
 *
 * Rules (must stay deterministic so equal topics collide on INSERT OR IGNORE):
 *   1. trim leading/trailing whitespace
 *   2. lowercase
 *   3. collapse runs of ASCII whitespace → single space
 *   4. strip trailing punctuation (`.!?:;`)
 *
 * "React Fundamentals" → "react fundamentals"
 * "  Python  Basics? " → "python basics"
 * "Python 3" and "python3" stay DIFFERENT (preserves user intent).
 */
export function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?:;]+$/g, "");
}

// ─── Deterministic Shuffle (Mulberry32 PRNG) ─────────────────────────────────

/**
 * Mulberry32 PRNG — tiny, fast, deterministic. Used so both battle participants
 * see the same question order when they receive the same seed.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit unsigned int (FNV-1a). */
function hashSeed(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** In-place Fisher-Yates shuffle using the provided RNG. Returns the array. */
function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Row Parsing ─────────────────────────────────────────────────────────────

type BattleQuizPoolRow = typeof schema.battleQuizPool.$inferSelect;

function rowToQuestion(row: BattleQuizPoolRow): BattleQuizQuestion {
  let options: Array<{ id: string; text: string }> = [];
  try {
    const parsed = JSON.parse(row.optionsJson);
    if (Array.isArray(parsed)) {
      options = parsed;
    }
  } catch {
    options = [];
  }
  return {
    id: row.id,
    questionText: row.questionText,
    questionType: row.questionType as "mcq" | "true_false",
    options,
    correctOptionId: row.correctOptionId,
    explanation: row.explanation,
  };
}

// ─── Pool Sampling ───────────────────────────────────────────────────────────

/**
 * Deterministically sample `count` active + `reserveCount` tiebreaker questions
 * from a ready pool. Both players in a battle receive the same seed, so they
 * see the same ordering.
 *
 * Throws if the pool does not contain exactly POOL_QUESTION_COUNT rows.
 */
export async function sampleQuestions(
  env: Env,
  poolTopicId: string,
  count: 5 | 10 | 15 = 5,
  reserveCount = 5,
  seed?: string,
): Promise<{ questions: BattleQuizQuestion[]; reservedQuestions: BattleQuizQuestion[] }> {
  const db = drizzle(env.DB, { schema });
  const rows = await db
    .select()
    .from(schema.battleQuizPool)
    .where(eq(schema.battleQuizPool.poolTopicId, poolTopicId));

  if (rows.length < count + reserveCount) {
    throw new Error(
      `Pool ${poolTopicId} has ${rows.length} questions; need ${count + reserveCount}`,
    );
  }

  const questions = rows.map(rowToQuestion);
  const rng = mulberry32(hashSeed(seed ?? poolTopicId));
  shuffleInPlace(questions, rng);

  return {
    questions: questions.slice(0, count),
    reservedQuestions: questions.slice(count, count + reserveCount),
  };
}

// ─── Retry helper ────────────────────────────────────────────────────────────

/**
 * Run `fn`, and if it throws, retry once after a jittered backoff delay.
 *
 * Purpose (gap 04-09): absorb transient Workers AI / Vectorize upstream
 * errors (e.g., InferenceUpstreamError 1031) so a single hiccup does not
 * strand a battle join. A second failure re-throws the LAST error unchanged
 * so the caller's existing error-handling path runs.
 *
 * Defaults: 1 retry (2 attempts total), 200-400ms random backoff between
 * attempts. Bounded so the overall join request stays well under HTTP
 * client-side timeouts even on a second failure.
 */
async function retryWithJitter<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; minMs?: number; maxMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const minMs = opts.minMs ?? 200;
  const maxMs = opts.maxMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = Math.floor(minMs + Math.random() * Math.max(1, maxMs - minMs));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// ─── Vectorize helpers ───────────────────────────────────────────────────────

export async function embedTopic(env: Env, normalized: string): Promise<number[]> {
  const resp = (await retryWithJitter(() =>
    (env.AI.run as any)(EMBEDDING_MODEL, {
      text: [normalized],
    }),
  )) as { data: number[][] };
  const embedding = resp?.data?.[0];
  if (!embedding || embedding.length === 0) {
    console.error(
      `[embedTopic] FAILED topic="${normalized}" — empty embedding response`,
    );
    throw new Error("Failed to generate topic embedding");
  }
  return embedding;
}

// ─── findOrQueueTopic ────────────────────────────────────────────────────────

/**
 * Battle pool lookup (D-08 + T-04-10).
 *
 * 1. Normalize topic.
 * 2. Embed normalized topic with bge-large-en-v1.5.
 * 3. Query Vectorize in the `battle-topics` namespace (topK=1).
 * 4. If top match score > 0.85, verify the pool row is ready and return its
 *    questions as `status: "hit"`.
 * 5. Otherwise, attempt an INSERT OR IGNORE on battle_pool_topics. Three
 *    sub-cases after the post-INSERT SELECT:
 *    a. `canonicalId === attemptId` → WINNER: schedule workflow, return 'miss'.
 *    b. `canonicalId !== attemptId` AND canonical row is a stale gravestone
 *       (status='failed', or status='generating' that is clearly abandoned —
 *       workflow_started_at older than POOL_GENERATING_STALENESS_MS, or
 *       workflow_started_at IS NULL AND updated_at older than the window)
 *       → RE-QUEUE via a guarded conditional UPDATE, schedule a fresh
 *       workflow against the canonical id, return 'miss'. The UPDATE's WHERE
 *       clause is a compare-and-swap — only one caller wins when two clients
 *       race to revive the same dead row.
 *    c. `canonicalId !== attemptId` AND canonical row is fresh generating →
 *       LOSER: return 'generating' pointing at the canonical row (existing
 *       T-04-10 dedup behavior — preserved).
 *    d. `canonicalId !== attemptId` AND canonical row is 'ready' → return
 *       'hit' with sampled questions. Reachable when Vectorize upsert lagged
 *       or was skipped, but the pool is usable.
 *
 *  The staleness check uses TWO signals because `workflow_started_at` is
 *  stamped by Step 0 of BattleQuestionGenerationWorkflow — a freshly
 *  INSERTed row has `workflow_started_at = NULL` until that step runs. We
 *  fall back to `updated_at` (unix SECONDS) for the null-started-at case so
 *  concurrent MISS inserts don't immediately re-queue each other. Matches
 *  the pattern used by POST /api/battle/:id/pool/retry.
 */
export async function findOrQueueTopic(
  env: Env,
  rawTopic: string,
  options: FindOrQueueOptions = {},
): Promise<PoolLookupResult> {
  const count = options.count ?? 5;
  const reserveCount = options.reserveCount ?? 5;

  // Normalize + safety check (T-04-09).
  const normalized = normalizeTopic(rawTopic);
  assertTopicSafe(normalized);

  // Embed topic.
  const topicEmbedding = await embedTopic(env, normalized);

  // Vectorize lookup in the battle-topics namespace. Wrapped in
  // retryWithJitter (gap 04-09) so a transient upstream failure does not
  // immediately surface as a user-facing 503; a single retry after a short
  // jittered backoff absorbs the vast majority of one-off flakes.
  const queryResult = (await retryWithJitter(() =>
    (env.VECTORIZE as any).query(topicEmbedding, {
      topK: 1,
      returnMetadata: "all",
      namespace: BATTLE_TOPICS_NAMESPACE,
    }),
  )) as {
    matches?: Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
  };

  const match = queryResult.matches?.[0];

  if (match && match.score > POOL_SIMILARITY_THRESHOLD) {
    // HIT path — look up existing pool topic + its questions.
    const existingId =
      (match.metadata?.poolTopicId as string | undefined) ?? match.id;

    const db = drizzle(env.DB, { schema });
    const topicRow = await db
      .select()
      .from(schema.battlePoolTopics)
      .where(eq(schema.battlePoolTopics.id, existingId))
      .limit(1);

    if (topicRow.length > 0 && topicRow[0].status === "ready") {
      const sampled = await sampleQuestions(
        env,
        existingId,
        count,
        reserveCount,
        options.seed ?? existingId,
      );
      return {
        status: "hit",
        poolTopicId: existingId,
        questions: sampled.questions,
        reservedQuestions: sampled.reservedQuestions,
      };
    }

    // Metadata claimed a hit but the D1 row is missing or not ready —
    // fall through to miss-path so we queue regeneration. This edge case
    // matters if a pool row is deleted but the vector index still holds it.
    console.warn(
      `[findOrQueueTopic] HIT_FALLTHROUGH vector matched but D1 row not ready (found=${topicRow.length > 0}, status=${topicRow[0]?.status ?? "n/a"}) — falling through to MISS`,
    );
  }

  // MISS path — attempt to INSERT a new pool topic row, raced against
  // concurrent callers for the same normalized topic.
  const poolTopicId = crypto.randomUUID();
  // Workflows instance id is DECOUPLED from poolTopicId. Local miniflare's
  // create({ id }) silently no-ops when an instance with the given id is in
  // a terminal state (Errored / Terminated / Complete / Paused) — and the
  // production Cloudflare Workflows runtime explicitly throws on duplicate
  // ids (`If a provided id exists, an error will be thrown`). Both failure
  // modes disappear if every schedule attempt uses a fresh UUID. The pool
  // row still persists the live instance id in `workflow_run_id` so
  // honest-status return paths (LOSER branches, /pool/retry responses) can
  // surface it to clients without coupling pool identity to workflow
  // identity. See debug session `battle-pool-requeue-silent`.
  const workflowRunId = crypto.randomUUID();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  // Use raw SQL with INSERT OR IGNORE — Drizzle's onConflictDoNothing
  // requires a conflict target, and we want the global UNIQUE on (topic)
  // to handle the race. affected_rows lets us detect who won.
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO battle_pool_topics
         (id, topic, status, workflow_run_id, created_at, updated_at)
       VALUES (?, ?, 'generating', ?, ?, ?)`,
    )
    .bind(poolTopicId, normalized, workflowRunId, nowSec, nowSec)
    .run();

  // Fall back: SELECT by topic to read the canonical row. Covers both the
  // "we inserted" case (row exists under poolTopicId) and the race loser
  // case (row exists under someone else's id).
  //
  // Projects `status`, `workflow_started_at`, and `updated_at` so the LOSER
  // branch can distinguish an actively-generating row from a gravestone
  // left by a previously failed / silently-dropped workflow.
  //
  // Unit notes (WARN-5 footgun):
  //   `workflow_started_at` is unix MILLISECONDS (raw Date.now()).
  //   `updated_at` is unix SECONDS (drizzle mode: "timestamp").
  // See schema comment on battlePoolTopics.workflowStartedAt.
  const canonical = await env.DB
    .prepare(
      `SELECT id, status, workflow_run_id, workflow_started_at, updated_at
         FROM battle_pool_topics
        WHERE topic = ?`,
    )
    .bind(normalized)
    .first<{
      id: string;
      status: "generating" | "ready" | "failed";
      workflow_run_id: string | null;
      workflow_started_at: number | null;
      updated_at: number;
    }>();

  if (!canonical) {
    // Extremely unlikely — insert succeeded but SELECT returned nothing.
    console.error(
      `[findOrQueueTopic] inconsistent state for topic "${normalized}" — INSERT succeeded but SELECT returned null`,
    );
    throw new Error(
      `findOrQueueTopic: inconsistent state for topic "${normalized}"`,
    );
  }

  const canonicalId = canonical.id;
  const canonicalStatus = canonical.status;
  const canonicalWorkflowId = canonical.workflow_run_id ?? canonicalId;

  // WR-04: race-winner detection via id equality. If the canonical row id
  // matches the UUID we attempted to INSERT, we won and own the workflow
  // scheduling duty. Otherwise someone else raced ahead under a different
  // UUID — don't schedule a duplicate. This replaces a brittle inspection
  // of `insertResult.meta.*` counters, which historically drifted between
  // Cloudflare D1 runtime versions.
  if (canonicalId === poolTopicId) {
    // WINNER — schedule the workflow. Instance id = fresh workflowRunId
    // (already persisted in battle_pool_topics.workflow_run_id by the
    // INSERT above), NOT canonicalId. See debug session
    // `battle-pool-requeue-silent` for the collision that motivated this.
    await env.BATTLE_QUESTION_WORKFLOW.create({
      id: workflowRunId,
      params: {
        topic: normalized,
        poolTopicId: canonicalId,
        topicEmbedding,
      },
    });
    return {
      status: "miss",
      poolTopicId: canonicalId,
      workflowRunId,
    };
  }

  // LOSER — someone else's row was returned. Decide whether the canonical
  // row is a gravestone (failed / silently-dropped generating) that must
  // be re-queued, a ready pool we should hit, or a legitimately-in-flight
  // workflow we must not disturb.

  // (d) canonical row is ready → the pool is usable. Reachable when the
  // vector upsert lagged or was skipped, but D1 says the questions are
  // persisted.
  if (canonicalStatus === "ready") {
    try {
      const sampled = await sampleQuestions(
        env,
        canonicalId,
        count,
        reserveCount,
        options.seed ?? canonicalId,
      );
      return {
        status: "hit",
        poolTopicId: canonicalId,
        questions: sampled.questions,
        reservedQuestions: sampled.reservedQuestions,
      };
    } catch (err) {
      // sampleQuestions throws if the pool has fewer rows than needed.
      // Fall through to re-queue — treat as a gravestone.
      console.warn(
        `[findOrQueueTopic] canonical status=ready but sampleQuestions threw (${String(err)}) — falling through to re-queue`,
      );
    }
  }

  // (b) canonical row is a gravestone OR (c) actively-generating.
  //
  // Gravestone rules:
  //   - status='failed' → always re-queueable (no TTL check needed).
  //   - status='generating' AND workflow_started_at IS NOT NULL AND
  //     workflow_started_at < (now - POOL_GENERATING_STALENESS_MS)
  //     → silently-dropped workflow; re-queueable.
  //   - status='generating' AND workflow_started_at IS NULL AND
  //     updated_at < (now - POOL_GENERATING_STALENESS_MS) seconds
  //     → workflow never ran Step 0 in over 60s; silently-dropped at
  //     scheduling layer; re-queueable. Falls back to updated_at so a
  //     freshly-INSERTed row (just now, null started_at) is NOT treated
  //     as stale by concurrent MISS callers — preserves T-04-10
  //     race-dedup contract.
  //
  // Active-generating (NOT a gravestone, preserve existing LOSER behavior):
  //   - status='generating' AND workflow_started_at IS NOT NULL AND fresh
  //   - status='generating' AND workflow_started_at IS NULL AND updated_at fresh
  //
  // The re-queue itself is a compare-and-swap expressed in the UPDATE's
  // WHERE clause. D1's meta.changes tells us whether we won. If we lost
  // (two retry attempts racing), we re-read the row and return the current
  // actual status honestly.
  const staleCutoffMs = nowMs - POOL_GENERATING_STALENESS_MS;
  const staleCutoffSec = nowSec - Math.floor(POOL_GENERATING_STALENESS_MS / 1000);
  const startedAt = canonical.workflow_started_at;
  const updatedAtSec = canonical.updated_at;

  const isGravestone =
    canonicalStatus === "failed" ||
    (canonicalStatus === "generating" &&
      ((startedAt !== null && startedAt < staleCutoffMs) ||
        (startedAt === null && updatedAtSec < staleCutoffSec)));

  if (isGravestone) {
    // Fresh Workflows instance id per re-queue attempt — see debug session
    // `battle-pool-requeue-silent`. The CAS UPDATE persists it so the live
    // run is discoverable from the pool row.
    const reQueueRunId = crypto.randomUUID();
    const cas = await env.DB
      .prepare(
        `UPDATE battle_pool_topics
            SET status = 'generating',
                workflow_run_id = ?,
                workflow_started_at = NULL,
                updated_at = ?
          WHERE id = ?
            AND (
              status = 'failed'
              OR (
                status = 'generating'
                AND (
                  (workflow_started_at IS NOT NULL AND workflow_started_at < ?)
                  OR (workflow_started_at IS NULL AND updated_at < ?)
                )
              )
            )`,
      )
      .bind(reQueueRunId, nowSec, canonicalId, staleCutoffMs, staleCutoffSec)
      .run();
    const changes = (cas as { meta?: { changes?: number } }).meta?.changes ?? 0;

    if (changes > 0) {
      // We won the CAS — we own the fresh workflow schedule. Pass the
      // fresh runId (NOT canonicalId) as the Workflows instance id to
      // avoid the terminal-state collision that made the previous run
      // silently no-op in miniflare.
      await env.BATTLE_QUESTION_WORKFLOW.create({
        id: reQueueRunId,
        params: {
          topic: normalized,
          poolTopicId: canonicalId,
          topicEmbedding,
        },
      });
      return {
        status: "miss",
        poolTopicId: canonicalId,
        workflowRunId: reQueueRunId,
      };
    }

    // CAS lost — someone else beat us to the re-queue. Re-read the row
    // and return the current actual status honestly.
    const recheck = await env.DB
      .prepare(
        `SELECT status, workflow_run_id FROM battle_pool_topics WHERE id = ?`,
      )
      .bind(canonicalId)
      .first<{ status: string; workflow_run_id: string | null }>();
    const recheckedRunId = recheck?.workflow_run_id ?? canonicalId;
    if (recheck?.status === "ready") {
      // Unlikely but handle gracefully — the other racer already finished.
      try {
        const sampled = await sampleQuestions(
          env,
          canonicalId,
          count,
          reserveCount,
          options.seed ?? canonicalId,
        );
        return {
          status: "hit",
          poolTopicId: canonicalId,
          questions: sampled.questions,
          reservedQuestions: sampled.reservedQuestions,
        };
      } catch {
        // fall through to generating
      }
    }
    return {
      status: "generating",
      poolTopicId: canonicalId,
      workflowRunId: recheckedRunId,
    };
  }

  // (c) actively-generating — someone else's workflow is in flight. Don't
  // schedule a duplicate. Preserves T-04-10 race-dedup contract exercised
  // by tests/battle/battle.pool.race.test.ts.
  return {
    status: "generating",
    poolTopicId: canonicalId,
    workflowRunId: canonicalWorkflowId,
  };
}
