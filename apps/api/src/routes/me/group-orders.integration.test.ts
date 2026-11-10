import { eq, schema, sql } from "@closyria/db";
import {
  type GroupOrderPastList,
  type ItemView,
  type OwnerGroupOrder,
  opinionNameKey,
  type WishlistView,
} from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

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

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function newShop(label: string) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `${label} ${k}`, slug: `go-shop-${k}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

async function newProduct(shopId: string, priceCents: number | null, currency: string | null = "EUR") {
  const k = ++counter;
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId, canonicalUrl: `https://go-${k}.test/p`, name: `Robe ${k}`, priceCents, currency })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function newItem(userId: string, profileId: string, productId: string) {
  const [item] = await t.db.insert(schema.items).values({ userId, profileId, productId, sizeLabel: "38" }).returning();
  if (!item) throw new Error("no item");
  return item;
}

/**
 * A shared list with two items of shop `shop` (A at 30 €, B at 20 € with size M at 25 €) and one item of another
 * shop; a delivery option « Point relais » (4,90 €, free from 80 €) on `shop`.
 */
async function setup(options: { share?: boolean } = {}) {
  const { cookie, userId } = await t.signIn();
  const list = (await (await call("POST", "/api/me/wishlists", cookie, { name: "Été" })).json()) as WishlistView;
  const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const profileId = (profiles.profiles[0] as { id: string }).id;
  const shop = await newShop("Boutique");
  const other = await newShop("Autre");
  const pA = await newProduct(shop.id, 3000);
  const pB = await newProduct(shop.id, 2000);
  await t.db.insert(schema.productSizes).values([
    { productId: pB.id, label: "S", position: 0, available: true },
    { productId: pB.id, label: "M", position: 1, available: true, priceCents: 2500 },
  ]);
  const pC = await newProduct(other.id, 1000);
  const itemA = await newItem(userId, profileId, pA.id);
  const itemB = await newItem(userId, profileId, pB.id);
  const itemC = await newItem(userId, profileId, pC.id);
  for (const item of [itemA, itemB, itemC])
    expect((await call("POST", `/api/me/wishlists/${list.id}/items`, cookie, { itemId: item.id })).status).toBe(200);
  if (options.share !== false)
    expect((await call("POST", `/api/me/wishlists/${list.id}/share`, cookie)).status).toBe(200);
  const [option] = await t.db
    .insert(schema.shopShippingOptions)
    .values({ shopId: shop.id, label: "Point relais", shippingCents: 490, freeFromCents: 8000, position: 0 })
    .returning();
  if (!option) throw new Error("no option");
  return { cookie, userId, profileId, list, shop, other, pA, pB, pC, itemA, itemB, itemC, option };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const free = { label: "Colissimo", shippingCents: 600, freeFromCents: null };

async function open(s: Setup, body: unknown = { shopId: s.shop.id, shipping: free, deadline: null }) {
  const res = await call("POST", `/api/me/wishlists/${s.list.id}/group-order`, s.cookie, body);
  expect(res.status).toBe(201);
  return (await res.json()) as OwnerGroupOrder;
}

async function ok(res: Response) {
  expect(res.status).toBe(200);
  return (await res.json()) as OwnerGroupOrder;
}

/** A friend's line written straight in the table (the friends' API is another task). */
async function friendLine(
  orderId: string,
  name: string,
  values: Partial<typeof schema.groupOrderLines.$inferInsert>,
  createdAt = new Date(),
) {
  const [line] = await t.db
    .insert(schema.groupOrderLines)
    .values({ groupOrderId: orderId, buyerName: name, buyerNameKey: opinionNameKey(name), createdAt, ...values })
    .returning();
  if (!line) throw new Error("no line");
  return line;
}

const action = (s: Setup, id: string, a: string) =>
  call("POST", `/api/me/group-orders/${id}/action`, s.cookie, { action: a });
const current = (s: Setup) => call("GET", `/api/me/wishlists/${s.list.id}/group-order`, s.cookie);

describe("opening a group order", () => {
  it("copies the shop's option, and a later admin change leaves the order as it was", async () => {
    const s = await setup();
    const order = await open(s, { shopId: s.shop.id, shippingOptionId: s.option.id, deadline: null });
    expect(order.status).toBe("open");
    expect(order.shop).toEqual({ id: s.shop.id, name: s.shop.name });
    expect(order.shipping).toEqual({ label: "Point relais", shippingCents: 490, freeFromCents: 8000 });
    expect(order.currency).toBe("EUR");
    expect(order.people).toEqual([]);
    expect(order.ownItems.map((i) => i.itemId).sort()).toEqual([s.itemA.id, s.itemB.id].sort());
    expect(order.ownItems.find((i) => i.itemId === s.itemB.id)?.sizes).toEqual(["S", "M"]);

    await t.db
      .update(schema.shopShippingOptions)
      .set({ label: "Relais", shippingCents: 990, freeFromCents: 10000 })
      .where(eq(schema.shopShippingOptions.id, s.option.id));
    const [row] = await t.db.select().from(schema.groupOrders).where(eq(schema.groupOrders.id, order.id));
    expect(row?.shippingCents).toBe(490);
    const again = await ok(await current(s));
    expect(again.shipping).toEqual({ label: "Point relais", shippingCents: 490, freeFromCents: 8000 });
  });

  it("takes a free input; the list shows it; a second one is refused", async () => {
    const s = await setup();
    const order = await open(s, { shopId: s.shop.id, shipping: free, deadline: "2099-12-31" });
    expect(order.shipping).toEqual(free);
    expect(order.deadline).toBe("2099-12-31");
    const lists = (await (await call("GET", "/api/me/wishlists", s.cookie)).json()) as { wishlists: WishlistView[] };
    expect(lists.wishlists.find((w) => w.id === s.list.id)?.groupOrder).toEqual({
      id: order.id,
      status: "open",
      shopName: s.shop.name,
    });
    const second = await call("POST", `/api/me/wishlists/${s.list.id}/group-order`, s.cookie, {
      shopId: s.other.id,
      shipping: free,
      deadline: null,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "already_open" });
  });

  it("refuses a shop with no item on the list, a list not shared, an option of another shop", async () => {
    const s = await setup();
    const elsewhere = await newShop("Ailleurs");
    const res = await call("POST", `/api/me/wishlists/${s.list.id}/group-order`, s.cookie, {
      shopId: elsewhere.id,
      shipping: free,
      deadline: null,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "shop_not_in_list" });
    const wrongOption = await call("POST", `/api/me/wishlists/${s.list.id}/group-order`, s.cookie, {
      shopId: s.other.id,
      shippingOptionId: s.option.id,
      deadline: null,
    });
    expect(wrongOption.status).toBe(400);

    const hidden = await setup({ share: false });
    const notShared = await call("POST", `/api/me/wishlists/${hidden.list.id}/group-order`, hidden.cookie, {
      shopId: hidden.shop.id,
      shipping: free,
      deadline: null,
    });
    expect(notShared.status).toBe(409);
    expect(await notShared.json()).toEqual({ error: "not_shared" });
  });
});

describe("her group order", () => {
  it("close → reopen → close → order; nothing changes once ordered; order from cancelled is refused", async () => {
    const s = await setup();
    const order = await open(s);
    expect((await ok(await action(s, order.id, "close"))).status).toBe("closed");
    expect((await ok(await action(s, order.id, "reopen"))).status).toBe("open");
    expect((await ok(await action(s, order.id, "close"))).status).toBe("closed");
    const reclose = await action(s, order.id, "close");
    expect(reclose.status).toBe(409);
    expect(await reclose.json()).toEqual({ error: "invalid_transition" });
    const ordered = await ok(
      await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, { shippingCents: 600, lines: [] }),
    );
    expect(ordered.status).toBe("ordered");
    expect(ordered.orderedAt).not.toBeNull();
    const patch = await call("PATCH", `/api/me/group-orders/${order.id}`, s.cookie, { deadline: null });
    expect(patch.status).toBe(409);
    expect(await patch.json()).toEqual({ error: "group_order_locked" });
    expect((await action(s, order.id, "cancel")).status).toBe(409);

    // Ordered: a new one can be opened, then cancelled; ordering it is refused.
    const next = await open(s);
    await friendLine(next.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    expect((await ok(await action(s, next.id, "cancel"))).status).toBe("cancelled");
    const late = await call("POST", `/api/me/group-orders/${next.id}/order`, s.cookie, {
      shippingCents: 600,
      lines: [],
    });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "invalid_transition" });

    // The cancelled one is the most recent of the last 30 days; both are in the past ones.
    expect((await ok(await current(s))).id).toBe(next.id);
    const past = (await (
      await call("GET", `/api/me/wishlists/${s.list.id}/group-orders`, s.cookie)
    ).json()) as GroupOrderPastList;
    expect(past.past.map((p) => p.id)).toEqual([next.id, order.id]);
    // Items + shipping: the cancelled one with its current shipping (1500 + 600), the ordered one with nobody (0).
    expect(past.past[0]).toMatchObject({ status: "cancelled", totalCents: 2100, unpaidCount: 0 });
    expect(past.past[1]).toMatchObject({ status: "ordered", shopName: s.shop.name, totalCents: 0, unpaidCount: 0 });
  });

  it("changes the deadline and the delivery while open", async () => {
    const s = await setup();
    const order = await open(s);
    const changed = await ok(
      await call("PATCH", `/api/me/group-orders/${order.id}`, s.cookie, {
        deadline: "2099-01-01",
        shipping: { label: "Express", shippingCents: 1200, freeFromCents: 5000 },
      }),
    );
    expect(changed.deadline).toBe("2099-01-01");
    expect(changed.shipping).toEqual({ label: "Express", shippingCents: 1200, freeFromCents: 5000 });
  });

  it("her lines: items of the list and of the shop only, current prices, then « J'ai commandé » freezes all", async () => {
    const s = await setup();
    const order = await open(s);
    const wrong = await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
      lines: [{ itemId: s.itemC.id, sizeLabel: null, quantity: 1 }],
    });
    expect(wrong.status).toBe(400);
    const mine = await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
        lines: [
          { itemId: s.itemA.id, sizeLabel: "38", quantity: 1 },
          { itemId: s.itemB.id, sizeLabel: "M", quantity: 2 },
        ],
      }),
    );
    const owner = mine.people[0];
    expect(owner).toMatchObject({ key: "owner", isOwner: true, payment: null });
    expect(owner?.lines.map((l) => l.unitPriceCents)).toEqual([3000, 2500]);
    expect(owner?.lines.every((l) => l.status === "ready")).toBe(true);
    // Her line keeps its source: the product and the name at write time.
    const rows = await t.db
      .select()
      .from(schema.groupOrderLines)
      .where(eq(schema.groupOrderLines.groupOrderId, order.id));
    expect(rows.every((r) => r.productId !== null && r.manualName !== null && r.buyerName === null)).toBe(true);

    // Léa first (a manual line), then Inès (a product of the shop with no price).
    await friendLine(
      order.id,
      "Léa",
      { manualName: "Pull", manualPriceCents: 1500, quantity: 2 },
      new Date(Date.now() - 60_000),
    );
    const noPrice = await newProduct(s.shop.id, null);
    const ines = await friendLine(order.id, "Inès", { productId: noPrice.id, sizeLabel: "S" });
    const view = await ok(await current(s));
    expect(view.people.map((p) => p.key)).toEqual(["owner", opinionNameKey("Léa"), opinionNameKey("Inès")]);
    expect(view.people[1]?.lines[0]).toMatchObject({ name: "Pull", unitPriceCents: 1500, status: "manual" });
    expect(view.people[2]?.lines[0]).toMatchObject({ unitPriceCents: null, status: "ready" });
    // 3000 + 5000 + 3000 + 0; 600 of shipping in three.
    expect(view.totals.totalCents).toBe(11000);
    expect(view.totals.perPerson[opinionNameKey("Léa")]).toEqual({
      itemsCents: 3000,
      shippingCents: 200,
      totalCents: 3200,
    });

    const ownA = owner?.lines[0]?.id as string;
    const missing = await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, {
      shippingCents: 700,
      lines: [{ id: ownA, priceCents: 2700 }],
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_price" });
    expect((await ok(await current(s))).status).toBe("open");

    const ordered = await ok(
      await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, {
        shippingCents: 700,
        lines: [
          { id: ownA, priceCents: 2700 },
          { id: ines.id, priceCents: 1000 },
        ],
      }),
    );
    expect(ordered).not.toHaveProperty("undo");
    expect(ordered.status).toBe("ordered");
    expect(ordered.shipping.shippingCents).toBe(700);
    // Owner 2700 + 5000, Léa 3000, Inès 1000 = 11700; 700 / 3 = 233, the extra cent to her.
    expect(ordered.totals.totalCents).toBe(11700);
    expect(ordered.totals.perPerson.owner).toEqual({ itemsCents: 7700, shippingCents: 234, totalCents: 7934 });
    expect(ordered.people[1]?.payment).toEqual({ amountCents: 3233, paidAt: null });
    expect(ordered.people[2]?.payment).toEqual({ amountCents: 1233, paidAt: null });
    expect(ordered.people[1]?.lines[0]?.finalPriceCents).toBe(1500);
    const payments = await t.db
      .select()
      .from(schema.groupOrderPayments)
      .where(eq(schema.groupOrderPayments.groupOrderId, order.id));
    expect(payments.map((p) => [p.buyerName, p.amountCents]).sort()).toEqual([
      ["Inès", 1233],
      ["Léa", 3233],
    ]);
    // Her items went to « Commandé »; the friends' lines never became items of hers.
    for (const id of [s.itemA.id, s.itemB.id]) {
      const item = (await (await call("GET", `/api/me/items/${id}`, s.cookie)).json()) as ItemView;
      expect(item.stage).toBe("ordered");
    }
    const hers = await t.db.select().from(schema.items).where(eq(schema.items.userId, s.userId));
    expect(hers).toHaveLength(3);

    // A price change after the order does not move anything.
    await t.db.update(schema.products).set({ priceCents: 9900 }).where(eq(schema.products.id, s.pA.id));
    expect((await ok(await current(s))).totals.totalCents).toBe(11700);

    // « Payé », then undone.
    const leaKey = encodeURIComponent(opinionNameKey("Léa"));
    const paid = await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/payments/${leaKey}`, s.cookie, { paid: true }),
    );
    expect(paid.people[1]?.payment?.paidAt).not.toBeNull();
    let past = (await (
      await call("GET", `/api/me/wishlists/${s.list.id}/group-orders`, s.cookie)
    ).json()) as GroupOrderPastList;
    expect(past.past[0]).toMatchObject({ id: order.id, totalCents: 12400, unpaidCount: 1 });
    const unpaid = await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/payments/${leaKey}`, s.cookie, { paid: false }),
    );
    expect(unpaid.people[1]?.payment?.paidAt).toBeNull();
    past = (await (
      await call("GET", `/api/me/wishlists/${s.list.id}/group-orders`, s.cookie)
    ).json()) as GroupOrderPastList;
    expect(past.past[0]?.unpaidCount).toBe(2);
    expect(
      (await call("PUT", `/api/me/group-orders/${order.id}/payments/nobody`, s.cookie, { paid: true })).status,
    ).toBe(404);
  });

  it("removes a friend's line, then puts it back", async () => {
    const s = await setup();
    const order = await open(s);
    const line = await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    const removed = await ok(await call("DELETE", `/api/me/group-orders/${order.id}/lines/${line.id}`, s.cookie));
    expect(removed.people[0]?.lines[0]?.removedAt).not.toBeNull();
    expect(removed.totals.totalCents).toBe(0);
    expect(removed.totals.perPerson).toEqual({});
    const back = await ok(await call("POST", `/api/me/group-orders/${order.id}/lines/${line.id}/restore`, s.cookie));
    expect(back.people[0]?.lines[0]?.removedAt).toBeNull();
    expect(back.totals.totalCents).toBe(1500);
    const other = await setup();
    const otherOrder = await open(other);
    expect((await call("DELETE", `/api/me/group-orders/${otherOrder.id}/lines/${line.id}`, other.cookie)).status).toBe(
      404,
    );
  });
});

