import { asc, type Database, eq, schema } from "@closyria/db";
import { DEFAULT_LOVE_LEVELS, type LoveLevelView } from "@closyria/shared";

/** Her four level names and emojis; the starting ones while she has not changed them. */
export async function readLoveLevels(db: Database, userId: string): Promise<LoveLevelView[]> {
  const rows = await db
    .select({ level: schema.loveLevels.level, emoji: schema.loveLevels.emoji, label: schema.loveLevels.label })
    .from(schema.loveLevels)
    .where(eq(schema.loveLevels.userId, userId))
    .orderBy(asc(schema.loveLevels.level));
  return rows.length === 4 ? rows : [...DEFAULT_LOVE_LEVELS];
}
