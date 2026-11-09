import { randomUUID } from "node:crypto";
import { eq, schema } from "@closyria/db";
import type { SharedWishlistView, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

const keyLea = "L".repeat(22);
const keyInes = "I".repeat(22);
const keyOther = "O".repeat(22);

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

/** A shared list with one item (size 38), open to gifts unless said otherwise. */
async function setup(settings: Partial<typeof schema.wishlists.$inferInsert> = { allowGifts: true }) {
  const { cookie, userId } = await t.signIn();
  const k = ++counter;
  const list = (await (
    await call("POST", "/api/me/wishlists", cookie, { name: "Anniversaire" })
  ).json()) as WishlistView;
  const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const profile = profiles.profiles[0] as { id: string };
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique G${k}`, slug: `gifts-shop-${k}` })
    .returning();
  const [product] = await t.db
    .insert(schema.products)
    .values({
      shopId: shop?.id as string,
      canonicalUrl: `https://gifts-${k}.test/p`,
      name: `Robe ${k}`,
      priceCents: 4990,
      currency: "EUR",
    })
    .returning();
  const [item] = await t.db
    .insert(schema.items)
    .values({ userId, profileId: profile.id, productId: product?.id as string, sizeLabel: "38" })
    .returning();
  if (!item) throw new Error("no item");
  expect((await call("POST", `/api/me/wishlists/${list.id}/items`, cookie, { itemId: item.id })).status).toBe(200);
  const share = await call("POST", `/api/me/wishlists/${list.id}/share`, cookie);
  const token = ((await share.json()) as { url: string }).url.slice("/l/".length);
  if (Object.keys(settings).length > 0)
    await t.db.update(schema.wishlists).set(settings).where(eq(schema.wishlists.id, list.id));
  return { cookie, userId, list, item, token };
}

