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
  // object with a numeric `status` field.
  let status: number | undefined;
  let code: string | number | undefined;
  let name: string | undefined;
  let message: string | undefined;

  if (err !== null && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.status === "number") status = e.status;
    if (typeof e.code !== "undefined") code = e.code as string | number;
    if (typeof e.name === "string") name = e.name;
    if (typeof e.message === "string") message = e.message;
  } else if (typeof err === "string") {
    message = err;
  }

  // ── Quota exhaustion ──────────────────────────────────────────────────────
  //
  // Asserted shape A (Cloudflare Workers AI, confirmed via docs 2026-05-27 +
  // Cloudflare error reference https://developers.cloudflare.com/workers-ai/platform/errors/):
  //   HTTP 429 — the runtime surfaces this as an object where `.status === 429`
  //   when env.AI.run() is called and the daily neuron budget is exhausted.
  //   The error name may be "AiError" and the message typically includes the
  //   string "neurons" or a mention of the daily quota.
  //
  // Asserted shape B (defensive heuristic — used when shape A doesn't match):
  //   any error where status === 429 OR
  //   /rate limit|quota|neurons|10000|daily/i.test(message ?? "")
  //   This covers future Workers AI error shape changes and test stubs that
  //   throw plain Error("Rate limit: 10000 neurons quota exhausted for today").
  if (
    status === 429 ||
    (code !== undefined && String(code) === "429") ||
    /rate limit|quota|neurons|10000|daily/i.test(message ?? "")
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
