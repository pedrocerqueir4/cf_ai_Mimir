import { describe, it, beforeAll } from "vitest";
import { setupD1 } from "./setup";

describe("AUTH-01: Email/password signup", () => {
  beforeAll(async () => { await setupD1(); });

  it.todo("POST /api/auth/sign-up/email with valid payload creates a user in D1");
  it.todo("POST /api/auth/sign-up/email with duplicate email returns error (no enumeration)");
  it.todo("POST /api/auth/sign-up/email with password < 8 chars returns 400");
  it.todo("POST /api/auth/sign-up/email with invalid email format returns 400");
});

describe("AUTH-02: Email verification", () => {
  it.todo("Signup triggers sendVerificationEmail callback");
  it.todo("Verification token validates and sets emailVerified=true");
});

describe("AUTH-03: Password reset", () => {
  it.todo("POST /api/auth/forget-password sends reset email via callback");
  it.todo("POST /api/auth/reset-password with valid token updates password");
  it.todo("POST /api/auth/reset-password with expired token returns error");
});

describe("AUTH-04: Google OAuth", () => {
  it.todo("GET /api/auth/sign-in/social?provider=google redirects to Google");
  it.todo("OAuth callback with valid code creates user and session");
  it.todo("OAuth callback with error query param returns error response");
});

describe("AUTH-05: GitHub OAuth", () => {
  it.todo("GET /api/auth/sign-in/social?provider=github redirects to GitHub");
  it.todo("OAuth callback with valid code creates user and session");
  it.todo("OAuth callback with error query param returns error response");
});

describe("AUTH-06: Session persistence", () => {
  it.todo("Session cookie is HttpOnly and Secure");
  it.todo("Valid session cookie returns session on GET /api/auth/get-session");
  it.todo("Expired session returns null on GET /api/auth/get-session");
  it.todo("Max 3 concurrent sessions enforced — 4th login revokes oldest (D-01)");
  it.todo("Session expires after 7 days of inactivity (D-02)");
});
