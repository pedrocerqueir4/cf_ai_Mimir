import { it, expect, describe } from "vitest";
import { env } from "cloudflare:workers";
import { createAuth } from "../worker/src/auth";

// Regression guard for the local-dev 401 bug (debug session
// chat-broken-couldnt-get-response, 2026-05-28).
//
// Root cause: createAuth() hardcoded `baseURL: env.PUBLIC_URL`
// (https://...workers.dev). The login handler in apps/web/workers/app.ts
// uses the REQUEST origin instead. In local dev the request origin is
// http://localhost:5173, so the login set a plain `better-auth.session_token`
// cookie, but the https-baseURL validator looked for a `__Secure-`-prefixed
// cookie, found nothing, and returned 401 on every authenticated API call.
//
// The fix makes createAuth derive baseURL from the request origin (matching the
// login handler) with PUBLIC_URL as fallback. These tests lock that invariant:
// the validator's baseURL MUST track the request origin, NOT the static
// PUBLIC_URL, so the cookie name agrees between issuer and validator.
describe("createAuth baseURL derivation (401 regression guard)", () => {
  it("uses the request origin as baseURL — http localhost (dev)", () => {
    const auth: any = createAuth(env as any, "http://localhost:5173/api/chat/message");
    expect(auth.options?.baseURL).toBe("http://localhost:5173");
  });

  it("uses the request origin as baseURL — https prod", () => {
    const auth: any = createAuth(env as any, "https://mimir.pedrocerqueira137.workers.dev/api/chat/message");
    expect(auth.options?.baseURL).toBe("https://mimir.pedrocerqueira137.workers.dev");
  });

  it("does NOT pin baseURL to the static https PUBLIC_URL when a dev request is in scope", () => {
    // This is the exact failure: PUBLIC_URL is https, request is http localhost.
    // baseURL must follow the request (http) so the plain cookie validates.
    const auth: any = createAuth(env as any, "http://localhost:5173/api/x");
    expect(auth.options?.baseURL).not.toContain("https://");
    expect(auth.options?.baseURL).toBe("http://localhost:5173");
  });

  it("falls back to PUBLIC_URL when no request URL is provided", () => {
    const auth: any = createAuth(env as any);
    // env.PUBLIC_URL is the configured fallback; just assert it's defined and
    // equals the configured value rather than crashing.
    expect(auth.options?.baseURL).toBe((env as any).PUBLIC_URL);
  });
});
