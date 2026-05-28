import { describe, it, beforeAll, expect } from "vitest";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { setupD1, createTestSession } from "./setup";
import { chatRoutes } from "../worker/src/routes/chat";
import { classifyAIError, QUOTA_EXHAUSTED_MESSAGE } from "../worker/src/lib/ai-errors";

// ─── Unit: classifier ─────────────────────────────────────────────────────────
//
// Verbatim Cloudflare quota error message captured from docs:
//   https://developers.cloudflare.com/workers-ai/platform/errors/
// "You have used up your daily free allocation of 10,000 neurons. Please
//  upgrade to Cloudflare's Workers Paid plan if you would like to continue
//  usage."
//
// Plus several shape variants observed in the wild — the binding does not
// document a stable error class, so we test a spread of plausible shapes
// rather than committing to one.
describe("classifyAIError — quota detection", () => {
  it("matches the verbatim Cloudflare free-tier message (status undefined)", () => {
    const err = new Error(
      "You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage."
    );
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("matches HTTP 429 on .status", () => {
    const err = { status: 429, message: "Too Many Requests" };
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("matches HTTP 429 on .statusCode (Node-style)", () => {
    const err = { statusCode: 429, message: "rate limited" };
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("matches error code 3036 (Cloudflare docs primary)", () => {
    const err = { code: 3036, message: "quota exhausted" };
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("matches error code 4006 (community-reported variant)", () => {
    const err = { code: "4006", message: "free neuron limit" };
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("matches the smoke-test stub message we throw locally", () => {
    const err = new Error("Rate limit: 10000 neurons quota exhausted for today (smoke test)");
    expect(classifyAIError(err)).toBe("quota_exhausted");
  });

  it("does NOT misclassify a normal model error as quota", () => {
    const err = new Error("Model inference failed: bad request shape");
    expect(classifyAIError(err)).toBe("model_error");
  });

  it("does NOT misclassify a timeout as quota", () => {
    const err = new Error("Request timed out after 60s");
    expect(classifyAIError(err)).toBe("timeout");
  });

  it("falls through to 'unknown' for unrecognized errors", () => {
    const err = new Error("Something completely unrelated happened");
    expect(classifyAIError(err)).toBe("unknown");
  });

  it("handles null/undefined safely", () => {
    expect(classifyAIError(null)).toBe("unknown");
    expect(classifyAIError(undefined)).toBe("unknown");
  });
});

// ─── Integration: chat POST /message returns system_warning on quota ────────
//
// Mocks env.AI.run to throw the verbatim Cloudflare quota error. Asserts the
// chat endpoint catches it, classifies it, and returns the SSE event stream
// the frontend reader expects.
function buildTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/chat", chatRoutes);
  return app;
}

function createQuotaThrowAI() {
  return {
    run: async () => {
      // Throw the verbatim shape Cloudflare's docs describe.
      throw new Error(
        "You have used up your daily free allocation of 10,000 neurons. Please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage."
      );
    },
  };
}

describe("POST /api/chat/message — quota error path", () => {
  let cookie: string;

  beforeAll(async () => {
    await setupD1();
    const session = await createTestSession("quota01@example.com");
    cookie = session.cookie;
  });

  it("returns 200 + text/event-stream + system_warning event when AI quota exhausts", async () => {
    const app = buildTestApp();
    const mockAI = createQuotaThrowAI();

    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "What is a variable?" }),
      },
      { ...env, AI: mockAI }
    );

    // 1. Status MUST be 200 (not 500) so the frontend's sendChatMessage doesn't
    //    throw on !response.ok. This is the root cause we suspect.
    expect(res.status).toBe(200);

    // 2. Content-type MUST be text/event-stream so the frontend takes the SSE
    //    branch (not the JSON branch that triggers the generic error).
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    // 3. Body MUST contain the system_warning SSE event with the verbatim copy.
    const body = await res.text();
    expect(body).toContain("event: system_warning");
    expect(body).toContain(QUOTA_EXHAUSTED_MESSAGE);

    // 4. Body MUST be properly delimited (\n\n at end of SSE event).
    expect(body.endsWith("\n\n")).toBe(true);
  });

  it("does NOT misclassify a generic AI error — returns 500 (existing behaviour)", async () => {
    const app = buildTestApp();
    const mockAI = {
      run: async () => {
        throw new Error("Model inference failed: bad request shape");
      },
    };

    const res = await app.request(
      "/api/chat/message",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ message: "What is a variable?" }),
      },
      { ...env, AI: mockAI }
    );

    // Non-quota errors should re-throw → Hono's default 500 handler kicks in.
    // This guards against the classifier becoming over-eager and swallowing
    // legitimate errors as quota events.
    expect(res.status).toBe(500);
  });
});
