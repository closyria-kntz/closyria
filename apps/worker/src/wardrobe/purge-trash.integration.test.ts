import { createDb, eq, schema } from "@closyria/db";
import { TRASH_RETENTION_DAYS } from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { purgeTrash } from "./purge-trash";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

const now = new Date("2026-11-05T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

async function setup() {
  const { db } = handle;
  const n = ++counter;
  const userId = `purge-user-${n}`;
  await db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  return { userId, profileId: profile.id };
}

async function itemWithPhotos(
  store: ObjectStore,
  ctx: { userId: string; profileId: string },
  deletedAt: Date | null,
  photos = 2,
) {
  const { db } = handle;
  const [item] = await db
    .insert(schema.items)
    .values({ userId: ctx.userId, profileId: ctx.profileId, deletedAt })
    .returning();
  if (!item) throw new Error("no item");
  const keys: string[] = [];
  for (let i = 0; i < photos; i++) {
    const id = crypto.randomUUID();
    const key = `users/${ctx.userId}/${id}.webp`;
    await store.put(key, Buffer.from("x"), "image/webp");
    const [m] = await db
      .insert(schema.media)
      .values({ id, userId: ctx.userId, key, contentType: "image/webp", sizeBytes: 1, width: 1, height: 1 })
      .returning();
    if (!m) throw new Error("no media");
    await db.insert(schema.itemMedia).values({ itemId: item.id, mediaId: m.id, position: i });
    keys.push(key);
  }
  return { id: item.id, keys };
}

const stored = async (store: ObjectStore, key: string) => {
  try {
    await store.get(key);
    return true;
  } catch {
    return false;
  }
};

describe("purgeTrash", () => {
  it("erases items trashed over 30 days ago with their photos, keeps the others", async () => {
    const { db } = handle;
    expect(TRASH_RETENTION_DAYS).toBe(30);
    const store = memoryStore();
    const ctx = await setup();
    const old = await itemWithPhotos(store, ctx, daysAgo(31));
    const recent = await itemWithPhotos(store, ctx, daysAgo(29));
    const active = await itemWithPhotos(store, ctx, null);

    expect(await purgeTrash(db, now, store)).toBe(1);

    expect(await db.select().from(schema.items).where(eq(schema.items.id, old.id))).toHaveLength(0);
    for (const key of old.keys) {
      expect(await stored(store, key)).toBe(false);
      expect(await db.select().from(schema.media).where(eq(schema.media.key, key))).toHaveLength(0);
    }
    for (const kept of [recent, active]) {
      expect(await db.select().from(schema.items).where(eq(schema.items.id, kept.id))).toHaveLength(1);
      for (const key of kept.keys) {
        expect(await stored(store, key)).toBe(true);
        expect(await db.select().from(schema.media).where(eq(schema.media.key, key))).toHaveLength(1);
      }
    }
    expect(await purgeTrash(db, now, store)).toBe(0);
  });

  it("deletes the objects of its ready photo imports, and those of no other item", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    const old = await itemWithPhotos(store, ctx, daysAgo(31), 1);
    const readyKey = `users/${ctx.userId}/${crypto.randomUUID()}.webp`;
    await store.put(readyKey, Buffer.from("x"), "image/webp");
    const attachedKey = old.keys[0] as string;
    await db.insert(schema.photoImports).values([
      { userId: ctx.userId, itemId: old.id, url: "https://a.test/r.jpg", status: "ready", mediaKey: readyKey },
      { userId: ctx.userId, itemId: old.id, url: "https://a.test/a.jpg", status: "attached", mediaKey: attachedKey },
      { userId: ctx.userId, itemId: old.id, url: "https://a.test/q.jpg" },
    ]);
    const kept = await itemWithPhotos(store, ctx, null, 0);
    const keptKey = `users/${ctx.userId}/${crypto.randomUUID()}.webp`;
    await store.put(keptKey, Buffer.from("x"), "image/webp");
    await db
      .insert(schema.photoImports)
      .values({ userId: ctx.userId, itemId: kept.id, url: "https://a.test/k.jpg", status: "ready", mediaKey: keptKey });

    expect(await purgeTrash(db, now, store)).toBe(1);

    expect(await stored(store, readyKey)).toBe(false);
    expect(await stored(store, keptKey)).toBe(true);
    expect(await db.select().from(schema.photoImports).where(eq(schema.photoImports.itemId, old.id))).toEqual([]);
    expect(await db.select().from(schema.photoImports).where(eq(schema.photoImports.itemId, kept.id))).toHaveLength(1);
  });

  it("keeps an item trashed exactly 30 days ago", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    const edge = await itemWithPhotos(store, ctx, daysAgo(30), 1);
    expect(await purgeTrash(db, now, store)).toBe(0);
    expect(await db.select().from(schema.items).where(eq(schema.items.id, edge.id))).toHaveLength(1);
    expect(await stored(store, edge.keys[0] as string)).toBe(true);
  });

  it("never touches unattached media or another user's photos", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    const other = await setup();
    await itemWithPhotos(store, ctx, daysAgo(31), 1);
    const active = await itemWithPhotos(store, other, null, 1);
    const orphanId = crypto.randomUUID();
    const orphanKey = `users/${ctx.userId}/${orphanId}.webp`;
    await store.put(orphanKey, Buffer.from("x"), "image/webp");
    await db.insert(schema.media).values({
      id: orphanId,
      userId: ctx.userId,
      key: orphanKey,
      contentType: "image/webp",
      sizeBytes: 1,
      width: 1,
      height: 1,
    });

    expect(await purgeTrash(db, now, store)).toBe(1);
    for (const key of [orphanKey, ...active.keys]) {
      expect(await db.select().from(schema.media).where(eq(schema.media.key, key))).toHaveLength(1);
      expect(await stored(store, key)).toBe(true);
    }
  });

  it("keeps a photo still attached to another remaining item", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    const old = await itemWithPhotos(store, ctx, daysAgo(40), 1);
    const other = await itemWithPhotos(store, ctx, null, 0);
    const [m] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.key, old.keys[0] as string));
    await db.insert(schema.itemMedia).values({ itemId: other.id, mediaId: m?.id as string });

    expect(await purgeTrash(db, now, store)).toBe(1);
    expect(
      await db
        .select()
        .from(schema.media)
        .where(eq(schema.media.key, old.keys[0] as string)),
    ).toHaveLength(1);
    expect(await stored(store, old.keys[0] as string)).toBe(true);
  });

  it("works through more than one batch of 500", async () => {
    const { db } = handle;
    const store = memoryStore();
    const ctx = await setup();
    await db
      .insert(schema.items)
      .values(
        Array.from({ length: 501 }, () => ({ userId: ctx.userId, profileId: ctx.profileId, deletedAt: daysAgo(60) })),
      );
    expect(await purgeTrash(db, now, store)).toBe(501);
    expect(await db.select().from(schema.items).where(eq(schema.items.userId, ctx.userId))).toHaveLength(0);
  });

  it("logs and carries on when the store fails to delete", async () => {
    const { db } = handle;
    const inner = memoryStore();
    const store: ObjectStore = {
      ...inner,
      delete: async () => {
        throw new Error("boom");
      },
    };
    const ctx = await setup();
    const old = await itemWithPhotos(store, ctx, daysAgo(31), 1);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await purgeTrash(db, now, store)).toBe(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(await db.select().from(schema.items).where(eq(schema.items.id, old.id))).toHaveLength(0);
  });
});
