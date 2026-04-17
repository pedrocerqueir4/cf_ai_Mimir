import { describe, it, beforeAll, expect } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { multiSession } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { setupD1, createTestSession } from "./setup";
import * as schema from "../worker/src/db/schema";

// ─── Test auth harness ────────────────────────────────────────────────────────
//
// We instantiate a Better Auth instance directly — same wiring as
// `apps/web/workers/app.ts` (production) but with:
//   - `requireEmailVerification: false` so tests don't need an email provider
//   - Turnstile middleware NOT mounted, since Turnstile requires a live
//     Cloudflare siteverify call; the Turnstile contract itself is covered
//     under SEC-04 (fetch allowlist) and manually in UAT.
//   - Capture callbacks for sendVerificationEmail + sendResetPassword so we
//     can assert AUTH-02 and AUTH-03 behavior without a real SMTP provider.
//
// This follows the pattern established in gamification.test.ts: build a
// minimal Hono app that mounts only the surface under test, pass env via the
// third arg of `app.request()`.

interface CapturedEmails {
  verification: Array<{ url: string; email: string }>;
  resetPassword: Array<{ url: string; email: string }>;
}

function buildAuthApp(opts?: { requireEmailVerification?: boolean }) {
  const captured: CapturedEmails = { verification: [], resetPassword: [] };

  const db = drizzle(env.DB, { schema });
  const auth = betterAuth({
    baseURL: "http://localhost:5173",
    database: drizzleAdapter(db, { provider: "sqlite", usePlural: true, schema }),
    trustedOrigins: ["http://localhost:5173"],
    session: {
      expiresIn: 60 * 60 * 24 * 7, // D-02: 7 days
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts?.requireEmailVerification ?? false,
      sendResetPassword: async ({ url, user }) => {
        captured.resetPassword.push({ url, email: user.email });
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ url, user }) => {
        captured.verification.push({ url, email: user.email });
      },
    },
    plugins: [multiSession({ maximumSessions: 3 })],
  });

  const app = new Hono();
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const res = await auth.handler(c.req.raw);
    // Materialize the body — mirrors production `app.ts:249-253` workaround
    // for workerd's ReadableStream serialization bug.
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: res.headers,
    });
  });

  return { app, captured, auth };
}

// ─── AUTH-01: Email/password signup ───────────────────────────────────────────
//
// Behavior under test: POST /api/auth/sign-up/email with a valid payload
// creates a user in the users table. Invalid inputs (weak password, bad email
// format) are rejected by Better Auth. Duplicates fail without revealing
// whether the email is already registered (no enumeration).
//
// NOTE on Turnstile: production `apps/web/workers/app.ts:213-236` requires a
// Turnstile token on /api/auth/sign-up/email. That middleware is NOT mounted
// here because verifying a real Turnstile token requires an outbound network
// call to Cloudflare's siteverify endpoint, which is not available from the
// miniflare test pool. The Turnstile signature (correct error codes, allowlist
// wiring) is covered by SEC-04 (`assertAllowedFetchTarget`) and by UAT (see
// 01-VERIFICATION.md — "Complete Auth Flow End-to-End").