describe("limits and atomicity", () => {
  it("does not put back a line of a friend who already has 20 active ones", async () => {
    const s = await setup();
    const order = await open(s);
    const removed = await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 100 });
    expect((await call("DELETE", `/api/me/group-orders/${order.id}/lines/${removed.id}`, s.cookie)).status).toBe(200);
    for (let i = 0; i < 20; i++)
      await friendLine(order.id, "Léa", { manualName: `Article ${i}`, manualPriceCents: 100 });
    const res = await call("POST", `/api/me/group-orders/${order.id}/lines/${removed.id}/restore`, s.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too_many_lines" });
    // Another friend's line comes back.
    const ines = await friendLine(order.id, "Inès", { manualName: "Jupe", manualPriceCents: 100 });
    await call("DELETE", `/api/me/group-orders/${order.id}/lines/${ines.id}`, s.cookie);
    expect((await call("POST", `/api/me/group-orders/${order.id}/lines/${ines.id}/restore`, s.cookie)).status).toBe(
      200,
    );
  });

  it("« J'ai commandé » is all or nothing: a failed move of her items leaves the order as it was", async () => {
    const s = await setup();
    const order = await open(s);
    await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
        lines: [{ itemId: s.itemA.id, sizeLabel: "38", quantity: 1 }],
      }),
    );
    await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    await ok(await action(s, order.id, "close"));
    // The database refuses the move of this one item to « Commandé » (the last write of the transaction).
    await t.db.execute(
      sql.raw(`
      create function go_refuse_order() returns trigger language plpgsql as $$
      begin
        if new.id = '${s.itemA.id}' and new.stage = 'ordered' then raise exception 'refused for the test'; end if;
        return new;
      end $$;
      create trigger go_refuse_order before update on items for each row execute function go_refuse_order();`),
    );
    try {
      const res = await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, {
        shippingCents: 600,
        lines: [],
      });
      expect(res.status).toBe(500);
    } finally {
      await t.db.execute(sql.raw("drop trigger go_refuse_order on items; drop function go_refuse_order();"));
    }
    const after = await ok(await current(s));
    expect(after.status).toBe("closed");
    expect(after.orderedAt).toBeNull();
    expect(after.people.flatMap((p) => p.lines.map((l) => l.finalPriceCents))).toEqual([null, null]);
    expect(after.people.every((p) => p.payment === null)).toBe(true);
    const [item] = await t.db.select().from(schema.items).where(eq(schema.items.id, s.itemA.id));
    expect(item?.stage).not.toBe("ordered");

    // Without the refusal, both changes land together.
    const done = await ok(
      await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, { shippingCents: 600, lines: [] }),
    );
    expect(done.status).toBe("ordered");
    const [moved] = await t.db.select().from(schema.items).where(eq(schema.items.id, s.itemA.id));
    expect(moved?.stage).toBe("ordered");
  });
});

