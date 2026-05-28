/**
 * ai-errors.ts — Single source of truth for Cloudflare Workers AI error
 * classification and the verbatim quota-exhaustion user message.
 *
 * Lives in lib/ (not services/ or middleware/) because it is a pure
 * data-classification utility with no I/O side effects. Both the chat SSE
 * route and the ContentGenerationWorkflow import from here to avoid
 * duplicating the heuristic logic or the verbatim message copy.
 */

// ─── Verbatim copy ────────────────────────────────────────────────────────────

/**
 * Single source of truth for the quota-exhaustion message shown in chat.
 * Import this constant at every call site — never repeat the string inline.
 * The `as const` assertion gives callers the literal type, not just `string`.
 */
export const QUOTA_EXHAUSTED_MESSAGE =
  "Daily AI quota reached — Cloudflare Workers AI free tier (10,000 neurons/day). Resets at 00:00 UTC. Try again later or upgrade the Workers Paid plan." as const;

// ─── Error class union ────────────────────────────────────────────────────────

export type AIErrorClass =
  | "quota_exhausted"
  | "timeout"
  | "model_error"
  | "unknown";

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify an unknown value thrown by `env.AI.run()` into one of the four
 * AIErrorClass variants. The caller is responsible for choosing the right
 * response for each variant — this function only identifies the class.
 *
 * Match order (most-specific first):
 *   1. quota_exhausted — HTTP 429 or /rate limit|quota|neurons|10000|daily/i
 *   2. timeout         — /timeout|timed out|aborted/i
 *   3. model_error     — name === "AiError" OR /model.+(failed|error)/i
 *   4. unknown         — anything else
 */
export function classifyAIError(err: unknown): AIErrorClass {
  // Defensively extract fields — the error may be a plain object, a native
  // Error instance, an AiError class (name: "AiError"), or a Response-shaped
  // object with a numeric `status`/`statusCode` field.
  let status: number | undefined;
  let code: string | number | undefined;
  let name: string | undefined;
  let message: string | undefined;

  if (err !== null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    // Cloudflare AI binding's thrown error shape is not officially documented;
    // .status (HTTP-style) and .statusCode (Node-style) are both observed in
    // the wild, so check both. See docs research 2026-05-27.
    if (typeof e.status === "number") status = e.status;
    else if (typeof e.statusCode === "number") status = e.statusCode;
    if (typeof e.code !== "undefined") code = e.code as string | number;
    if (typeof e.name === "string") name = e.name;
    if (typeof e.message === "string") message = e.message;
  } else if (typeof err === "string") {
    message = err;
  }

  // ── Quota exhaustion ──────────────────────────────────────────────────────
  //
  // Asserted shape A (Cloudflare Workers AI, confirmed via docs 2026-05-27):
  //   HTTP 429 — runtime surfaces this as an object where `.status === 429`
  //   (or `.statusCode === 429`) when env.AI.run() is called and the daily
  //   neuron budget is exhausted. Error code is `3036` (primary, per docs) or
  //   `4006` (community-reported newer variant). Canonical message:
  //   "You have used up your daily free allocation of 10,000 neurons.
  //    Please upgrade to Cloudflare's Workers Paid plan..."
  //
  // Asserted shape B (defensive heuristic — used when shape A doesn't match):
  //   any error where status === 429 OR code matches 3036/4006/429 OR message
  //   matches the regex below. Covers future Workers AI error shape changes
  //   and test stubs that throw plain Error("Rate limit: 10000 neurons quota
  //   exhausted for today").
  const codeStr = code !== undefined ? String(code) : "";
  if (
    status === 429 ||
    codeStr === "429" ||
    codeStr === "3036" ||
    codeStr === "4006" ||
    /rate limit|quota|neurons|10000|daily|allocation/i.test(message ?? "")
  ) {
    return "quota_exhausted";
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (/timeout|timed out|aborted/i.test(message ?? "")) {
    return "timeout";
  }

  // ── Model error ───────────────────────────────────────────────────────────
  if (name === "AiError" || /model.+(failed|error)/i.test(message ?? "")) {
    return "model_error";
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  return "unknown";
}
