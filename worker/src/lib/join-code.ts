import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";

// 6-character random join code mechanics (D-03, T-04-01).
// 32-char alphabet is crypto.getRandomValues-bias-free because 256 % 32 === 0.
// Excludes visually ambiguous characters: 0, O, 1, I, l (5 chars).
// Space = 32^6 ≈ 1.07B — ample for single-host-in-lobby uniqueness windows.

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
  let out = "";
  for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
    out += JOIN_CODE_ALPHABET[bytes[i] % JOIN_CODE_ALPHABET.length];
  }
  return out;
}

// Reserves a code that no other battle currently holds in lobby state.
// Scope: status='lobby' only — completed/expired battles can share codes,
// which is enforced at the DB layer via the partial UNIQUE INDEX
// `idx_battles_lobby_joincode ON battles(join_code) WHERE status='lobby'`.
// Retries up to `maxAttempts` on collision; throws if all attempts collide
// (astronomically unlikely unless RNG is broken).
export async function generateUniqueCode(
  db: ReturnType<typeof drizzle<typeof schema>>,
  maxAttempts = 5,
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateJoinCode();
    const existing = await db
      .select({ id: schema.battles.id })
      .from(schema.battles)
      .where(
        and(
          eq(schema.battles.joinCode, code),
          eq(schema.battles.status, "lobby"),
        ),
      )
      .limit(1);
    if (existing.length === 0) return code;
  }
  throw new Error(
    `generateUniqueCode: exhausted ${maxAttempts} attempts without finding a free code`,
  );
}
