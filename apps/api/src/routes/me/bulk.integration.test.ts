import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, schema } from "@closyria/db";
import type { ItemBulk, ItemView, MutationResult, UndoPayload } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
const AT = "2026-11-03T10:00:00.000Z";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

type ProfileJson = { id: string; name: string };
type TagJson = { id: string; name: string; color: string | null };

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function bulk(cookie: string, op: ItemBulk, status = 200) {
  const res = await call("POST", "/api/me/items/bulk", cookie, op);
  expect(res.status).toBe(status);
  return (await res.json()) as MutationResult;
}

async function undo(cookie: string, payload: UndoPayload | null, status = 200) {
  const res = await call("POST", "/api/me/items/undo", cookie, payload);
  expect(res.status).toBe(status);
  return (await res.json()) as MutationResult;
}

async function newProducts(n: number) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique B${k}`, slug: `me-bulk-shop-${k}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return t.db
    .insert(schema.products)
    .values(
      Array.from({ length: n }, (_, i) => ({
        shopId: shop.id,
        canonicalUrl: `https://me-bulk-${k}-${i}.test/p`,
        name: `Robe ${k}-${i}`,
      })),
    )
    .returning();
}

async function newProfile(cookie: string, name = "Léa") {
  const res = await call("POST", "/api/me/profiles", cookie, { name, audience: "women", color: "rose" });
  expect(res.status).toBe(201);
  return (await res.json()) as ProfileJson;
}

async function defaultProfile(cookie: string) {
  const body = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] };
  return body.profiles[0] as ProfileJson;
}

/** Items inserted straight in the database (faster than 200 API calls), one product each. */
async function newItems(
  userId: string,
  profileIds: string[],
  overrides: Partial<typeof schema.items.$inferInsert> = {},
) {
  const products = await newProducts(profileIds.length);
  return t.db
    .insert(schema.items)
    .values(profileIds.map((profileId, i) => ({ userId, profileId, productId: products[i]?.id, ...overrides })))
    .returning();
}

