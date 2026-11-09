import { randomUUID } from "node:crypto";
import { eq, schema } from "@closyria/db";
import type { ItemMutationResult, ItemView, SharedWishlistView, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";
import { joinGiverNames } from "../../wardrobe/gifts";
import { parisDay } from "../../wardrobe/wishlists";

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

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

/** One more item of hers (size 38), on the list when `list` is given. */
async function addItem(cookie: string, userId: string, profileId: string, listId?: string) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique MG${k}`, slug: `me-mg-shop-${k}` })
    .returning();
  const [product] = await t.db
    .insert(schema.products)
    .values({
      shopId: shop?.id as string,
      canonicalUrl: `https://me-mg-${k}.test/p`,
      name: `Robe ${k}`,
      priceCents: 4990,
      currency: "EUR",
    })
    .returning();
  const [item] = await t.db
    .insert(schema.items)
    .values({ userId, profileId, productId: product?.id as string, sizeLabel: "38" })
    .returning();
  if (!item) throw new Error("no item");
  if (listId)
    expect((await call("POST", `/api/me/wishlists/${listId}/items`, cookie, { itemId: item.id })).status).toBe(200);
  return item;
}

/** A shared list open to gifts with one item. */
async function setup(settings: Partial<typeof schema.wishlists.$inferInsert> = { allowGifts: true }) {
  const { cookie, userId } = await t.signIn();
  const list = (await (
    await call("POST", "/api/me/wishlists", cookie, { name: "Anniversaire" })
  ).json()) as WishlistView;
  const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const profileId = (profiles.profiles[0] as { id: string }).id;
  const item = await addItem(cookie, userId, profileId, list.id);
  const share = await call("POST", `/api/me/wishlists/${list.id}/share`, cookie);
  const token = ((await share.json()) as { url: string }).url.slice("/l/".length);
  if (Object.keys(settings).length > 0)
    await t.db.update(schema.wishlists).set(settings).where(eq(schema.wishlists.id, list.id));
  return { cookie, userId, profileId, list, item, token };
}

const giftPath = (token: string, itemId: string) => `/api/shared/${token}/items/${itemId}/gift`;
const friend = (method: "PUT" | "DELETE", token: string, itemId: string, body: unknown) =>
  t.app.request(giftPath(token, itemId), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
  });
const lea = { name: "Léa", deviceKey: keyLea };
const ines = { name: "Inès", deviceKey: keyInes };
const reserve = (token: string, itemId: string, who: object) =>
  friend("PUT", token, itemId, { ...who, intent: "reserve" });
const join = (token: string, itemId: string, who: object) => friend("PUT", token, itemId, { ...who, intent: "join" });

async function publicView(token: string, deviceKey?: string) {
  const res = await t.app.request(`/api/shared/${token}`, {
    headers: deviceKey === undefined ? {} : { "x-device-key": deviceKey },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as SharedWishlistView;
}
const giftRowsOfItem = (itemId: string) =>
  t.db.select().from(schema.wishlistGifts).where(eq(schema.wishlistGifts.itemId, itemId));

async function giftCheck(cookie: string, ids: string[]) {
  const res = await call("GET", `/api/me/items/gift-check?ids=${ids.join(",")}`, cookie);
  expect(res.status).toBe(200);
  return { text: await res.text() };
}
const reservedOf = async (cookie: string, ids: string[]) =>
  (JSON.parse((await giftCheck(cookie, ids)).text) as { reserved: string[] }).reserved;

async function listView(cookie: string, listId: string) {
  const res = await call("GET", "/api/me/wishlists", cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { wishlists: WishlistView[] }).wishlists.find((w) => w.id === listId);
}

/** `YYYY-MM-DD` shifted by `days` (calendar arithmetic, no time zone). */
const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe("gift settings on her list", () => {
  it("saves the occasion and the date, refuses a web address, clears with null", async () => {
    const s = await setup({});
    const res = await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, {
      allowGifts: true,
      giftOccasion: "mon anniversaire",
      giftDate: "2027-03-12",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      allowGifts: true,
      giftOccasion: "mon anniversaire",
      giftDate: "2027-03-12",
      giftReminderDue: false,
    });
    expect(await listView(s.cookie, s.list.id)).toMatchObject({
      allowGifts: true,
      giftOccasion: "mon anniversaire",
      giftDate: "2027-03-12",
    });
    const web = await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { giftOccasion: "chez zara.com" });
    expect(web.status).toBe(400);
    expect((await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { giftDate: "12/03/2027" })).status).toBe(
      400,
    );
    expect(
      (await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { giftOccasion: "x".repeat(41) })).status,
    ).toBe(400);
    const cleared = await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, {
      giftOccasion: null,
      giftDate: null,
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ allowGifts: true, giftOccasion: null, giftDate: null });
  });
});

