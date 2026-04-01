import { describe, it, beforeAll } from "vitest";
import { setupD1 } from "./setup";

describe("SEC-01: Input sanitization", () => {
  it.todo("POST /api/* with <script> tag in body returns 400");
  it.todo("POST /api/* with SQL injection pattern returns 400");
  it.todo("POST /api/* with prompt injection marker returns 400");
  it.todo("POST /api/* with clean JSON body passes through");
  it.todo("GET requests are not sanitized (no body)");
});

describe("SEC-02: Rate limiting", () => {
  it.todo("Auth endpoint returns 429 after 10 requests in 60 seconds from same IP");
  it.todo("Register endpoint returns 429 after 5 requests in 60 seconds from same IP");
  it.todo("Rate limit error message matches UI-SPEC copy");
});

describe("SEC-03: IDOR prevention", () => {
  it.todo("verifyOwnership returns record when userId matches");
  it.todo("verifyOwnership returns null when userId does not match");
  it.todo("verifyOwnership uses AND condition (not OR)");
});

describe("SEC-04: SSRF prevention", () => {
  it.todo("trustedOrigins only contains PUBLIC_URL");
  it.todo("verifyTurnstileToken only fetches hardcoded Cloudflare endpoint");
  it.todo("No dynamic URL construction from user input in server-side fetch calls");
});
