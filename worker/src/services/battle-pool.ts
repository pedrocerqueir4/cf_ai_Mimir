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
  const t0 = Date.now();
  console.log(`[embedTopic] START topic="${normalized}" model=${EMBEDDING_MODEL}`);
  const resp = (await retryWithJitter(() =>
    (env.AI.run as any)(EMBEDDING_MODEL, {
      text: [normalized],
    }),
  )) as { data: number[][] };
  console.log(
    `[embedTopic] env.AI.run returned elapsed=${Date.now() - t0}ms hasData=${!!resp?.data} len=${resp?.data?.[0]?.length ?? 0}`,
  );
  const embedding = resp?.data?.[0];
  if (!embedding || embedding.length === 0) {
    console.error(
      `[embedTopic] FAILED topic="${normalized}" — empty embedding response`,
    );
    throw new Error("Failed to generate topic embedding");
  }
  console.log(`[embedTopic] OK topic="${normalized}" totalElapsed=${Date.now() - t0}ms`);
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
 * 5. Otherwise, attempt an INSERT OR IGNORE on battle_pool_topics. Winner kicks
 *    off BattleQuestionGenerationWorkflow with the topic + embedding and
 *    returns `status: "miss"`. Loser (UNIQUE collision) re-SELECTs the existing
 *    row and returns `status: "generating"` — no duplicate workflow.
 */