async function newTag(cookie: string, name: string) {
  const res = await call("POST", "/api/me/tags", cookie, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as TagJson;
}

const rowsOf = (ids: string[]) =>
  t.db.select().from(schema.items).where(inArray(schema.items.id, ids)).orderBy(asc(schema.items.id));
const eventsOf = (ids: string[]) => t.db.select().from(schema.itemEvents).where(inArray(schema.itemEvents.itemId, ids));
const tagIdsOf = async (itemId: string) =>
  (await t.db.select().from(schema.itemTags).where(eq(schema.itemTags.itemId, itemId))).map((r) => r.tagId);

describe("POST /api/me/items/bulk — move and undo", () => {
  it("moves 200 items and the undo puts each one back in its own profile, history included", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const lea = await newProfile(cookie, "Léa");
    const tom = await newProfile(cookie, "Tom");
    const origins = Array.from({ length: 200 }, (_, i) => (i < 100 ? moi.id : i < 190 ? lea.id : tom.id));
    const items = await newItems(userId, origins);
    const ids = items.map((i) => i.id);

    const moved = await bulk(cookie, { op: "move", ids, profileId: tom.id });
    const changed = items.filter((i) => i.profileId !== tom.id).map((i) => i.id);
    expect(moved.itemIds.toSorted()).toEqual(changed.toSorted());
    expect((await rowsOf(ids)).every((r) => r.profileId === tom.id)).toBe(true);
    const events = await eventsOf(ids);
    expect(events).toHaveLength(190);
    expect(events.every((e) => e.type === "profile" && e.toProfileId === tom.id)).toBe(true);
    const payload = moved.undo;
    expect(payload?.removeEventIds.toSorted()).toEqual(events.map((e) => e.id).toSorted());
    expect(payload?.ops).toHaveLength(2);
    expect(payload?.ops).toEqual(
      expect.arrayContaining([
        { op: "move", profileId: moi.id, ids: expect.any(Array) },
        { op: "move", profileId: lea.id, ids: expect.any(Array) },
      ]),
    );

    const moves = await t.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.userId, userId), eq(schema.events.name, "item_moved")));
    expect(moves).toHaveLength(190);
    expect(new Set(moves.map((e) => e.occurredAt.toISOString())).size).toBe(1);

    const undone = await undo(cookie, payload ?? null);
    expect(undone.undo).toBeNull();
    expect(undone.itemIds.toSorted()).toEqual(changed.toSorted());
    const back = new Map((await rowsOf(ids)).map((r) => [r.id, r.profileId]));
    for (const [i, item] of items.entries()) expect(back.get(item.id)).toBe(origins[i]);
    // The undo deletes the transfer rows and writes none.
    expect(await eventsOf(ids)).toEqual([]);
  }, 30_000);

  it("refuses 201 ids, duplicates and an empty list with 400", async () => {
    const { cookie } = await t.signIn();
    const profile = await defaultProfile(cookie);
    const ids = Array.from({ length: 201 }, () => randomUUID());
    expect((await call("POST", "/api/me/items/bulk", cookie, { op: "move", ids, profileId: profile.id })).status).toBe(
      400,
    );
    const dup = randomUUID();
    expect((await call("POST", "/api/me/items/bulk", cookie, { op: "delete", ids: [dup, dup] })).status).toBe(400);
    expect((await call("POST", "/api/me/items/bulk", cookie, { op: "delete", ids: [] })).status).toBe(400);
  });

  it("answers 404 for a profile of another user or deleted, nothing moved", async () => {
    const { cookie, userId } = await t.signIn();
    const other = await t.signIn();
    const moi = await defaultProfile(cookie);
    const theirs = await defaultProfile(other.cookie);
    const gone = await newProfile(cookie, "Parti");
    expect((await call("DELETE", `/api/me/profiles/${gone.id}`, cookie)).status).toBe(204);
    const items = await newItems(userId, [moi.id, moi.id]);
    const ids = items.map((i) => i.id);
    for (const profileId of [theirs.id, gone.id, UNKNOWN_ID]) {
      const res = await call("POST", "/api/me/items/bulk", cookie, { op: "move", ids, profileId });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await rowsOf(ids)).every((r) => r.profileId === moi.id)).toBe(true);
    expect(await eventsOf(ids)).toEqual([]);
  });
});

describe("move into a profile deleted meanwhile", () => {
  it("answers 404, never 500, on the bulk and single routes while the deletion is in flight", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const items = await newItems(userId, [moi.id, moi.id]);
    for (const attempt of ["bulk", "single"] as const) {
      const doomed = await newProfile(cookie, `Parti ${attempt}`);
      let pending: Promise<Response> | Response | undefined;
      await t.db.transaction(async (tx) => {
        await tx.delete(schema.profiles).where(eq(schema.profiles.id, doomed.id));
        pending =
          attempt === "bulk"
            ? call("POST", "/api/me/items/bulk", cookie, {
                op: "move",
                ids: items.map((i) => i.id),
                profileId: doomed.id,
              })
            : call("POST", `/api/me/items/${items[0]?.id}/move`, cookie, { profileId: doomed.id });
        // Let the request reach its lock on the profile row before the deletion commits.
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
      if (!pending) throw new Error("no request sent");
      const res = await pending;
      expect(res.status, attempt).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await rowsOf(items.map((i) => i.id))).every((r) => r.profileId === moi.id)).toBe(true);
  });
});

