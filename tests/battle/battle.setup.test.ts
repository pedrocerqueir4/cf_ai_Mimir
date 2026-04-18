import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:workers";
import { setupD1 } from "../setup";

describe("Phase 4 Wave 0 — test harness (04-W0-01)", () => {
  beforeAll(async () => {
    await setupD1();
  });

  it("04-W0-01: D1 binding resolves and setupD1 completes", async () => {
    const result = await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
    expect(result?.one).toBe(1);
  });

  it("04-W0-01: BATTLE_ROOM DurableObjectNamespace binding is present", () => {
    expect(env.BATTLE_ROOM).toBeDefined();
    expect(typeof env.BATTLE_ROOM.idFromName).toBe("function");
  });

  it("04-W0-01: BATTLE_QUESTION_WORKFLOW binding is present", () => {
    expect(env.BATTLE_QUESTION_WORKFLOW).toBeDefined();
    expect(typeof env.BATTLE_QUESTION_WORKFLOW.create).toBe("function");
  });

  it("04-W0-01: battle rate-limit bindings are present", () => {
    expect(env.RATE_LIMITER_BATTLE_CREATE).toBeDefined();
    expect(env.RATE_LIMITER_BATTLE_JOIN).toBeDefined();
  });
});