describe("gift check", () => {
  it("lists only the reserved items, as ids", async () => {
    const s = await setup();
    const free = await addItem(s.cookie, s.userId, s.profileId, s.list.id);
    const offList = await addItem(s.cookie, s.userId, s.profileId, s.list.id);
    expect((await reserve(s.token, s.item.id, lea)).status).toBe(200);
    expect((await reserve(s.token, offList.id, lea)).status).toBe(200);
    expect((await call("DELETE", `/api/me/wishlists/${s.list.id}/items/${offList.id}`, s.cookie)).status).toBeLessThan(
      300,
    );
    const { text } = await giftCheck(s.cookie, [free.id, s.item.id, offList.id]);
    expect(JSON.parse(text)).toEqual({ reserved: [s.item.id] });
    expect(text).not.toContain("Léa");
    // Another account's item is never reported.
    const other = await t.signIn();
    expect(await reservedOf(other.cookie, [s.item.id])).toEqual([]);
  });

  it("forgets a list closed to gifts or no longer shared", async () => {
    const s = await setup();
    await reserve(s.token, s.item.id, lea);
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([s.item.id]);
    await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { allowGifts: false });
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([]);
    await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { allowGifts: true });
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([s.item.id]);
    expect((await call("DELETE", `/api/me/wishlists/${s.list.id}/share`, s.cookie)).status).toBe(204);
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([]);
  });

  it("refuses malformed or too many ids", async () => {
    const s = await setup();
    expect((await call("GET", "/api/me/items/gift-check?ids=nope", s.cookie)).status).toBe(400);
    expect((await call("GET", "/api/me/items/gift-check", s.cookie)).status).toBe(400);
    const many = Array.from({ length: 201 }, () => randomUUID()).join(",");
    expect((await call("GET", `/api/me/items/gift-check?ids=${many}`, s.cookie)).status).toBe(400);
    expect((await call("GET", `/api/me/items/gift-check?ids=${s.item.id}`, undefined)).status).toBe(401);
  });
});

describe("« Je le prends quand même »", () => {
  it("shows « pris elle-même » on the link and the check forgets it", async () => {
    const s = await setup();
    await reserve(s.token, s.item.id, lea);
    const res = await call("POST", "/api/me/items/gift-took", s.cookie, { ids: [s.item.id] });
    expect(res.status).toBe(204);
    expect((await publicView(s.token)).items.find((i) => i.itemId === s.item.id)?.gift).toMatchObject({
      state: "owner_took",
      givers: ["Léa"],
    });
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([]);
    // Another account cannot mark her items.
    const other = await setup();
    await reserve(other.token, other.item.id, lea);
    expect((await call("POST", "/api/me/items/gift-took", s.cookie, { ids: [other.item.id] })).status).toBe(204);
    expect((await giftRowsOfItem(other.item.id))[0]?.ownerTookAt).toBeNull();
    expect((await call("POST", "/api/me/items/gift-took", s.cookie, { ids: [] })).status).toBe(400);
  });
});