describe("POST /api/me/items/bulk — isolation", () => {
  it("answers 404 for the whole batch when one id is another user's or unknown, and changes nothing", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const mine = await newItems(owner.userId, [(await defaultProfile(owner.cookie)).id]);
    const otherProfile = await defaultProfile(other.cookie);
    const [theirs] = await newItems(other.userId, [otherProfile.id]);
    const lea = await newProfile(owner.cookie);
    const tag = await newTag(owner.cookie, "Été");
    const ids = [mine[0]?.id ?? "", theirs?.id ?? ""];
    const ops: ItemBulk[] = [
      { op: "setFavorite", ids, favorite: true },
      { op: "move", ids, profileId: lea.id },
      { op: "stage", ids, stage: "owned", at: AT },
      { op: "addTag", ids, tagId: tag.id },
      { op: "delete", ids },
      { op: "restore", ids },
      { op: "setFields", ids, fields: { notes: "volé" } },
      { op: "delete", ids: [mine[0]?.id ?? "", UNKNOWN_ID] },
    ];
    for (const op of ops) {
      const res = await call("POST", "/api/me/items/bulk", owner.cookie, op);
      expect(res.status, op.op).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    const rows = await rowsOf(ids);
    for (const row of rows) {
      expect(row).toMatchObject({ favorite: false, stage: "spotted", notes: null, deletedAt: null });
    }
    expect(rows.find((r) => r.id === theirs?.id)?.profileId).toBe(otherProfile.id);
    expect(await eventsOf(ids)).toEqual([]);
    expect(await tagIdsOf(mine[0]?.id ?? "")).toEqual([]);
  });

  it("answers 404 for another user's tag or list", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const [item] = await newItems(owner.userId, [(await defaultProfile(owner.cookie)).id]);
    const theirTag = await newTag(other.cookie, "Vinted");
    const [theirList] = await t.db.insert(schema.wishlists).values({ userId: other.userId, name: "Autre" }).returning();
    const ids = [item?.id ?? ""];
    for (const op of [
      { op: "addTag", ids, tagId: theirTag.id },
      { op: "removeTag", ids, tagId: theirTag.id },
      { op: "addToList", ids, wishlistId: theirList?.id ?? "" },
      { op: "removeFromList", ids, wishlistId: theirList?.id ?? "" },
    ] satisfies ItemBulk[]) {
      expect((await call("POST", "/api/me/items/bulk", owner.cookie, op)).status, op.op).toBe(404);
    }
    expect(await tagIdsOf(item?.id ?? "")).toEqual([]);
  });

  it("answers 401 without a session", async () => {
    expect((await call("POST", "/api/me/items/bulk", undefined, { op: "delete", ids: [UNKNOWN_ID] })).status).toBe(401);
    expect(
      (
        await call("POST", "/api/me/items/undo", undefined, {
          ops: [{ op: "delete", ids: [UNKNOWN_ID] }],
          removeEventIds: [],
        })
      ).status,
    ).toBe(401);
  });
});

