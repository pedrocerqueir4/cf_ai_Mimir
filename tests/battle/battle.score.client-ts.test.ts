import { describe, it, expect } from "vitest";
import { BattleAnswerMessage } from "../../worker/src/validation/battle-schemas";

// VALIDATION.md 04-09 (T-04-02): client-supplied TIMESTAMPS must be ignored/rejected.
// The Zod schema uses `.strict()` so ANY unknown key fails parse — this is the
// enforcement point for SEC-06 (server-authoritative scoring).

describe("BattleAnswerMessage strict mode — client timestamp (04-09, T-04-02)", () => {
  it("rejects answer message with extra `timestamp` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      timestamp: 123_456,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `clientTimestamp` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      clientTimestamp: 999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `receiveTimestamp` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      receiveTimestamp: 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `responseTime` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      responseTime: 500,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `sentAt` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      sentAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a clean answer message (baseline)", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
    });
    expect(result.success).toBe(true);
  });
});
