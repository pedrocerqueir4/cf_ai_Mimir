/**
 * SEC-04 SSRF Prevention — Outbound Fetch Allowlist
 *
 * Phase 1 SSRF boundary: The server ONLY makes outbound fetch() calls to:
 * 1. Cloudflare Turnstile siteverify endpoint (verifyTurnstileToken)
 * 2. OAuth provider endpoints (handled internally by Better Auth — not user-controllable)
 *
 * NO dynamic URL construction from user input exists in server-side fetch calls.
 * All outbound URLs are hardcoded constants.
 *
 * When adding new outbound fetch targets in future phases, add them to
 * ALLOWED_FETCH_ORIGINS below and document why they are needed.
 */

export const ALLOWED_FETCH_ORIGINS = [
  "https://challenges.cloudflare.com", // Turnstile siteverify
  "https://accounts.google.com", // Google OAuth (Better Auth internal)
  "https://oauth2.googleapis.com", // Google OAuth token exchange
  "https://github.com", // GitHub OAuth (Better Auth internal)
  "https://api.github.com", // GitHub OAuth user info
] as const;

/**
 * Assert a URL is in the allowlist before fetching. Use this wrapper around
 * any NEW outbound fetch() added in future phases.
 *
 * Not needed for Better Auth OAuth (handled internally) or Turnstile
 * (hardcoded URL), but available as a guardrail for future development.
 */
export function assertAllowedFetchTarget(url: string): void {
  const parsed = new URL(url);
  const isAllowed = ALLOWED_FETCH_ORIGINS.some(
    (origin) =>
      parsed.origin === origin || parsed.origin === new URL(origin).origin
  );
  if (!isAllowed) {
    throw new Error(
      `SSRF blocked: fetch to ${parsed.origin} is not in the allowlist`
    );
  }
}