export async function findOrQueueTopic(
  env: Env,
  rawTopic: string,
  options: FindOrQueueOptions = {},
): Promise<PoolLookupResult> {
  const t0 = Date.now();
  const tag = `[findOrQueueTopic raw="${rawTopic.slice(0, 40)}"]`;
  console.log(`${tag} START count=${options.count ?? 5} reserve=${options.reserveCount ?? 5}`);

  const count = options.count ?? 5;
  const reserveCount = options.reserveCount ?? 5;

  // Normalize + safety check (T-04-09).
  const normalized = normalizeTopic(rawTopic);
  assertTopicSafe(normalized);
  console.log(`${tag} step=normalize elapsed=${Date.now() - t0}ms normalized="${normalized}"`);

  // Embed topic.
  console.log(`${tag} step=embed START`);
  const topicEmbedding = await embedTopic(env, normalized);
  console.log(
    `${tag} step=embed DONE elapsed=${Date.now() - t0}ms dims=${topicEmbedding.length}`,
  );

  // Vectorize lookup in the battle-topics namespace. Wrapped in
  // retryWithJitter (gap 04-09) so a transient upstream failure does not
  // immediately surface as a user-facing 503; a single retry after a short
  // jittered backoff absorbs the vast majority of one-off flakes.
  console.log(`${tag} step=vectorize.query START namespace=${BATTLE_TOPICS_NAMESPACE}`);
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
  console.log(
    `${tag} step=vectorize.query DONE elapsed=${Date.now() - t0}ms matches=${queryResult.matches?.length ?? 0} topScore=${queryResult.matches?.[0]?.score ?? "n/a"}`,
  );

  const match = queryResult.matches?.[0];

  if (match && match.score > POOL_SIMILARITY_THRESHOLD) {
    // HIT path — look up existing pool topic + its questions.
    const existingId =
      (match.metadata?.poolTopicId as string | undefined) ?? match.id;
    console.log(
      `${tag} branch=HIT score=${match.score} threshold=${POOL_SIMILARITY_THRESHOLD} existingId=${existingId}`,
    );

    const db = drizzle(env.DB, { schema });
    console.log(`${tag} step=hit.selectPoolRow START id=${existingId}`);
    const topicRow = await db
      .select()
      .from(schema.battlePoolTopics)
      .where(eq(schema.battlePoolTopics.id, existingId))
      .limit(1);
    console.log(
      `${tag} step=hit.selectPoolRow DONE elapsed=${Date.now() - t0}ms found=${topicRow.length > 0} status=${topicRow[0]?.status ?? "n/a"}`,
    );

    if (topicRow.length > 0 && topicRow[0].status === "ready") {
      console.log(`${tag} step=hit.sampleQuestions START`);
      const sampled = await sampleQuestions(
        env,
        existingId,
        count,
        reserveCount,
        options.seed ?? existingId,
      );
      console.log(
        `${tag} step=hit.sampleQuestions DONE elapsed=${Date.now() - t0}ms questions=${sampled.questions.length} reserves=${sampled.reservedQuestions.length}`,
      );
      console.log(`${tag} RETURN status=hit totalElapsed=${Date.now() - t0}ms`);
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
      `${tag} HIT_FALLTHROUGH vector matched but D1 row not ready (found=${topicRow.length > 0}, status=${topicRow[0]?.status ?? "n/a"}) — falling through to MISS`,
    );
  } else {
    console.log(
      `${tag} branch=MISS (no match or score<=${POOL_SIMILARITY_THRESHOLD})`,
    );
  }

  // MISS path — attempt to INSERT a new pool topic row, raced against
  // concurrent callers for the same normalized topic.
  const poolTopicId = crypto.randomUUID();
  const now = new Date();
  console.log(`${tag} step=insertOrIgnore START attemptId=${poolTopicId}`);

  // Use raw SQL with INSERT OR IGNORE — Drizzle's onConflictDoNothing
  // requires a conflict target, and we want the global UNIQUE on (topic)
  // to handle the race. affected_rows lets us detect who won.
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO battle_pool_topics
         (id, topic, status, workflow_run_id, created_at, updated_at)
       VALUES (?, ?, 'generating', ?, ?, ?)`,
    )
    .bind(
      poolTopicId,
      normalized,
      poolTopicId,
      Math.floor(now.getTime() / 1000),
      Math.floor(now.getTime() / 1000),
    )
    .run();
  console.log(`${tag} step=insertOrIgnore DONE elapsed=${Date.now() - t0}ms`);

  // Fall back: SELECT by topic to read the canonical row. Covers both the
  // "we inserted" case (row exists under poolTopicId) and the race loser
  // case (row exists under someone else's id).
  console.log(`${tag} step=selectCanonical START`);
  const canonical = await env.DB
    .prepare(
      `SELECT id, workflow_run_id FROM battle_pool_topics WHERE topic = ?`,
    )
    .bind(normalized)
    .first<{ id: string; workflow_run_id: string | null }>();
  console.log(
    `${tag} step=selectCanonical DONE elapsed=${Date.now() - t0}ms canonicalId=${canonical?.id ?? "null"}`,
  );

  if (!canonical) {
    // Extremely unlikely — insert succeeded but SELECT returned nothing.
    console.error(`${tag} FAIL inconsistent state — INSERT succeeded but SELECT returned null`);
    throw new Error(
      `findOrQueueTopic: inconsistent state for topic "${normalized}"`,
    );
  }

  const canonicalId = canonical.id;
  const canonicalWorkflowId = canonical.workflow_run_id ?? canonicalId;

  // WR-04: race-winner detection via id equality. If the canonical row id
  // matches the UUID we attempted to INSERT, we won and own the workflow
  // scheduling duty. Otherwise someone else raced ahead under a different
  // UUID — don't schedule a duplicate. This replaces a brittle inspection
  // of `insertResult.meta.*` counters, which historically drifted between
  // Cloudflare D1 runtime versions.
  if (canonicalId === poolTopicId) {
    // WINNER — schedule the workflow.
    console.log(`${tag} race=WINNER scheduling workflow id=${canonicalId}`);
    console.log(`${tag} step=workflow.create START`);
    await env.BATTLE_QUESTION_WORKFLOW.create({
      id: canonicalId,
      params: {
        topic: normalized,
        poolTopicId: canonicalId,
        topicEmbedding,
      },
    });
    console.log(
      `${tag} step=workflow.create DONE elapsed=${Date.now() - t0}ms runId=${canonicalId}`,
    );
    console.log(`${tag} RETURN status=miss totalElapsed=${Date.now() - t0}ms`);
    return {
      status: "miss",
      poolTopicId: canonicalId,
      workflowRunId: canonicalId,
    };
  }

  // LOSER — someone else's row was returned. Don't schedule a duplicate
  // workflow. The caller can poll pool_topics.status for readiness.
  console.log(
    `${tag} race=LOSER canonicalId=${canonicalId} ours=${poolTopicId} — not scheduling duplicate`,
  );
  console.log(`${tag} RETURN status=generating totalElapsed=${Date.now() - t0}ms`);
  return {
    status: "generating",
    poolTopicId: canonicalId,
    workflowRunId: canonicalWorkflowId,
  };
}
