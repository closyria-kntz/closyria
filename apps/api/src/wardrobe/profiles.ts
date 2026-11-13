import { and, asc, count, type Database, eq, isNull, schema, sql } from "@closyria/db";
import type { ProfileView } from "@closyria/shared";
import type { Tx } from "./events";

export type Profile = typeof schema.profiles.$inferSelect;

/** Her profiles' order; the first one is « Moi » (her primary profile, also for the anonymous -> account merge). */
export const PROFILE_ORDER = [asc(schema.profiles.position), asc(schema.profiles.createdAt), asc(schema.profiles.id)];

/** Her first profile (by position), or null when she has none yet. */
async function firstProfile(db: Database | Tx, userId: string): Promise<Profile | null> {
  const [row] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .orderBy(...PROFILE_ORDER)
    .limit(1);
  return row ?? null;
}

/**
 * Her first profile, creating « Moi » (women, plum) when she has none. Called by every `me` route that needs a
 * profile. Two concurrent first requests create a single « Moi »: the check-then-insert runs under a transaction-scoped
 * advisory lock on the user.
 */
export async function ensureDefaultProfile(db: Database, userId: string): Promise<Profile> {
  const existing = await firstProfile(db, userId);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    await lockProfilesOf(tx, userId);
    return (await firstProfile(tx, userId)) ?? (await insertDefaultProfile(tx, userId));
  });
}

/**
 * Serializes, per user, the creation of « Moi » and the deletion of a profile (which may need a fallback « Moi »).
 * Transaction-scoped.
 */
export async function lockProfilesOf(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`profiles:${userId}`}, 0))`);
}

/** Inserts « Moi » (women, plum). Call under `lockProfilesOf`. */
export async function insertDefaultProfile(tx: Tx, userId: string): Promise<Profile> {
  const [created] = await tx
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum", position: 0 })
    .returning();
  if (!created) throw new Error("default profile not inserted");
  return created;
}

export function toProfileView(profile: Profile, itemCount?: number): ProfileView {
  return {
    id: profile.id,
    name: profile.name,
    audience: profile.audience as ProfileView["audience"],
    childDetail: profile.childDetail as ProfileView["childDetail"],
    color: profile.color as ProfileView["color"],
    position: profile.position,
    sizeTop: profile.sizeTop,
    sizeBottom: profile.sizeBottom,
    sizeShoes: profile.sizeShoes,
    ...(itemCount === undefined ? {} : { itemCount }),
  };
}

/** Her profiles in order, each with its number of active items; « Moi » is created first if needed. */
export async function listProfileViews(db: Database, userId: string): Promise<ProfileView[]> {
  await ensureDefaultProfile(db, userId);
  const [profiles, counts] = await Promise.all([
    db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, userId))
      .orderBy(...PROFILE_ORDER),
    db
      .select({ profileId: schema.items.profileId, n: count() })
      .from(schema.items)
      .where(and(eq(schema.items.userId, userId), isNull(schema.items.deletedAt)))
      .groupBy(schema.items.profileId),
  ]);
  const byProfile = new Map(counts.map((c) => [c.profileId, c.n]));
  return profiles.map((p) => toProfileView(p, byProfile.get(p.id) ?? 0));
}

/** One of her profiles, or null (unknown or another user's: the routes answer 404 for both). */
export async function findOwnProfile(db: Database | Tx, userId: string, profileId: string): Promise<Profile | null> {
  const [row] = await db
    .select()
    .from(schema.profiles)
    .where(and(eq(schema.profiles.id, profileId), eq(schema.profiles.userId, userId)));
  return row ?? null;
}