describe("POST /api/me/items/bulk — tags, lists, favorite", () => {
  it("adds a tag to the items that lack it; deleting the tag takes it off, the items stay", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const items = await newItems(userId, [moi.id, moi.id, moi.id]);
    const ids = items.map((i) => i.id);
    const tag = await newTag(cookie, "Vinted");
    const first = await bulk(cookie, { op: "addTag", ids: [ids[0] ?? ""], tagId: tag.id });
    expect(first.itemIds).toEqual([ids[0]]);
    const added = await bulk(cookie, { op: "addTag", ids, tagId: tag.id });
    expect(added.itemIds.toSorted()).toEqual([ids[1], ids[2]].toSorted());
    expect(added.undo).toEqual({
      ops: [{ op: "removeTag", tagId: tag.id, ids: expect.arrayContaining([ids[1], ids[2]]) }],
      removeEventIds: [],
    });
    const view = (await (await call("GET", `/api/me/items/${ids[1]}`, cookie)).json()) as ItemView;
    expect(view.tags).toEqual([{ id: tag.id, name: "Vinted", color: null }]);

    // Undo takes it off the two items it was added to only.
    await undo(cookie, added.undo);
    expect(await tagIdsOf(ids[0] ?? "")).toEqual([tag.id]);
    expect(await tagIdsOf(ids[1] ?? "")).toEqual([]);

    const removed = await bulk(cookie, { op: "removeTag", ids, tagId: tag.id });
    expect(removed.itemIds).toEqual([ids[0]]);
    expect(removed.undo).toEqual({ ops: [{ op: "addTag", tagId: tag.id, ids: [ids[0]] }], removeEventIds: [] });
    await undo(cookie, removed.undo);
    expect(await tagIdsOf(ids[0] ?? "")).toEqual([tag.id]);

    expect((await call("DELETE", `/api/me/tags/${tag.id}`, cookie)).status).toBe(204);
    expect(await tagIdsOf(ids[0] ?? "")).toEqual([]);
    expect(await rowsOf(ids)).toHaveLength(3);
  });

  it("adds to and removes from one of her lists, each undone", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const items = await newItems(userId, [moi.id, moi.id]);
    const ids = items.map((i) => i.id);
    const [list] = await t.db.insert(schema.wishlists).values({ userId, name: "Noël" }).returning();
    const wishlistId = list?.id ?? "";
    const added = await bulk(cookie, { op: "addToList", ids, wishlistId });
    expect(added.itemIds.toSorted()).toEqual(ids.toSorted());
    const members = await t.db
      .select()
      .from(schema.wishlistItems)
      .where(eq(schema.wishlistItems.wishlistId, wishlistId))
      .orderBy(asc(schema.wishlistItems.position));
    expect(members.map((m) => [m.itemId, m.position])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
    ]);
    expect(added.undo).toEqual({
      ops: [{ op: "removeFromList", wishlistId, ids: expect.arrayContaining(ids) }],
      removeEventIds: [],
    });
    const again = await bulk(cookie, { op: "addToList", ids, wishlistId });
    expect(again).toEqual({ itemIds: [], undo: null });
    await undo(cookie, added.undo);
    expect(
      await t.db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.wishlistId, wishlistId)),
    ).toEqual([]);
  });

  it("sets favorite on the items that change, and the undo resets only those", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const [fav] = await newItems(userId, [moi.id], { favorite: true });
    const [plain] = await newItems(userId, [moi.id]);
    const ids = [fav?.id ?? "", plain?.id ?? ""];
    const result = await bulk(cookie, { op: "setFavorite", ids, favorite: true });
    expect(result).toEqual({
      itemIds: [plain?.id],
      undo: { ops: [{ op: "setFavorite", favorite: false, ids: [plain?.id] }], removeEventIds: [] },
    });
    await undo(cookie, result.undo);
    expect((await rowsOf(ids)).map((r) => [r.id, r.favorite]).toSorted()).toEqual(
      [
        [fav?.id, true],
        [plain?.id, false],
      ].toSorted(),
    );
  });
});

