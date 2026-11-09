import { createHash } from "node:crypto";
import { and, type Database, eq, schema, sql } from "@closyria/db";
import type { Tx } from "./events";

/** Device keys are stored hashed only. */
export const hashDeviceKey = (deviceKey: string) => createHash("sha256").update(deviceKey).digest("hex");

/** Serialises every write of one name on one list (opinions and gifts alike), until the transaction ends. */
export async function lockFriendName(tx: Tx, wishlistId: string, nameKey: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${wishlistId}:${nameKey}`}, 0))`);
}

/**
 * One person = one normalised name on a list, for opinions and gifts. The first device to use a name owns it;
 * another device gets `name_taken` unless it claims the name (« C'est toi ? »), which attaches it too. Call under
 * `lockFriendName`.
 */
export async function ensureFriendDevice(
  tx: Tx,
  wishlistId: string,
  nameKey: string,
  deviceKeyHash: string,
  claim: boolean | undefined,
): Promise<"ok" | "name_taken"> {
  const devices = await tx
    .select({ hash: schema.wishlistOpinionDevices.deviceKeyHash })
    .from(schema.wishlistOpinionDevices)
    .where(
      and(
        eq(schema.wishlistOpinionDevices.wishlistId, wishlistId),
        eq(schema.wishlistOpinionDevices.authorNameKey, nameKey),
      ),
    );
  const known = devices.some((d) => d.hash === deviceKeyHash);
  if (devices.length > 0 && !known && !claim) return "name_taken";
  if (!known) {
    await tx
      .insert(schema.wishlistOpinionDevices)
      .values({ wishlistId, authorNameKey: nameKey, deviceKeyHash })
      .onConflictDoNothing();
  }
  return "ok";
}

/** True when the device is attached to the name on the list. */
export async function isFriendDevice(db: Database | Tx, wishlistId: string, nameKey: string, deviceKey: string) {
  const [device] = await db
    .select({ hash: schema.wishlistOpinionDevices.deviceKeyHash })
    .from(schema.wishlistOpinionDevices)
    .where(
      and(
        eq(schema.wishlistOpinionDevices.wishlistId, wishlistId),
        eq(schema.wishlistOpinionDevices.authorNameKey, nameKey),
        eq(schema.wishlistOpinionDevices.deviceKeyHash, hashDeviceKey(deviceKey)),
      ),
    );
  return device !== undefined;
}

/** The names a device is attached to on a list (normalised keys). */
export async function friendNameKeysOf(db: Database | Tx, wishlistId: string, deviceKey: string): Promise<string[]> {
  const rows = await db
    .select({ nameKey: schema.wishlistOpinionDevices.authorNameKey })
    .from(schema.wishlistOpinionDevices)
    .where(
      and(
        eq(schema.wishlistOpinionDevices.wishlistId, wishlistId),
        eq(schema.wishlistOpinionDevices.deviceKeyHash, hashDeviceKey(deviceKey)),
      ),
    );
  return rows.map((r) => r.nameKey);
}