describe("another account", () => {
  it("never reads nor changes her group order", async () => {
    const s = await setup();
    const order = await open(s);
    const line = await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    const { cookie } = await t.signIn();
    const attempts = [
      call("GET", `/api/me/wishlists/${s.list.id}/group-order`, cookie),
      call("GET", `/api/me/wishlists/${s.list.id}/group-orders`, cookie),
      call("POST", `/api/me/wishlists/${s.list.id}/group-order`, cookie, {
        shopId: s.shop.id,
        shipping: free,
        deadline: null,
      }),
      call("PATCH", `/api/me/group-orders/${order.id}`, cookie, { deadline: null }),
      call("POST", `/api/me/group-orders/${order.id}/action`, cookie, { action: "cancel" }),
      call("PUT", `/api/me/group-orders/${order.id}/own-lines`, cookie, { lines: [] }),
      call("DELETE", `/api/me/group-orders/${order.id}/lines/${line.id}`, cookie),
      call("POST", `/api/me/group-orders/${order.id}/lines/${line.id}/restore`, cookie),
      call("POST", `/api/me/group-orders/${order.id}/order`, cookie, { shippingCents: 0, lines: [] }),
      call("PUT", `/api/me/group-orders/${order.id}/payments/lea`, cookie, { paid: true }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await ok(await current(s))).status).toBe("open");
    expect((await call("GET", `/api/me/wishlists/${s.list.id}/group-order`, undefined)).status).toBe(401);
  });
});

