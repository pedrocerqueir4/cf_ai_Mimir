import { eq, and } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

export async function verifyOwnership<T extends Record<string, unknown>>(
  db: DrizzleD1Database,
  table: any,
  recordId: string,
  userId: string,
  idCol: any,
  ownerCol: any,
): Promise<T | null> {
  const result = await db
    .select()
    .from(table)
    .where(and(eq(idCol, recordId), eq(ownerCol, userId)))
    .limit(1);
  return (result[0] as T) ?? null;
}
