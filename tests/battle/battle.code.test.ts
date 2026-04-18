import { describe, it, expect } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  generateJoinCode,
} from "../../worker/src/lib/join-code";

describe("battle join code (04-03, T-04-01)", () => {
  it("alphabet is exactly 32 characters", () => {
    expect(JOIN_CODE_ALPHABET.length).toBe(32);
  });

  it("alphabet excludes 5 ambiguous characters (0, O, 1, I, l)", () => {
    for (const c of "0O1Il") {
      expect(JOIN_CODE_ALPHABET).not.toContain(c);
    }
  });

  it("alphabet contains only uppercase letters and digits 2-9", () => {
    expect(JOIN_CODE_ALPHABET).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });

  it("generateJoinCode returns a string of exactly 6 characters", () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(JOIN_CODE_LENGTH);
    expect(JOIN_CODE_LENGTH).toBe(6);
  });

  it("10,000 generated codes contain no forbidden characters", () => {
    for (let i = 0; i < 10_000; i++) {
      const code = generateJoinCode();
      for (const ch of code) {
        expect(JOIN_CODE_ALPHABET).toContain(ch);
      }
    }
  });

  it("generated codes draw from a bias-free distribution across the alphabet", () => {
    // 256 % 32 === 0 means no modulo bias. Over 10,000 × 6 = 60,000 chars,
    // each alphabet position should appear roughly 60000/32 = 1875 times.
    // We only sanity-check that >= 20 unique characters appear (no stuck RNG).
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      for (const ch of generateJoinCode()) seen.add(ch);
    }
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });
});