describe("« Reçu en cadeau »", () => {
  it("freezes the givers' names, ends the gifts, and the undo brings everything back", async () => {
    const s = await setup();
    await reserve(s.token, s.item.id, lea);
    await join(s.token, s.item.id, ines);
    const res = await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ItemMutationResult;
    expect(body.item).toMatchObject({ stage: "owned", giftFrom: "Léa et Inès" });
    expect(body.undo?.ops.at(-1)).toEqual({ ids: [s.item.id], op: "unreceiveGift" });
    // The undo never carries a name.
    expect(JSON.stringify(body.undo)).not.toMatch(/Léa|Inès/);
    const rows = await giftRowsOfItem(s.item.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.receivedAt !== null)).toBe(true);
    const item = (await (await call("GET", `/api/me/items/${s.item.id}`, s.cookie)).json()) as ItemView;
    expect(item.giftFrom).toBe("Léa et Inès");
    // On the link: under « Déjà offerts », no longer offered, even to its former givers.
    const seen = await publicView(s.token, keyLea);
    expect(seen.givenItems).toHaveLength(1);
    expect(seen.items.find((i) => i.itemId === s.item.id)).toBeUndefined();
    expect((await reserve(s.token, s.item.id, lea)).status).toBe(404);
    await friend("DELETE", s.token, s.item.id, lea);
    expect((await giftRowsOfItem(s.item.id)).every((r) => r.receivedAt !== null)).toBe(true);
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([]);
    // Again: a gift already.
    expect((await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie)).status).toBe(400);

    const undo = await call("POST", "/api/me/items/undo", s.cookie, body.undo);
    expect(undo.status).toBe(200);
    const back = (await (await call("GET", `/api/me/items/${s.item.id}`, s.cookie)).json()) as ItemView;
    expect(back).toMatchObject({ stage: "spotted", giftFrom: null });
    const restored = await giftRowsOfItem(s.item.id);
    expect(restored.map((r) => [r.giverName, r.role, r.receivedAt]).sort()).toEqual([
      ["Inès", "contributor", null],
      ["Léa", "reserver", null],
    ]);
    expect((await publicView(s.token)).items.find((i) => i.itemId === s.item.id)?.gift).toMatchObject({
      state: "reserved",
      reserver: "Léa",
      contributors: ["Inès"],
    });
    expect(await reservedOf(s.cookie, [s.item.id])).toEqual([s.item.id]);
    const events = await t.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, s.item.id));
    expect(events).toHaveLength(0);
  });

  it("says « une amie » (null) when nobody had planned it, and ends gifts on every list", async () => {
    const s = await setup();
    const res = await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ItemMutationResult).item).toMatchObject({ stage: "owned", giftFrom: null });

    const two = await setup();
    const second = (await (
      await call("POST", "/api/me/wishlists", two.cookie, { name: "Noël" })
    ).json()) as WishlistView;
    await call("POST", `/api/me/wishlists/${second.id}/items`, two.cookie, { itemId: two.item.id });
    const share = await call("POST", `/api/me/wishlists/${second.id}/share`, two.cookie);
    const token2 = ((await share.json()) as { url: string }).url.slice("/l/".length);
    await t.db.update(schema.wishlists).set({ allowGifts: true }).where(eq(schema.wishlists.id, second.id));
    await reserve(two.token, two.item.id, ines);
    await reserve(token2, two.item.id, { name: "Sarah", deviceKey: "S".repeat(22) });
    await join(token2, two.item.id, lea);
    const got = await call("POST", `/api/me/items/${two.item.id}/received-as-gift`, two.cookie);
    expect(((await got.json()) as ItemMutationResult).item.giftFrom).toBe("Inès, Sarah et Léa");
    expect((await giftRowsOfItem(two.item.id)).every((r) => r.receivedAt !== null)).toBe(true);
  });

  it("lets friends give it again once she puts it back, without the old gifts in the way", async () => {
    const s = await setup();
    await reserve(s.token, s.item.id, lea);
    const first = (await (
      await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie)
    ).json()) as ItemMutationResult;
    const at = new Date().toISOString();
    expect((await call("POST", `/api/me/items/${s.item.id}/stage`, s.cookie, { stage: "spotted", at })).status).toBe(
      200,
    );
    // The received row does not block the same person, nor a new reserver.
    expect((await reserve(s.token, s.item.id, lea)).status).toBe(200);
    // A late undo of the first one leaves the new gift alone (the old row stays over).
    expect((await call("POST", "/api/me/items/undo", s.cookie, { ...first.undo, removeEventIds: [] })).status).toBe(
      200,
    );
    const rows = await giftRowsOfItem(s.item.id);
    expect(rows.filter((r) => r.receivedAt === null)).toHaveLength(1);
    const again = await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie);
    expect(((await again.json()) as ItemMutationResult).item.giftFrom).toBe("Léa");
    // Only this reception's rows are kept, for its undo.
    expect(await giftRowsOfItem(s.item.id)).toHaveLength(1);
  });

  it("404 for another account's item, 409 in the trash", async () => {
    const s = await setup();
    const other = await t.signIn();
    expect((await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, other.cookie)).status).toBe(404);
    expect((await call("DELETE", `/api/me/items/${s.item.id}`, s.cookie)).status).toBe(200);
    expect((await call("POST", `/api/me/items/${s.item.id}/received-as-gift`, s.cookie)).status).toBe(409);
  });

  it("joins the names as « et »", () => {
    expect(joinGiverNames([])).toBeNull();
    expect(joinGiverNames(["Léa"])).toBe("Léa");
    expect(joinGiverNames(["Léa", "Inès"])).toBe("Léa et Inès");
    expect(joinGiverNames(["Léa", "Inès", "Sarah"])).toBe("Léa, Inès et Sarah");
  });
});