describe("POST /api/me/items/bulk — stage and fields", () => {
  it("changes the stage with one history row per item; the undo restores stage and amounts and drops the rows", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const [a] = await newItems(userId, [moi.id], { stage: "owned", pricePaidCents: 3000 });
    const [b] = await newItems(userId, [moi.id], { stage: "owned", pricePaidCents: 3000, salePriceCents: 1500 });
    const [c] = await newItems(userId, [moi.id], { stage: "spotted" });
    const [d] = await newItems(userId, [moi.id], { stage: "for_sale" });
    const ids = [a, b, c, d].map((i) => i?.id ?? "");
    const result = await bulk(cookie, {
      op: "stage",
      ids,
      stage: "for_sale",
      at: AT,
      amountCents: 2000,
      channel: "Vinted",
    });
    expect(result.itemIds.toSorted()).toEqual([a?.id, b?.id, c?.id].toSorted());
    const rows = await rowsOf(ids);
    // `d` was already for sale: left as it is, its amounts included.
    for (const row of rows.filter((r) => r.id !== d?.id)) {
      expect(row).toMatchObject({ stage: "for_sale", salePriceCents: 2000, saleChannel: "Vinted" });
    }
    expect(rows.find((r) => r.id === d?.id)).toMatchObject({ stage: "for_sale", salePriceCents: null });
    expect(rows.find((r) => r.id === a?.id)?.pricePaidCents).toBe(3000);
    const events = await eventsOf(ids);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.stage === "for_sale" && e.amountCents === 2000 && e.at.toISOString() === AT)).toBe(
      true,
    );
    // One audience row per item changed (stats count rows), written in a single insert.
    const audience = await t.db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.userId, userId), eq(schema.events.name, "item_stage_changed")));
    expect(audience.map((e) => e.props).toSorted((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))).toEqual(
      [
        { from: "owned", to: "for_sale" },
        { from: "owned", to: "for_sale" },
        { from: "spotted", to: "for_sale" },
      ],
    );
    expect(new Set(audience.map((e) => e.occurredAt.toISOString())).size).toBe(1);
    const ops = result.undo?.ops ?? [];
    expect(ops).toEqual(
      expect.arrayContaining([
        { op: "stage", stage: "owned", at: expect.any(String), ids: expect.arrayContaining([a?.id, b?.id]) },
        { op: "stage", stage: "spotted", at: expect.any(String), ids: [c?.id] },
        {
          op: "setFields",
          fields: { salePriceCents: null, saleChannel: null },
          ids: expect.arrayContaining([a?.id, c?.id]),
        },
        { op: "setFields", fields: { salePriceCents: 1500, saleChannel: null }, ids: [b?.id] },
      ]),
    );
    expect(ops).toHaveLength(4);
    expect(result.undo?.removeEventIds.toSorted()).toEqual(events.map((e) => e.id).toSorted());

    await undo(cookie, result.undo);
    const back = new Map((await rowsOf(ids)).map((r) => [r.id, r]));
    expect(back.get(a?.id ?? "")).toMatchObject({ stage: "owned", pricePaidCents: 3000, salePriceCents: null });
    expect(back.get(b?.id ?? "")).toMatchObject({ stage: "owned", salePriceCents: 1500, saleChannel: null });
    expect(back.get(c?.id ?? "")).toMatchObject({ stage: "spotted", salePriceCents: null });
    expect(back.get(d?.id ?? "")).toMatchObject({ stage: "for_sale", salePriceCents: null, saleChannel: null });
    expect(await eventsOf(ids)).toEqual([]);
  });

  it("refuses to change items in the trash with 409 item_deleted, nothing changed", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const [active] = await newItems(userId, [moi.id]);
    const [trashed] = await newItems(userId, [moi.id], { deletedAt: new Date() });
    const ids = [active?.id ?? "", trashed?.id ?? ""];
    const res = await call("POST", "/api/me/items/bulk", cookie, { op: "stage", ids, stage: "owned", at: AT });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "item_deleted" });
    expect((await rowsOf(ids)).every((r) => r.stage === "spotted")).toBe(true);
    expect(await eventsOf(ids)).toEqual([]);
  });

  it("sets fields and the undo gives each item its own previous values back", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const [a] = await newItems(userId, [moi.id], { notes: "un", sizeLabel: "M" });
    const [b] = await newItems(userId, [moi.id], { notes: "deux", sizeLabel: "M" });
    const [c] = await newItems(userId, [moi.id], { notes: "trois", sizeLabel: "L" });
    const ids = [a, b, c].map((i) => i?.id ?? "");
    const result = await bulk(cookie, { op: "setFields", ids, fields: { notes: "trois", sizeLabel: "M" } });
    expect(result.itemIds.toSorted()).toEqual(ids.toSorted());
    expect(result.undo?.ops).toHaveLength(3);
    expect(result.undo?.ops).toEqual(
      expect.arrayContaining([
        { op: "setFields", fields: { notes: "un" }, ids: [a?.id] },
        { op: "setFields", fields: { notes: "deux" }, ids: [b?.id] },
        { op: "setFields", fields: { sizeLabel: "L" }, ids: [c?.id] },
      ]),
    );
    expect((await rowsOf(ids)).every((r) => r.notes === "trois" && r.sizeLabel === "M")).toBe(true);
    await undo(cookie, result.undo);
    const back = new Map((await rowsOf(ids)).map((r) => [r.id, r]));
    expect(back.get(a?.id ?? "")).toMatchObject({ notes: "un", sizeLabel: "M" });
    expect(back.get(b?.id ?? "")).toMatchObject({ notes: "deux", sizeLabel: "M" });
    expect(back.get(c?.id ?? "")).toMatchObject({ notes: "trois", sizeLabel: "L" });
  });

  it("refuses a cover that is not a photo of every item, an unknown category, an empty field set", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const items = await newItems(userId, [moi.id, moi.id]);
    const ids = items.map((i) => i.id);
    const mediaId = randomUUID();
    await t.db.insert(schema.media).values({
      id: mediaId,
      userId,
      key: `users/${userId}/${mediaId}.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      width: 300,
      height: 400,
    });
    await t.db.insert(schema.itemMedia).values({ itemId: ids[0] ?? "", mediaId, position: 0 });
    const cover = await call("POST", "/api/me/items/bulk", cookie, {
      op: "setFields",
      ids,
      fields: { coverMediaId: mediaId },
    });
    expect(cover.status).toBe(400);
    expect(await cover.json()).toEqual({ error: "invalid_cover" });
    const category = await call("POST", "/api/me/items/bulk", cookie, {
      op: "setFields",
      ids,
      fields: { categoryId: UNKNOWN_ID },
    });
    expect(await category.json()).toEqual({ error: "invalid_category" });
    expect((await call("POST", "/api/me/items/bulk", cookie, { op: "setFields", ids, fields: {} })).status).toBe(400);
    expect((await rowsOf(ids)).every((r) => r.coverMediaId === null && r.categoryId === null)).toBe(true);
  });
});

describe("POST /api/me/items/bulk — trash", () => {
  it("deletes then restores in bulk, each undone", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const items = await newItems(userId, [moi.id, moi.id, moi.id]);
    const ids = items.map((i) => i.id);
    const deleted = await bulk(cookie, { op: "delete", ids });
    expect(deleted.itemIds.toSorted()).toEqual(ids.toSorted());
    expect(deleted.undo).toEqual({ ops: [{ op: "restore", ids: expect.arrayContaining(ids) }], removeEventIds: [] });
    expect((await rowsOf(ids)).every((r) => r.deletedAt !== null)).toBe(true);
    const trash = (await (await call("GET", "/api/me/items?deleted=true", cookie)).json()) as { items: ItemView[] };
    expect(trash.items).toHaveLength(3);

    const restored = await bulk(cookie, { op: "restore", ids });
    expect(restored.itemIds.toSorted()).toEqual(ids.toSorted());
    expect((await rowsOf(ids)).every((r) => r.deletedAt === null)).toBe(true);
    expect(restored.undo).toEqual({ ops: [{ op: "delete", ids: expect.arrayContaining(ids) }], removeEventIds: [] });

    await undo(cookie, restored.undo);
    expect((await rowsOf(ids)).every((r) => r.deletedAt !== null)).toBe(true);
    await undo(cookie, deleted.undo);
    expect((await rowsOf(ids)).every((r) => r.deletedAt === null)).toBe(true);
  });

  it("restoring merges into the active item for the same product, which has no undo", async () => {
    const { cookie, userId } = await t.signIn();
    const moi = await defaultProfile(cookie);
    const [product] = await newProducts(1);
    const [old] = await t.db
      .insert(schema.items)
      .values({ userId, profileId: moi.id, productId: product?.id, stage: "owned", deletedAt: new Date() })
      .returning();
    const [active] = await t.db
      .insert(schema.items)
      .values({ userId, profileId: moi.id, productId: product?.id, stage: "spotted" })
      .returning();
    const [lone] = await newItems(userId, [moi.id], { deletedAt: new Date() });
    const result = await bulk(cookie, { op: "restore", ids: [old?.id ?? "", lone?.id ?? ""] });
    expect(result.itemIds.toSorted()).toEqual([active?.id, lone?.id].toSorted());
    expect(result.undo).toEqual({ ops: [{ op: "delete", ids: [lone?.id] }], removeEventIds: [] });
    expect(await rowsOf([old?.id ?? ""])).toEqual([]);
    expect((await rowsOf([active?.id ?? ""]))[0]?.stage).toBe("owned");
  });
});

describe("POST /api/me/items/undo", () => {
  it("answers 404 for another user's history row and changes nothing", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const moi = await defaultProfile(owner.cookie);
    const lea = await newProfile(owner.cookie);
    const [item] = await newItems(owner.userId, [moi.id]);
    const moved = await bulk(owner.cookie, { op: "move", ids: [item?.id ?? ""], profileId: lea.id });
    const theirMoi = await defaultProfile(other.cookie);
    const theirLea = await newProfile(other.cookie);
    const [theirItem] = await newItems(other.userId, [theirMoi.id]);
    const theirMove = await bulk(other.cookie, { op: "move", ids: [theirItem?.id ?? ""], profileId: theirLea.id });
    const payload: UndoPayload = {
      ops: moved.undo?.ops ?? [],
      removeEventIds: [...(moved.undo?.removeEventIds ?? []), ...(theirMove.undo?.removeEventIds ?? [])],
    };
    const res = await call("POST", "/api/me/items/undo", owner.cookie, payload);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await rowsOf([item?.id ?? ""]))[0]?.profileId).toBe(lea.id);
    expect(await eventsOf([item?.id ?? "", theirItem?.id ?? ""])).toHaveLength(2);
    // Someone else's undo replayed by her: their item is not hers.
    expect((await call("POST", "/api/me/items/undo", owner.cookie, theirMove.undo)).status).toBe(404);
    expect((await rowsOf([theirItem?.id ?? ""]))[0]?.profileId).toBe(theirLea.id);
  });

  it("refuses an invalid payload with 400", async () => {
    const { cookie } = await t.signIn();
    expect((await call("POST", "/api/me/items/undo", cookie, { ops: [], removeEventIds: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 3 }, () => ({
      op: "delete",
      ids: Array.from({ length: 200 }, () => randomUUID()),
    }));
    expect((await call("POST", "/api/me/items/undo", cookie, { ops: tooMany, removeEventIds: [] })).status).toBe(400);
  });

  it("undoes a single-item creation, stage change and patch", async () => {
    const { cookie } = await t.signIn();
    const [product] = await newProducts(1);
    const created = (await (
      await call("POST", "/api/me/items", cookie, { productId: product?.id, action: "favorite" })
    ).json()) as MutationResult & { item: ItemView };
    const id = created.item.id;
    const staged = (await (
      await call("POST", `/api/me/items/${id}/stage`, cookie, { stage: "owned", at: AT, amountCents: 4200 })
    ).json()) as MutationResult;
    expect(staged.undo?.ops).toEqual([
      { ids: [id], op: "stage", stage: "spotted", at: created.item.createdAt },
      { ids: [id], op: "setFields", fields: { pricePaidCents: null } },
    ]);
    await undo(cookie, staged.undo);
    expect((await rowsOf([id]))[0]).toMatchObject({ stage: "spotted", pricePaidCents: null });
    expect(await eventsOf([id])).toEqual([]);

    const patched = (await (
      await call("PATCH", `/api/me/items/${id}`, cookie, { notes: "Doux", sizeLabel: "S", favorite: true })
    ).json()) as MutationResult;
    expect(patched.undo).toEqual({
      ops: [{ ids: [id], op: "setFields", fields: { notes: null, sizeLabel: null } }],
      removeEventIds: [],
    });
    await undo(cookie, patched.undo);
    expect((await rowsOf([id]))[0]).toMatchObject({ notes: null, sizeLabel: null, favorite: true });

    await undo(cookie, created.undo);
    expect((await rowsOf([id]))[0]?.deletedAt).not.toBeNull();
  });
});
