import { and, eq, schema } from "@closyria/db";
import { type OwnerGroupOrder, opinionNameKey, type SharedWishlistView, type WishlistView } from "@closyria/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
/** The injected clock: real time unless a test sets it (and puts it back). */
let clock: Date | null = null;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => clock ?? new Date() });
}, 60_000);

afterEach(() => {
  clock = null;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

const keyLea = "L".repeat(22);
const keyInes = "I".repeat(22);
const keyOther = "O".repeat(22);
const lea = { name: "Léa", deviceKey: keyLea };
const ines = { name: "Inès", deviceKey: keyInes };

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

/** A friend's request on the shared link (no session). */
function friend(method: string, path: string, body: unknown, ip = "2.2.2.2") {
  return t.app.request(path, {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

async function newShop(label: string) {
  const k = ++counter;
  const domain = `ge-shop-${k}.test`;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `${label} ${k}`, slug: `ge-shop-${k}` })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ domain, shopId: shop.id });
  return { ...shop, domain };
}

async function newProduct(shop: { id: string; domain: string }, priceCents: number | null, currency = "EUR") {
  const k = ++counter;
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://${shop.domain}/p/${k}`, name: `Robe ${k}`, priceCents, currency })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

/** A shared list with A (30 €) and B (20 €) at `shop`, C at `other`, and an open group order at `shop`. */
async function setup(deadline: string | null = null) {
  const { cookie, userId } = await t.signIn();
  const list = (await (await call("POST", "/api/me/wishlists", cookie, { name: "Été" })).json()) as WishlistView;
  const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const profileId = (profiles.profiles[0] as { id: string }).id;
  const shop = await newShop("Boutique");
  const other = await newShop("Autre");
  const pA = await newProduct(shop, 3000);
  const pB = await newProduct(shop, 2000);
  const pC = await newProduct(other, 1000);
  const items = await t.db
    .insert(schema.items)
    .values([pA, pB, pC].map((p) => ({ userId, profileId, productId: p.id, sizeLabel: "38" })))
    .returning();
  const [itemA, itemB, itemC] = [pA, pB, pC].map((p) => items.find((i) => i.productId === p.id)) as [
    (typeof items)[number],
    (typeof items)[number],
    (typeof items)[number],
  ];
  for (const item of [itemA, itemB, itemC])
    expect((await call("POST", `/api/me/wishlists/${list.id}/items`, cookie, { itemId: item.id })).status).toBe(200);
  const share = await call("POST", `/api/me/wishlists/${list.id}/share`, cookie);
  const token = ((await share.json()) as { url: string }).url.slice("/l/".length);
  const opened = await call("POST", `/api/me/wishlists/${list.id}/group-order`, cookie, {
    shopId: shop.id,
    shipping: { label: "Colissimo", shippingCents: 600, freeFromCents: null },
    deadline,
  });
  expect(opened.status).toBe(201);
  const order = (await opened.json()) as OwnerGroupOrder;
  return { cookie, userId, list, token, shop, other, pA, pB, pC, itemA, itemB, itemC, order };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const linesPath = (s: Setup) => `/api/shared/${s.token}/group-order/lines`;
const addLine = (s: Setup, body: unknown, ip?: string) => friend("POST", linesPath(s), body, ip);
const patchLine = (s: Setup, lineId: string, body: unknown, ip?: string) =>
  friend("PATCH", `${linesPath(s)}/${lineId}`, body, ip);
const deleteLine = (s: Setup, lineId: string, body: unknown, ip?: string) =>
  friend("DELETE", `${linesPath(s)}/${lineId}`, body, ip);
const manual = (who: object, n = 1) => ({
  source: "manual",
  manualName: `Sac ${n}`,
  manualPriceCents: 1500,
  sizeLabel: null,
  quantity: 1,
  ...who,
});

async function added(res: Response) {
  expect(res.status).toBe(201);
  return ((await res.json()) as { lineId: string }).lineId;
}

async function groupOrderOf(s: Setup, deviceKey?: string) {
  const res = await t.app.request(`/api/shared/${s.token}`, {
    headers: deviceKey === undefined ? {} : { "x-device-key": deviceKey },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as SharedWishlistView).groupOrder;
}

const linesOf = (orderId: string) =>
  t.db.select().from(schema.groupOrderLines).where(eq(schema.groupOrderLines.groupOrderId, orderId));

describe("the group order on the shared link", () => {
  it("adds a line from an item of the list; everyone sees it, only her device sees her share", async () => {
    const s = await setup();
    const lineId = await added(
      await addLine(s, { source: "item", itemId: s.itemA.id, sizeLabel: "38", quantity: 2, ...lea }),
    );
    const [row] = await linesOf(s.order.id);
    expect(row).toMatchObject({ id: lineId, itemId: s.itemA.id, productId: s.pA.id, buyerName: "Léa", quantity: 2 });
    expect(row?.manualName).not.toBeNull();

    const seen = await groupOrderOf(s);
    expect(seen).toMatchObject({
      id: s.order.id,
      shopName: s.shop.name,
      status: "open",
      locked: false,
      currency: "EUR",
      shipping: { label: "Colissimo", shippingCents: 600, freeFromCents: null },
      totals: { totalCents: 6000, remainingForFreeCents: null, shippingTotalCents: 600 },
      mine: null,
      orderedAt: null,
    });
    expect(seen?.people).toEqual([
      {
        name: "Léa",
        isOwner: false,
        lines: [
          {
            id: lineId,
            itemId: s.itemA.id,
            name: expect.any(String),
            imageUrl: null,
            sizeLabel: "38",
            quantity: 2,
            unitPriceCents: 3000,
            status: "ready",
          },
        ],
      },
    ]);
    expect(seen?.eligibleItemIds.sort()).toEqual([s.itemA.id, s.itemB.id].sort());
    // Known sizes of the eligible items only, in the shop's order; none for an item without sizes.
    expect(seen?.itemSizes).toEqual({});
    await t.db.insert(schema.productSizes).values([
      { productId: s.pA.id, label: "40", position: 1, available: true },
      { productId: s.pA.id, label: "38", position: 0, available: false },
      { productId: s.pC.id, label: "S", position: 0, available: true },
    ]);
    expect((await groupOrderOf(s))?.itemSizes).toEqual({ [s.itemA.id]: ["38", "40"] });

    expect((await groupOrderOf(s, keyLea))?.mine).toEqual({
      name: "Léa",
      lineIds: [lineId],
      itemsCents: 6000,
      shippingCents: 600,
      totalCents: 6600,
      provisional: true,
      paidAt: null,
      removedLines: [],
    });
    expect((await groupOrderOf(s, keyOther))?.mine).toBeNull();
    expect((await groupOrderOf(s, "nope!"))?.mine).toBeNull();
  });

  it("refuses an item of another shop or not on the list (not_eligible)", async () => {
    const s = await setup();
    const res = await addLine(s, { source: "item", itemId: s.itemC.id, sizeLabel: null, quantity: 1, ...lea });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "not_eligible" });
    expect(await linesOf(s.order.id)).toEqual([]);
  });

  it("a link of the same shop: product created, capture asked by nobody, line « reading »", async () => {
    const s = await setup();
    const url = `https://${s.shop.domain}/robe-nouvelle`;
    const before = t.calls.length;
    const lineId = await added(await addLine(s, { source: "url", url, sizeLabel: "M", quantity: 1, ...lea }));
    const [product] = await t.db.select().from(schema.products).where(eq(schema.products.canonicalUrl, url));
    expect(product?.shopId).toBe(s.shop.id);
    const captures = await t.db
      .select()
      .from(schema.captures)
      .where(eq(schema.captures.productId, product?.id ?? ""));
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({ requestedBy: null, trigger: "user", status: "queued" });
    expect(t.calls.slice(before)).toEqual([{ queue: "capture-user", id: captures[0]?.id }]);
    const [row] = await linesOf(s.order.id);
    expect(row).toMatchObject({ id: lineId, productId: product?.id, url, itemId: null });
    const line = (await groupOrderOf(s))?.people[0]?.lines[0];
    expect(line).toMatchObject({ id: lineId, status: "reading", unitPriceCents: null, sizeLabel: "M" });
  });

  it("a known product of another currency is refused (currency_mismatch)", async () => {
    const s = await setup();
    const usd = await newProduct(s.shop, 4000, "USD");
    const res = await addLine(s, { source: "url", url: usd.canonicalUrl, sizeLabel: null, quantity: 1, ...lea });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "currency_mismatch" });
  });

  it("a link of another known shop, or of an unknown one: not_in_shop, nothing created", async () => {
    const s = await setup();
    const elsewhere = await addLine(s, {
      source: "url",
      url: `https://${s.other.domain}/robe`,
      sizeLabel: null,
      quantity: 1,
      ...lea,
    });
    expect(elsewhere.status).toBe(400);
    expect(await elsewhere.json()).toEqual({ error: "not_in_shop", shopName: s.shop.name });

    const shopsBefore = await t.db.select({ id: schema.shops.id }).from(schema.shops);
    const unknown = await addLine(s, {
      source: "url",
      url: "https://inconnue-closyria.test/robe",
      sizeLabel: null,
      quantity: 1,
      ...lea,
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "not_in_shop", shopName: s.shop.name });
    expect(await t.db.select({ id: schema.shops.id }).from(schema.shops)).toHaveLength(shopsBefore.length);
    expect(
      await t.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.canonicalUrl, "https://inconnue-closyria.test/robe")),
    ).toEqual([]);
    expect(await linesOf(s.order.id)).toEqual([]);
  });

  it("a manual line: her name and price", async () => {
    const s = await setup();
    const lineId = await added(await addLine(s, manual(lea)));
    const line = (await groupOrderOf(s))?.people[0]?.lines[0];
    expect(line).toEqual({
      id: lineId,
      itemId: null,
      name: "Sac 1",
      imageUrl: null,
      sizeLabel: null,
      quantity: 1,
      unitPriceCents: 1500,
      status: "manual",
    });
  });

  it("refuses the 21st active line of a friend (too_many_lines)", async () => {
    const s = await setup();
    for (let n = 1; n <= 20; n++) await added(await addLine(s, manual(lea, n)));
    const res = await addLine(s, manual(lea, 21));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_lines" });
    // Another friend still can.
    await added(await addLine(s, manual(ines)));
  });

  it("refuses every change once closed (group_order_locked)", async () => {
    const s = await setup();
    const lineId = await added(await addLine(s, manual(lea)));
    const closed = await call("POST", `/api/me/group-orders/${s.order.id}/action`, s.cookie, { action: "close" });
    expect(closed.status).toBe(200);
    expect((await groupOrderOf(s))?.locked).toBe(true);
    for (const res of [
      await addLine(s, manual(lea, 2)),
      await patchLine(s, lineId, { sizeLabel: "M", quantity: 2, ...lea }),
      await deleteLine(s, lineId, lea),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "group_order_locked" });
    }
  });

  it("deadline today: 23:30 in Paris is accepted, 00:05 the next day is refused", async () => {
    clock = new Date("2026-11-10T22:30:00Z"); // 23:30 in Paris
    const s = await setup("2026-11-10");
    expect((await groupOrderOf(s))?.locked).toBe(false);
    await added(await addLine(s, manual(lea)));
    clock = new Date("2026-11-10T23:05:00Z"); // 00:05 on the 11th in Paris
    expect((await groupOrderOf(s))?.locked).toBe(true);
    const res = await addLine(s, manual(lea, 2));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "group_order_locked" });
  });

  it("the same name on another device: name_taken, then accepted with claim", async () => {
    const s = await setup();
    await added(await addLine(s, manual(lea)));
    const taken = await addLine(s, manual({ name: " léa ", deviceKey: keyOther }, 2));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "name_taken" });
    await added(await addLine(s, { ...manual({ name: "Léa", deviceKey: keyOther }, 2), claim: true }));
    expect((await groupOrderOf(s, keyOther))?.mine?.lineIds).toHaveLength(2);
  });

  it("only the device of the line's name changes or removes it", async () => {
    const s = await setup();
    const leaLine = await added(await addLine(s, manual(lea)));
    await added(await addLine(s, manual(ines)));
    for (const res of [
      await patchLine(s, leaLine, { sizeLabel: "M", quantity: 2, ...ines }),
      await deleteLine(s, leaLine, ines),
      await patchLine(s, leaLine, { sizeLabel: "M", quantity: 2, name: "Léa", deviceKey: keyOther }),
      await deleteLine(s, leaLine, { name: "Léa", deviceKey: keyOther }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    const patched = await patchLine(s, leaLine, { sizeLabel: "M", quantity: 3, manualPriceCents: 1200, ...lea });
    expect(patched.status).toBe(200);
    const [row] = (await linesOf(s.order.id)).filter((l) => l.id === leaLine);
    expect(row).toMatchObject({ sizeLabel: "M", quantity: 3, manualPriceCents: 1200 });
    expect((await deleteLine(s, leaLine, lea)).status).toBe(204);
    expect((await linesOf(s.order.id)).map((l) => l.id)).not.toContain(leaLine);
  });

  it("her own name and price only on a manual line or a link read without a price", async () => {
    const s = await setup();
    const fromItem = await added(
      await addLine(s, { source: "item", itemId: s.itemA.id, sizeLabel: null, quantity: 1, ...lea }),
    );
    const read = await added(
      await addLine(s, { source: "url", url: s.pB.canonicalUrl, sizeLabel: null, quantity: 1, ...lea }),
    );
    const unread = await added(
      await addLine(s, {
        source: "url",
        url: `https://${s.shop.domain}/illisible`,
        sizeLabel: null,
        quantity: 1,
        ...lea,
      }),
    );
    for (const lineId of [fromItem, read]) {
      const res = await patchLine(s, lineId, { sizeLabel: null, quantity: 1, manualPriceCents: 1, ...lea });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    const named = await patchLine(s, unread, {
      sizeLabel: null,
      quantity: 1,
      manualName: "Robe illisible",
      manualPriceCents: 2500,
      ...lea,
    });
    expect(named.status).toBe(200);
    const lines = (await groupOrderOf(s))?.people[0]?.lines ?? [];
    expect(lines.find((l) => l.id === read)?.unitPriceCents).toBe(2000);
    expect(lines.find((l) => l.id === unread)).toMatchObject({ name: "Robe illisible", unitPriceCents: 2500 });
  });

  it("another device under a full name gets name_taken, not too_many_lines", async () => {
    const s = await setup();
    for (let n = 1; n <= 20; n++) await added(await addLine(s, manual(lea, n)));
    const res = await addLine(s, manual({ name: "Léa", deviceKey: keyOther }, 21));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "name_taken" });
  });

  it("a line she removed shows to her device only, struck, in removedLines", async () => {
    const s = await setup();
    const kept = await added(await addLine(s, manual(lea)));
    const gone = await added(await addLine(s, manual(lea, 2)));
    const removed = await call("DELETE", `/api/me/group-orders/${s.order.id}/lines/${gone}`, s.cookie);
    expect(removed.status).toBe(200);
    const mine = await groupOrderOf(s, keyLea);
    expect(mine?.mine).toMatchObject({ lineIds: [kept], removedLines: [{ id: gone, name: "Sac 2" }] });
    expect(mine?.people[0]?.lines.map((l) => l.id)).toEqual([kept]);
    expect((await groupOrderOf(s))?.people[0]?.lines.map((l) => l.id)).toEqual([kept]);
  });

  it("answers 429 at the 31st action of a device in an hour", async () => {
    const s = await setup();
    const lineId = await added(await addLine(s, manual(lea), "3.3.3.3"));
    for (let n = 2; n <= 30; n++)
      expect((await patchLine(s, lineId, { sizeLabel: null, quantity: 1, ...lea }, "3.3.3.3")).status).toBe(200);
    const res = await patchLine(s, lineId, { sizeLabel: null, quantity: 1, ...lea }, "3.3.3.3");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });

  it("ordered: her share is no longer provisional and « Payé » shows; cancelled long ago: gone", async () => {
    const s = await setup();
    await added(await addLine(s, manual(lea)));
    const ordered = await call("POST", `/api/me/group-orders/${s.order.id}/order`, s.cookie, {
      shippingCents: 600,
      lines: [],
    });
    expect(ordered.status).toBe(200);
    const res = await call("PUT", `/api/me/group-orders/${s.order.id}/payments/${opinionNameKey("Léa")}`, s.cookie, {
      paid: true,
    });
    expect(res.status).toBe(200);
    const view = await groupOrderOf(s, keyLea);
    expect(view).toMatchObject({ status: "ordered", locked: true, orderedAt: expect.any(String) });
    expect(view?.mine).toMatchObject({ provisional: false, totalCents: 2100, paidAt: expect.any(String) });

    const c = await setup();
    expect(
      (await call("POST", `/api/me/group-orders/${c.order.id}/action`, c.cookie, { action: "cancel" })).status,
    ).toBe(200);
    expect((await groupOrderOf(c))?.status).toBe("cancelled");
    await t.db
      .update(schema.groupOrders)
      .set({ cancelledAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.groupOrders.id, c.order.id));
    expect(await groupOrderOf(c)).toBeNull();
  });

  it("hides her name when she hides it; a list without group order says null", async () => {
    const s = await setup();
    await t.db
      .update(schema.user)
      .set({ name: "Camille Durand", isAnonymous: false })
      .where(eq(schema.user.id, s.userId));
    expect((await groupOrderOf(s))?.ownerName).toBe("Camille");
    await t.db
      .update(schema.wishlists)
      .set({ showOwnerName: false })
      .where(and(eq(schema.wishlists.id, s.list.id)));
    expect((await groupOrderOf(s))?.ownerName).toBeNull();
    await t.db.delete(schema.groupOrders).where(eq(schema.groupOrders.id, s.order.id));
    expect(await groupOrderOf(s)).toBeNull();
  });
});