describe("nothing leaks to her", () => {
  it("keeps the changes stamp and her views free of her friends' gifts", async () => {
    const s = await setup();
    await call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, { giftOccasion: "mon anniversaire" });
    const stamp = async () =>
      ((await (await call("GET", "/api/me/changes", s.cookie)).json()) as { stamp: string }).stamp;
    const before = await stamp();
    await reserve(s.token, s.item.id, lea);
    expect(await stamp()).toBe(before);
    await join(s.token, s.item.id, ines);
    expect(await stamp()).toBe(before);
    await friend("DELETE", s.token, s.item.id, ines);
    expect(await stamp()).toBe(before);

    const allowed = new Set(["allowGifts", "giftOccasion", "giftDate", "giftReminderDue", "giftFrom"]);
    for (const path of ["/api/me/wishlists", "/api/me/items", `/api/me/items/${s.item.id}`]) {
      const res = await call("GET", path, s.cookie);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text, path).not.toContain("Léa");
      expect(text, path).not.toContain("reserv");
      const words = [...text.matchAll(/[A-Za-z_]*gift[A-Za-z_]*/gi)].map((m) => m[0]);
      expect(
        words.filter((w) => !allowed.has(w)),
        path,
      ).toEqual([]);
    }
  });
});

describe("reminder after the occasion", () => {
  const today = () => parisDay(new Date());

  it("is due from the day after, until « Plus tard » or « C'est fait », and a new date forgets them", async () => {
    const s = await setup();
    const patch = (body: object) => call("PATCH", `/api/me/wishlists/${s.list.id}`, s.cookie, body);
    const due = async () => (await listView(s.cookie, s.list.id))?.giftReminderDue;
    expect(await due()).toBe(false);
    await patch({ giftDate: today() });
    expect(await due()).toBe(false);
    await patch({ giftDate: shiftDay(today(), -1) });
    expect(await due()).toBe(true);
    // Closed to gifts: no reminder.
    await patch({ allowGifts: false });
    expect(await due()).toBe(false);
    await patch({ allowGifts: true });

    const remind = (action: string) =>
      call("POST", `/api/me/wishlists/${s.list.id}/gift-reminder`, s.cookie, { action });
    expect((await remind("snooze")).status).toBe(204);
    expect(await due()).toBe(false);
    const [row] = await t.db.select().from(schema.wishlists).where(eq(schema.wishlists.id, s.list.id));
    const days = ((row?.giftReminderSnoozedUntil?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    // The same date again forgets nothing.
    await patch({ giftDate: shiftDay(today(), -1) });
    expect(await due()).toBe(false);
    // Seven days later it is back.
    await t.db
      .update(schema.wishlists)
      .set({ giftReminderSnoozedUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.wishlists.id, s.list.id));
    expect(await due()).toBe(true);

    expect((await remind("dismiss")).status).toBe(204);
    expect(await due()).toBe(false);
    await patch({ giftDate: shiftDay(today(), -2) });
    expect(await due()).toBe(true);
    const [reset] = await t.db.select().from(schema.wishlists).where(eq(schema.wishlists.id, s.list.id));
    expect(reset).toMatchObject({ giftReminderDismissedAt: null, giftReminderSnoozedUntil: null });

    expect((await remind("later")).status).toBe(400);
    const other = await t.signIn();
    expect(
      (await call("POST", `/api/me/wishlists/${s.list.id}/gift-reminder`, other.cookie, { action: "dismiss" })).status,
    ).toBe(404);
  });
});
