import { assertAllowedFetchTarget } from "./fetch-allowlist";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const FAILURE_THRESHOLD = 5;

// In-memory failure counter per IP.
// In production, this resets on Worker restart (which is acceptable for a
// brute-force mitigation — the rate limiter is the primary defense).
// For persistent tracking, use D1 or KV in a future iteration.
const failureCounts = new Map<string, { count: number; lastAttempt: number }>();

// Clean up old entries every 10 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const ENTRY_TTL_MS = 60 * 60 * 1000; // 1 hour

function cleanupOldEntries() {
  const now = Date.now();
  for (const [key, entry] of failureCounts) {
    if (now - entry.lastAttempt > ENTRY_TTL_MS) {
      failureCounts.delete(key);
    }
  }
}

// Schedule cleanup (runs in Worker context)
let lastCleanup = Date.now();

export function recordLoginFailure(ip: string): void {
  const existing = failureCounts.get(ip);
  failureCounts.set(ip, {
    count: (existing?.count ?? 0) + 1,
    lastAttempt: Date.now(),
  });

  // Periodic cleanup
  if (Date.now() - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanupOldEntries();
    lastCleanup = Date.now();
  }
}

export function resetLoginFailures(ip: string): void {
  failureCounts.delete(ip);
}

export function getFailureCount(ip: string): number {
  const entry = failureCounts.get(ip);
  if (!entry) return 0;
  // Expire entries older than 1 hour
  if (Date.now() - entry.lastAttempt > ENTRY_TTL_MS) {
    failureCounts.delete(ip);
    return 0;
  }
  return entry.count;
}

export function requiresTurnstile(ip: string): boolean {
  return getFailureCount(ip) >= FAILURE_THRESHOLD;
}

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  ip: string
): Promise<boolean> {
  // SEC-04: Only fetches hardcoded Turnstile endpoint
  assertAllowedFetchTarget(TURNSTILE_VERIFY_URL);

  const resp = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: secretKey,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await resp.json<{ success: boolean }>();
  return data.success;
}

/**
 * Middleware for sign-in endpoint: after 5 failed attempts from an IP,
 * require a valid Turnstile token in the `cf-turnstile-response` header.
 * Returns 403 if Turnstile is required but token is missing or invalid.
 *
 * Wire this BEFORE the Better Auth sign-in handler on the sign-in route.
 *
 * D-05: After 5 failed login attempts, server requires Turnstile CAPTCHA token.
 */
export async function requireTurnstileAfterFailures(
  c: any,
  next: () => Promise<void>
): Promise<Response | void> {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";

  if (requiresTurnstile(ip)) {
    const turnstileToken = c.req.header("cf-turnstile-response");
    if (!turnstileToken) {
      return c.json(
        { error: "CAPTCHA required", turnstileRequired: true },
        403
      );
    }

    const valid = await verifyTurnstileToken(
      turnstileToken,
      c.env.TURNSTILE_SECRET_KEY,
      ip
    );

    if (!valid) {
      return c.json(
        { error: "CAPTCHA verification failed", turnstileRequired: true },
        403
      );
    }
  }

  await next();
}
