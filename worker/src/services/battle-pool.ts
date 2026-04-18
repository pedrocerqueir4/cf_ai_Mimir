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

// ─── Vectorize helpers ───────────────────────────────────────────────────────

async function embedTopic(env: Env, normalized: string): Promise<number[]> {
  const resp = (await (env.AI.run as any)(EMBEDDING_MODEL, {
    text: [normalized],
  })) as { data: number[][] };
  const embedding = resp?.data?.[0];
  if (!embedding || embedding.length === 0) {
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
  const count = options.count ?? 5;
  const reserveCount = options.reserveCount ?? 5;

  // Normalize + safety check (T-04-09).
  const normalized = normalizeTopic(rawTopic);
  assertTopicSafe(normalized);

  // Embed topic.
  const topicEmbedding = await embedTopic(env, normalized);

  // Vectorize lookup in the battle-topics namespace.
  const queryResult = (await (env.VECTORIZE as any).query(topicEmbedding, {
    topK: 1,
    returnMetadata: "all",
    namespace: BATTLE_TOPICS_NAMESPACE,
  })) as {
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
  }

  // MISS path — attempt to INSERT a new pool topic row, raced against
  // concurrent callers for the same normalized topic.
  const poolTopicId = crypto.randomUUID();
  const now = new Date();

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

  // Fall back: SELECT by topic to read the canonical row. Covers both the
  // "we inserted" case (row exists under poolTopicId) and the race loser
  // case (row exists under someone else's id).
  const canonical = await env.DB
    .prepare(
      `SELECT id, workflow_run_id FROM battle_pool_topics WHERE topic = ?`,
    )
    .bind(normalized)
    .first<{ id: string; workflow_run_id: string | null }>();

  if (!canonical) {
    // Extremely unlikely — insert succeeded but SELECT returned nothing.
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
    await env.BATTLE_QUESTION_WORKFLOW.create({
      id: canonicalId,
      params: {
        topic: normalized,
        poolTopicId: canonicalId,
        topicEmbedding,
      },
    });
    return {
      status: "miss",
      poolTopicId: canonicalId,
      workflowRunId: canonicalId,
    };
  }

  // LOSER — someone else's row was returned. Don't schedule a duplicate
  // workflow. The caller can poll pool_topics.status for readiness.
  return {
    status: "generating",
    poolTopicId: canonicalId,
    workflowRunId: canonicalWorkflowId,
  };
}