describe("a shop's delivery options for her", () => {
  it("lists them in the admin's order with a session, never without", async () => {
    const s = await setup();
    await t.db
      .insert(schema.shopShippingOptions)
      .values({ shopId: s.shop.id, label: "Domicile", shippingCents: 690, freeFromCents: null, position: 1 });
    const res = await call("GET", `/api/me/shops/${s.shop.id}/shipping-options`, s.cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { options: { label: string; shippingCents: number }[] };
    expect(body.options.map((o) => [o.label, o.shippingCents])).toEqual([
      ["Point relais", 490],
      ["Domicile", 690],
    ]);
    const none = await call("GET", `/api/me/shops/${s.other.id}/shipping-options`, s.cookie);
    expect(await none.json()).toEqual({ options: [] });
    expect((await call("GET", `/api/me/shops/${s.shop.id}/shipping-options`, undefined)).status).toBe(401);
    expect((await call("GET", "/api/me/shops/nope/shipping-options", s.cookie)).status).toBe(400);
  });
});

describe("one of her group orders by id", () => {
  it("reads her own at any age and in any state, never another account's", async () => {
    const s = await setup();
    const order = await open(s);
    await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    await ok(await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, { shippingCents: 600, lines: [] }));
    // Ordered long ago: past the 30 days of the list's current one.
    await t.db
      .update(schema.groupOrders)
      .set({ orderedAt: new Date("2025-01-10T12:00:00Z") })
      .where(eq(schema.groupOrders.id, order.id));
    expect((await current(s)).status).toBe(404);
    const read = await ok(await call("GET", `/api/me/group-orders/${order.id}`, s.cookie));
    expect(read).toMatchObject({ id: order.id, status: "ordered", wishlistId: s.list.id });
    expect(read.people.find((p) => p.name === "Léa")?.payment).toMatchObject({ amountCents: 2100, paidAt: null });
    const running = await open(s);
    expect((await ok(await call("GET", `/api/me/group-orders/${running.id}`, s.cookie))).status).toBe("open");

    const past = (await (
      await call("GET", `/api/me/wishlists/${s.list.id}/group-orders`, s.cookie)
    ).json()) as GroupOrderPastList;
    expect(past.past[0]).toMatchObject({ id: order.id, currency: "EUR" });

    const { cookie } = await t.signIn();
    const other = await call("GET", `/api/me/group-orders/${order.id}`, cookie);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "not_found" });
    expect((await call("GET", `/api/me/group-orders/${order.id}`, undefined)).status).toBe(401);
  });
});