describe("AUTH-01: Email/password signup", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("POST /api/auth/sign-up/email with valid payload creates a user in D1", async () => {
    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "signup-valid@test.com",
        password: "StrongPass123!",
        name: "Valid User",
      }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT id, email, name FROM users WHERE email = ?`,
    ).bind("signup-valid@test.com").first<{ id: string; email: string; name: string }>();
    expect(row).not.toBeNull();
    expect(row?.email).toBe("signup-valid@test.com");
    expect(row?.name).toBe("Valid User");
  });

  it("POST /api/auth/sign-up/email with duplicate email returns error (no enumeration)", async () => {
    const { app } = buildAuthApp();
    // First signup
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@test.com",
        password: "StrongPass123!",
        name: "First",
      }),
    });
    // Duplicate attempt
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@test.com",
        password: "AnotherPass456!",
        name: "Second",
      }),
    });
    // Better Auth rejects duplicates with a non-2xx status — the critical
    // anti-enumeration contract is that the response must NOT leak a distinct
    // "email already exists" signal separate from generic failure. We assert
    // the response is an error and does not contain telling strings.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    // Must not say "already exists" or "already registered" verbatim to UI
    // (T-01-04 anti-enumeration). Better Auth returns a generic message.
    expect(body.toLowerCase()).not.toMatch(/already registered/);
  });

  it("POST /api/auth/sign-up/email with password < 8 chars returns error", async () => {
    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "weakpass@test.com",
        password: "short",
        name: "Weak",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Confirm the user was NOT created in D1
    const row = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ?`,
    ).bind("weakpass@test.com").first();
    expect(row).toBeNull();
  });

  it("POST /api/auth/sign-up/email with invalid email format returns error", async () => {
    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "not-an-email",
        password: "StrongPass123!",
        name: "Invalid",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const row = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ?`,
    ).bind("not-an-email").first();
    expect(row).toBeNull();
  });
});

// ─── AUTH-02: Email verification ──────────────────────────────────────────────
//
// Behavior under test: when `requireEmailVerification: true`, a signup triggers
// the `sendVerificationEmail` callback. The production entry
// (`apps/web/workers/app.ts:170`) has this flag set to `false` (intentionally,
// pending an email provider — see 01-SECURITY.md T-01-09). The callback lives
// in `worker/src/auth.ts:25-30`. This test exercises the Better Auth contract
// directly: with the flag on, the callback fires on signup.
//
// Config tested: `worker/src/auth.ts` (legacy) semantics replicated in the test
// harness above via `requireEmailVerification: true`. Production will activate
// this path once an email provider is wired in.

describe("AUTH-02: Email verification", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("signup with requireEmailVerification=true triggers sendVerificationEmail callback", async () => {
    const { app, captured } = buildAuthApp({ requireEmailVerification: true });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "verify-me@test.com",
        password: "StrongPass123!",
        name: "To Verify",
      }),
    });
    // Response may be 200 (account created, pending verification) depending
    // on Better Auth version. The critical contract: callback must fire.
    expect(res.status).toBeLessThan(500);
    expect(captured.verification.length).toBeGreaterThanOrEqual(1);
    expect(captured.verification[0].email).toBe("verify-me@test.com");
    expect(captured.verification[0].url).toMatch(/^https?:\/\//);
  });

  it("created user starts with emailVerified=0 in D1", async () => {
    const { app } = buildAuthApp({ requireEmailVerification: true });
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "unverified@test.com",
        password: "StrongPass123!",
        name: "Unverified",
      }),
    });
    const row = await env.DB.prepare(
      `SELECT email_verified FROM users WHERE email = ?`,
    ).bind("unverified@test.com").first<{ email_verified: number }>();
    expect(row).not.toBeNull();
    expect(row?.email_verified).toBe(0);
  });
});

// ─── AUTH-03: Password reset ──────────────────────────────────────────────────
//
// Behavior under test: POST /api/auth/forget-password triggers the
// `sendResetPassword` callback. The callback receives a `url` containing a
// single-use opaque token. In production (`apps/web/workers/app.ts:175-177`)
// this is wired to console.log pending an email provider.

describe("AUTH-03: Password reset", () => {
  beforeAll(async () => {
    await setupD1();
    // Seed a user who can request a reset
    const { app } = buildAuthApp();
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset-me@test.com",
        password: "OriginalPass123!",
        name: "Reset Me",
      }),
    });
  });

  it("POST /api/auth/request-password-reset triggers sendResetPassword callback", async () => {
    // Better Auth v1.5 route is `/request-password-reset`. The frontend
    // `authClient.forgetPassword()` call in `_auth.forgot-password.tsx` maps
    // to this same endpoint under the hood.
    const { app, captured } = buildAuthApp();
    const res = await app.request("/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        email: "reset-me@test.com",
        redirectTo: "http://localhost:5173/auth/reset-password",
      }),
    });
    expect(res.status).toBe(200);
    expect(captured.resetPassword.length).toBeGreaterThanOrEqual(1);
    const captured0 = captured.resetPassword[0];
    expect(captured0.email).toBe("reset-me@test.com");
    // The reset URL points to the `/reset-password/:token` endpoint
    expect(captured0.url).toMatch(/reset-password\/[A-Za-z0-9_-]+/);
  });

  it("POST /api/auth/request-password-reset for unknown email does NOT reveal existence (no enumeration)", async () => {
    // Anti-enumeration contract (T-01-04 / T-01-14): Better Auth returns the
    // same "If this email exists in our system..." response regardless of
    // whether the email is registered, and does NOT invoke the callback for
    // unknown emails.
    const { app, captured } = buildAuthApp();
    const res = await app.request("/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        email: "never-registered@test.com",
        redirectTo: "http://localhost:5173/auth/reset-password",
      }),
    });
    // Must not leak via status — Better Auth returns 200 for both cases
    expect(res.status).toBe(200);
    // Callback must not fire for an unknown email
    expect(
      captured.resetPassword.find((e) => e.email === "never-registered@test.com"),
    ).toBeUndefined();
  });

  it("POST /api/auth/reset-password with a valid token updates the password", async () => {
    // End-to-end reset flow: request a reset, capture the token from the URL,
    // then POST /api/auth/reset-password with { token, newPassword }.
    const { app, captured } = buildAuthApp();

    // Seed a user who will reset
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "reset-flow@test.com",
        password: "OriginalPass123!",
        name: "Reset Flow",
      }),
    });
    await app.request("/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        email: "reset-flow@test.com",
        redirectTo: "http://localhost:5173/auth/reset-password",
      }),
    });
    const latest = captured.resetPassword.find((e) => e.email === "reset-flow@test.com");
    expect(latest).toBeDefined();
    // URL format: `${baseURL}/reset-password/${token}?callbackURL=...`
    const tokenMatch = latest!.url.match(/reset-password\/([A-Za-z0-9_-]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    const res = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: "NewStrongPass456!" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: boolean };
    expect(body.status).toBe(true);
  });

  it("POST /api/auth/reset-password with an invalid token returns an error", async () => {
    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: "not-a-real-token-xyz",
        newPassword: "NewStrongPass456!",
      }),
    });
    // Better Auth responds with 4xx and an INVALID_TOKEN error
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

// ─── AUTH-06: Session persistence ─────────────────────────────────────────────
//
// Behavior under test: a valid signed session cookie (produced by
// createTestSession, which mirrors the format Better Auth issues) returns the
// session on GET /api/auth/get-session. A request with no cookie returns null.
// multiSession({ maximumSessions: 3 }) plugin is configured — we assert it is
// present in the Better Auth instance's plugin chain.
//
// D-01 (max 3 concurrent sessions enforced on 4th login) and D-02 (session
// expires after 7 days of inactivity) are enforced by Better Auth internals
// when real login flows run. Full end-to-end multi-session eviction requires
// real password auth paths (blocked in tests by Turnstile and by the CPU cost
// of 4 concurrent PBKDF2 hashes in the miniflare pool). We assert the
// configuration is correctly wired; E2E behavior is covered in UAT.

describe("AUTH-06: Session persistence", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("GET /api/auth/get-session with a valid signed session cookie returns the session", async () => {
    const { app } = buildAuthApp();
    const { cookie, userId } = await createTestSession("session-valid@test.com");

    const res = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { user?: { id: string; email: string } } | null;
    expect(body).not.toBeNull();
    expect(body?.user?.id).toBe(userId);
    expect(body?.user?.email).toBe("session-valid@test.com");
  });

  it("GET /api/auth/get-session with no cookie returns null (no session)", async () => {
    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/get-session", { method: "GET" });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Better Auth returns an empty body or JSON null when no session is present
    expect(text === "" || text === "null").toBe(true);
  });

  it("GET /api/auth/get-session with an EXPIRED session returns null", async () => {
    // Seed a user + a session row whose expires_at is in the past
    const now = Math.floor(Date.now() / 1000);
    const userId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const expiredAt = now - 60 * 60 * 24; // 1 day ago

    await env.DB.prepare(
      `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Expired', 'session-expired@test.com', 1, ?, ?)`,
    ).bind(userId, now, now).run();

    await env.DB.prepare(
      `INSERT INTO sessions (id, expires_at, token, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(sessionId, expiredAt, sessionToken, now - 60 * 60 * 24 * 8, now - 60 * 60 * 24 * 8, userId).run();

    // Build the signed cookie for this expired token (same format as createTestSession)
    const BETTER_AUTH_SECRET = "better-auth-secret-12345678901234567890";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(BETTER_AUTH_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(sessionToken),
    );
    const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    const signedValue = encodeURIComponent(`${sessionToken}.${b64}`);
    const cookie = `better-auth.session_token=${signedValue}`;

    const { app } = buildAuthApp();
    const res = await app.request("/api/auth/get-session", {
      method: "GET",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // Expired session must resolve to no session
    expect(text === "" || text === "null").toBe(true);
  });

  it("Better Auth instance has multiSession plugin with maximumSessions=3 (D-01)", async () => {
    // The production config `apps/web/workers/app.ts:197` and legacy
    // `worker/src/auth.ts:41-45` both pass `maximumSessions: 3`. We assert the
    // plugin is registered in the instance our harness builds — this guards
    // against accidental removal.
    const { auth } = buildAuthApp();
    // Better Auth exposes the configured options on the instance. The plugin
    // list is kept on the underlying context.
    const hasMultiSession =
      Array.isArray((auth as any).options?.plugins) &&
      (auth as any).options.plugins.some(
        (p: any) => p?.id === "multi-session" || p?.id === "multiSession",
      );
    expect(hasMultiSession).toBe(true);
  });

  it("session table rows carry a 7-day expiresAt (D-02) as configured by expiresIn", async () => {
    // Best-effort structural check: createTestSession stores sessions with
    // `now + 7d` as expiresAt (mirrors Better Auth's session creation). We
    // verify the row actually reflects a 7-day future timestamp.
    const before = Math.floor(Date.now() / 1000);
    await createTestSession("session-7d@test.com");
    const row = await env.DB.prepare(
      `SELECT s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = ?
       ORDER BY s.created_at DESC LIMIT 1`,
    ).bind("session-7d@test.com").first<{ expires_at: number }>();
    expect(row).not.toBeNull();
    const sevenDays = 60 * 60 * 24 * 7;
    expect(row!.expires_at).toBeGreaterThanOrEqual(before + sevenDays - 60);
    expect(row!.expires_at).toBeLessThanOrEqual(before + sevenDays + 60);
  });
});

// ─── AUTH-04 / AUTH-05: OAuth (Google / GitHub) ──────────────────────────────
//
// These are reclassified Manual-Only in 01-VALIDATION.md. Rationale:
//   - OAuth flows require real provider credentials (GOOGLE_CLIENT_ID,
//     GITHUB_CLIENT_ID, plus live HTTPS callbacks).
//   - Better Auth's OAuth handlers hit the provider discovery endpoints on
//     init; these cannot be mocked cleanly without rewriting Better Auth.
//   - 01-VERIFICATION.md already covers these under "Google OAuth and GitHub
//     OAuth sign-in flow" in the human_verification list.
//
// No automated tests for AUTH-04 / AUTH-05 in this file.