const giftPath = (token: string, itemId: string) => `/api/shared/${token}/items/${itemId}/gift`;
const putGift = (token: string, itemId: string, body: unknown, ip = "1.1.1.1") =>
  t.app.request(giftPath(token, itemId), {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
const delGift = (token: string, itemId: string, body: unknown, ip = "1.1.1.1") =>
  t.app.request(giftPath(token, itemId), {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
const lea = { name: "Léa", deviceKey: keyLea };
const ines = { name: "Inès", deviceKey: keyInes };
const reserve = (who: object) => ({ ...who, intent: "reserve" });
const join = (who: object) => ({ ...who, intent: "join" });

async function view(token: string, deviceKey?: string) {
  const res = await t.app.request(`/api/shared/${token}`, {
    headers: deviceKey === undefined ? {} : { "x-device-key": deviceKey },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SharedWishlistView;
}
const itemOf = (v: SharedWishlistView, itemId: string) => v.items.find((i) => i.itemId === itemId);
const giftRowsOf = (listId: string) =>
  t.db.select().from(schema.wishlistGifts).where(eq(schema.wishlistGifts.wishlistId, listId));

describe("gifts on a shared list", () => {
  it("refuses when the list is closed to gifts, 404 when the share stopped", async () => {
    const closed = await setup({});
    const res = await putGift(closed.token, closed.item.id, reserve(lea));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "gifts_closed" });
    const s = await setup();
    expect((await call("DELETE", `/api/me/wishlists/${s.list.id}/share`, s.cookie)).status).toBe(204);
    expect((await putGift(s.token, s.item.id, reserve(lea))).status).toBe(404);
    expect((await delGift(s.token, s.item.id, lea)).status).toBe(404);
    expect((await putGift(s.token, randomUUID(), reserve(lea))).status).toBe(404);
  });

  it("reserves, then a second friend contributes; mine follows the device key", async () => {
    const s = await setup();
    const res = await putGift(s.token, s.item.id, reserve(lea));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "reserver" });
    expect(itemOf(await view(s.token, keyLea), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Léa",
      contributors: [],
      mine: { role: "reserver", name: "Léa" },
    });
    expect(itemOf(await view(s.token), s.item.id)?.gift).toMatchObject({ state: "reserved", mine: null });
    const second = await putGift(s.token, s.item.id, join(ines));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ role: "contributor" });
    expect(itemOf(await view(s.token, keyInes), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Léa",
      contributors: ["Inès"],
      mine: { role: "contributor", name: "Inès" },
    });
  });

  it("ignores a malformed device key on the view", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    expect(itemOf(await view(s.token, "nope!"), s.item.id)?.gift).toMatchObject({ state: "reserved", mine: null });
  });

  it("lets exactly one of two simultaneous friends reserve; the other learns who, then joins", async () => {
    const s = await setup();
    const res = await Promise.all([
      putGift(s.token, s.item.id, reserve(lea), "2.2.2.2"),
      putGift(s.token, s.item.id, reserve(ines), "2.2.2.3"),
    ]);
    const statuses = res.map((r) => r.status);
    expect([...statuses].sort()).toEqual([200, 409]);
    const first = statuses.indexOf(200);
    expect(await res[first]?.json()).toEqual({ role: "reserver" });
    expect(await res[1 - first]?.json()).toEqual({ error: "already_reserved", reserver: first === 0 ? "Léa" : "Inès" });
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
    const late = first === 0 ? ines : lea;
    const joined = await putGift(s.token, s.item.id, join(late));
    expect(joined.status).toBe(200);
    expect(await joined.json()).toEqual({ role: "contributor" });
    expect((await giftRowsOf(s.list.id)).filter((r) => r.role === "reserver")).toHaveLength(1);
  });

  it("makes « Je participe » on a free item a reservation", async () => {
    const s = await setup();
    const res = await putGift(s.token, s.item.id, join(ines));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "reserver" });
  });

  it("hands the gift to the oldest of two contributors when the reserver leaves", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    await putGift(s.token, s.item.id, join(ines));
    await putGift(s.token, s.item.id, join({ name: "Sarah", deviceKey: keyOther }));
    expect((await delGift(s.token, s.item.id, lea)).status).toBe(204);
    expect(itemOf(await view(s.token, keyInes), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Inès",
      contributors: ["Sarah"],
      mine: { role: "reserver", name: "Inès" },
    });
  });

  it("hands the gift to the oldest contributor when the reserver leaves, then frees it", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    await putGift(s.token, s.item.id, join(ines));
    expect((await delGift(s.token, s.item.id, lea)).status).toBe(204);
    expect(itemOf(await view(s.token, keyInes), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Inès",
      contributors: [],
      mine: { role: "reserver", name: "Inès" },
    });
    expect((await delGift(s.token, s.item.id, ines)).status).toBe(204);
    expect(itemOf(await view(s.token), s.item.id)?.gift).toEqual({ state: "free" });
  });

  it("keeps one person per name: another key needs claim", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    const taken = await putGift(s.token, s.item.id, reserve({ ...lea, deviceKey: keyOther }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "name_taken" });
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
    const claimed = await putGift(s.token, s.item.id, reserve({ ...lea, deviceKey: keyOther, claim: true }));
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ role: "reserver" });
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
  });

  it("says when there is nothing to take back under that name", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    // Inès's device is attached to her name (an opinion or another gift), but she gives nothing here.
    await putGift(s.token, s.item.id, join(ines));
    expect((await delGift(s.token, s.item.id, ines)).status).toBe(204);
    const res = await delGift(s.token, s.item.id, ines);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_gift" });
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
  });

  it("forbids another key to take back Léa's gift", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    const res = await delGift(s.token, s.item.id, { ...lea, deviceKey: keyOther });
    expect(res.status).toBe(403);
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
  });

  it("shows an item taken off the list only to its givers, and brings it back when she puts it back", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    expect((await call("DELETE", `/api/me/wishlists/${s.list.id}/items/${s.item.id}`, s.cookie)).status).toBe(200);
    expect(itemOf(await view(s.token, keyLea), s.item.id)?.gift).toEqual({
      state: "removed",
      mine: { role: "reserver", name: "Léa" },
    });
    expect(itemOf(await view(s.token), s.item.id)).toBeUndefined();
    expect(itemOf(await view(s.token, keyInes), s.item.id)).toBeUndefined();
    expect((await putGift(s.token, s.item.id, join(ines))).status).toBe(404);
    expect((await call("POST", `/api/me/wishlists/${s.list.id}/items`, s.cookie, { itemId: s.item.id })).status).toBe(
      200,
    );
    expect(itemOf(await view(s.token), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Léa",
      contributors: [],
      mine: null,
    });
    expect(await giftRowsOf(s.list.id)).toHaveLength(1);
  });

  it("lets a giver leave an item taken off the list", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    await call("DELETE", `/api/me/wishlists/${s.list.id}/items/${s.item.id}`, s.cookie);
    expect((await delGift(s.token, s.item.id, lea)).status).toBe(204);
    expect(itemOf(await view(s.token, keyLea), s.item.id)).toBeUndefined();
    expect(await giftRowsOf(s.list.id)).toHaveLength(0);
  });

  it("marks the gifts when the item leaves the list in bulk, and clears it on undo", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    const res = await call("POST", "/api/me/items/bulk", s.cookie, {
      op: "removeFromList",
      ids: [s.item.id],
      wishlistId: s.list.id,
    });
    expect(res.status).toBe(200);
    expect((await giftRowsOf(s.list.id))[0]?.itemRemovedAt).not.toBeNull();
    expect(itemOf(await view(s.token, keyLea), s.item.id)?.gift).toEqual({
      state: "removed",
      mine: { role: "reserver", name: "Léa" },
    });
    const back = await call("POST", "/api/me/items/bulk", s.cookie, {
      op: "addToList",
      ids: [s.item.id],
      wishlistId: s.list.id,
    });
    expect(back.status).toBe(200);
    expect((await giftRowsOf(s.list.id))[0]?.itemRemovedAt).toBeNull();
  });

  it("hides an item in the trash from everyone, and the reservation comes back on restore", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    expect((await call("DELETE", `/api/me/items/${s.item.id}`, s.cookie)).status).toBe(200);
    expect(itemOf(await view(s.token, keyLea), s.item.id)).toBeUndefined();
    expect(itemOf(await view(s.token), s.item.id)).toBeUndefined();
    expect((await putGift(s.token, s.item.id, join(ines))).status).toBe(404);
    expect((await call("POST", `/api/me/items/${s.item.id}/restore`, s.cookie)).status).toBe(200);
    expect(itemOf(await view(s.token, keyLea), s.item.id)?.gift).toEqual({
      state: "reserved",
      reserver: "Léa",
      contributors: [],
      mine: { role: "reserver", name: "Léa" },
    });
  });

  it("shows the size and the gift state only when the list is open to gifts", async () => {
    const s = await setup({ allowGifts: true, giftOccasion: "ses 30 ans", giftDate: "2026-12-12" });
    const open = await view(s.token);
    expect(open.gifts).toEqual({ open: true, occasion: "ses 30 ans", date: "2026-12-12" });
    expect(itemOf(open, s.item.id)).toMatchObject({ size: "38", gift: { state: "free" } });
    await t.db.update(schema.wishlists).set({ allowGifts: false }).where(eq(schema.wishlists.id, s.list.id));
    const closed = await view(s.token);
    expect(closed.gifts).toEqual({ open: false, occasion: null, date: null });
    expect(itemOf(closed, s.item.id)).toMatchObject({ size: null, gift: null });
    expect(closed.givenItems).toEqual([]);
  });

  it("refuses a new giver once she took the item herself", async () => {
    const s = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    await t.db
      .update(schema.wishlistGifts)
      .set({ ownerTookAt: new Date() })
      .where(eq(schema.wishlistGifts.wishlistId, s.list.id));
    const res = await putGift(s.token, s.item.id, join(ines));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "owner_took" });
    expect(itemOf(await view(s.token, keyLea), s.item.id)?.gift).toEqual({
      state: "owner_took",
      givers: ["Léa"],
      mine: { role: "reserver", name: "Léa" },
    });
  });

  it("hides every gift from the owner reading her own link in her session, even with a giver's device key", async () => {
    const s = await setup();
    const other = await setup();
    await putGift(s.token, s.item.id, reserve(lea));
    await putGift(s.token, s.item.id, join(ines));
    await putGift(other.token, other.item.id, reserve(lea));
    for (const deviceKey of [undefined, keyLea]) {
      const res = await t.app.request(`/api/shared/${s.token}`, {
        headers: { cookie: s.cookie, ...(deviceKey ? { "x-device-key": deviceKey } : {}) },
      });
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toContain("Léa");
      expect(raw).not.toContain("Inès");
      const seen = JSON.parse(raw) as SharedWishlistView;
      expect(seen.viewerIsOwner).toBe(true);
      expect(seen.items.map((i) => i.gift)).toEqual([{ state: "hidden" }]);
    }
    // She took it herself: still nothing said, no « pris elle-même ».
    await t.db
      .update(schema.wishlistGifts)
      .set({ ownerTookAt: new Date() })
      .where(eq(schema.wishlistGifts.wishlistId, s.list.id));
    const took = (await (
      await t.app.request(`/api/shared/${s.token}`, { headers: { cookie: s.cookie } })
    ).json()) as SharedWishlistView;
    expect(took.items.map((i) => i.gift)).toEqual([{ state: "hidden" }]);
    // Another user's session, or none: a friend's view.
    const stranger = await t.app.request(`/api/shared/${s.token}`, { headers: { cookie: other.cookie } });
    const seenByStranger = (await stranger.json()) as SharedWishlistView;
    expect(seenByStranger.viewerIsOwner).toBe(false);
    expect(itemOf(seenByStranger, s.item.id)?.gift).toMatchObject({ state: "owner_took", givers: ["Léa", "Inès"] });
    expect((await view(s.token)).viewerIsOwner).toBe(false);
  });

  it("limits to 30 gift actions an hour per key and list", async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) {
      const res =
        i % 2 === 0 ? await putGift(s.token, s.item.id, reserve(lea)) : await delGift(s.token, s.item.id, lea);
      expect(res.status).toBe(i % 2 === 0 ? 200 : 204);
    }
    const limited = await putGift(s.token, s.item.id, reserve(lea));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await delGift(s.token, s.item.id, lea)).status).toBe(429);
  });
});
