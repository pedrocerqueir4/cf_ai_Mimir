import { describe, it, expect } from "vitest";
import { BattleAnswerMessage } from "../../worker/src/validation/battle-schemas";

// VALIDATION.md 04-10 (T-04-02): client-supplied SCORE fields must be ignored/rejected.
// Strict Zod mode rejects any `score`, `points`, `correct` that the client tries to
// inject alongside a valid {action, optionId}. SEC-06 enforcement.

describe("BattleAnswerMessage strict mode — client-supplied score (04-10, T-04-02)", () => {
  it("rejects answer message with extra `score` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      score: 9_999,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `points` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      points: 1_000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with extra `correct` field", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      correct: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects answer message with multiple injected fields", () => {
    const result = BattleAnswerMessage.safeParse({
      action: "answer",
      optionId: "opt-a",
      score: 1_000,
      correct: true,
      timestamp: Date.now(),
      responseTime: 200,
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