describe("once ordered", () => {
  it("splits the shipping she typed even past the free threshold; the views read the frozen payments", async () => {
    const s = await setup();
    // « Point relais »: 4,90 €, free from 80 €; her lines reach it (3000 + 2 × 2500).
    const order = await open(s, { shopId: s.shop.id, shippingOptionId: s.option.id, deadline: null });
    await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
        lines: [
          { itemId: s.itemA.id, sizeLabel: "38", quantity: 1 },
          { itemId: s.itemB.id, sizeLabel: "M", quantity: 2 },
        ],
      }),
    );
    await friendLine(order.id, "Léa", { manualName: "Pull", manualPriceCents: 1500 });
    const before = await ok(await current(s));
    expect(before.totals).toMatchObject({ remainingForFreeCents: 0, shippingTotalCents: 0 });

    const ordered = await ok(
      await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, { shippingCents: 490, lines: [] }),
    );
    const lea = opinionNameKey("Léa");
    expect(ordered.totals.shippingTotalCents).toBe(490);
    expect(ordered.totals.perPerson.owner).toEqual({ itemsCents: 8000, shippingCents: 245, totalCents: 8245 });
    expect(ordered.totals.perPerson[lea]).toEqual({ itemsCents: 1500, shippingCents: 245, totalCents: 1745 });
    expect(ordered.people[1]?.payment).toEqual({ amountCents: 1745, paidAt: null });
    const [payment] = await t.db
      .select()
      .from(schema.groupOrderPayments)
      .where(eq(schema.groupOrderPayments.groupOrderId, order.id));
    expect(payment?.amountCents).toBe(1745);

    // What she owes is the frozen amount, never a new computation.
    await t.db
      .update(schema.groupOrderPayments)
      .set({ amountCents: 1800 })
      .where(eq(schema.groupOrderPayments.groupOrderId, order.id));
    const again = await ok(await current(s));
    expect(again.people[1]?.payment?.amountCents).toBe(1800);
    expect(again.totals.perPerson[lea]?.totalCents).toBe(1800);
  });

  it("her line keeps its name when the item is renamed after the order", async () => {
    const s = await setup();
    const order = await open(s);
    const mine = await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
        lines: [{ itemId: s.itemA.id, sizeLabel: null, quantity: 1 }],
      }),
    );
    const name = mine.people[0]?.lines[0]?.name;
    expect(name).toBe(s.pA.name);
    await ok(await call("POST", `/api/me/group-orders/${order.id}/order`, s.cookie, { shippingCents: 600, lines: [] }));
    await t.db.update(schema.items).set({ nameOverride: "Renommée" }).where(eq(schema.items.id, s.itemA.id));
    expect((await ok(await current(s))).people[0]?.lines[0]?.name).toBe(name);
  });
});

describe("a merge of the order's shop", () => {
  it("keeps her items of the shop in the order", async () => {
    const s = await setup();
    const order = await open(s);
    // What the admin merge does: products and domains move, the shop points at the target.
    const target = await newShop("Cible");
    await t.db.update(schema.products).set({ shopId: target.id }).where(eq(schema.products.shopId, s.shop.id));
    await t.db.update(schema.shops).set({ mergedIntoId: target.id }).where(eq(schema.shops.id, s.shop.id));
    const view = await ok(await current(s));
    expect(view.ownItems.map((i) => i.itemId).sort()).toEqual([s.itemA.id, s.itemB.id].sort());
    const ticked = await ok(
      await call("PUT", `/api/me/group-orders/${order.id}/own-lines`, s.cookie, {
        lines: [{ itemId: s.itemA.id, sizeLabel: null, quantity: 1 }],
      }),
    );
    expect(ticked.people[0]?.lines.map((l) => l.itemId)).toEqual([s.itemA.id]);
  });
});
