import { and, eq, isNull, schema, sql } from "@closyria/db";
import type { ItemCounts, ItemPage, ItemView, MutationResult, OrderList, OrderView } from "@closyria/shared";
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

async function json<T>(res: Response, status: number): Promise<T> {
  const text = await res.text();
  expect(res.status, text).toBe(status);
  return JSON.parse(text) as T;
}

/** A signed-in account (not a guest), with « Moi ». */
async function account() {
  const session = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ isAnonymous: false, name: "Marie Test", email: `marie${++counter}@t.local`, emailVerified: true })
    .where(eq(schema.user.id, session.userId));
  const profiles = await json<{ profiles: { id: string }[] }>(
    await call("GET", "/api/me/profiles", session.cookie),
    200,
  );
  const moi = profiles.profiles[0]?.id;
  if (!moi) throw new Error("no profile");
  return { ...session, moi };
}
type Account = Awaited<ReturnType<typeof account>>;

async function newShop(name = `Boutique ${++counter}`) {
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name, slug: `orders-shop-${++counter}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

async function newProduct(shopId: string, name: string, priceCents: number | null = 5000) {
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId, canonicalUrl: `https://orders-${++counter}.test/p`, name, priceCents, currency: "EUR" })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function wish(a: Account, productId: string): Promise<string> {
  const res = await call("POST", "/api/me/items", a.cookie, { productId, action: "wish" });
  return (await json<{ item: ItemView }>(res, 201)).item.id;
}

type Line = {
  name: string;
  sizeLabel?: string | null;
  color?: string | null;
  quantity?: number;
  priceCents?: number | null;
  currency?: string | null;
  productId?: string | null;
};

/** A draft as the worker leaves it (Task 3). */
async function draft(a: Account, shopId: string | null, lines: Line[], extra: { trackingNumber?: string } = {}) {
  const [order] = await t.db
    .insert(schema.orders)
    .values({
      userId: a.userId,
      profileId: a.moi,
      shopId,
      externalRef: `R${++counter}`,
      orderedAt: new Date("2026-11-10T09:00:00Z"),
      status: "draft",
      source: "email",
      parseMethod: "known",
    })
    .returning();
  if (!order) throw new Error("no order");
  await t.db.insert(schema.orderLines).values(
    lines.map((line, position) => ({
      orderId: order.id,
      name: line.name,
      sizeLabel: line.sizeLabel ?? null,
      color: line.color ?? null,
      quantity: line.quantity ?? 1,
      priceCents: line.priceCents ?? null,
      currency: line.currency ?? null,
      productId: line.productId ?? null,
      position,
    })),
  );
  if (extra.trackingNumber) {
    await t.db.insert(schema.parcels).values({
      orderId: order.id,
      carrier: "colissimo",
      trackingNumber: extra.trackingNumber,
      checkUntil: new Date(Date.now() + 30 * 86_400_000),
    });
  }
  return order.id;
}

async function itemsOf(a: Account) {
  return t.db
    .select()
    .from(schema.items)
    .where(and(eq(schema.items.userId, a.userId), isNull(schema.items.deletedAt)));
}

async function getItem(a: Account, id: string) {
  return json<ItemView>(await call("GET", `/api/me/items/${id}`, a.cookie), 200);
}

const confirm = (a: Account, id: string) => call("POST", `/api/me/orders/${id}/confirm`, a.cookie);

describe("guests", () => {
  it("are asked to create an account (account_required)", async () => {
    const guest = await t.signIn();
    const fake = "00000000-0000-4000-8000-000000000000";
    for (const [method, path, body] of [
      ["GET", "/api/me/orders", undefined],
      ["PATCH", `/api/me/orders/${fake}`, { externalRef: "1" }],
      ["POST", `/api/me/orders/${fake}/confirm`, undefined],
      ["POST", `/api/me/orders/${fake}/dismiss`, undefined],
      ["POST", "/api/me/orders", { profileId: fake, shopName: "X", lines: [{ name: "Robe", quantity: 1 }] }],
      ["POST", `/api/me/items/${fake}/tracking`, { trackingNumber: "6A12345678901" }],
    ] as const) {
      expect(await json(await call(method, path, guest.cookie, body), 403)).toEqual({ error: "account_required" });
    }
  });
});

describe("GET /api/me/orders", () => {
  it("lists her drafts and orders, never a dismissed one nor another account's", async () => {
    const a = await account();
    const other = await account();
    const shop = await newShop("Maison Lila");
    const kept = await draft(a, shop.id, [{ name: "Robe Lina", sizeLabel: "M", priceCents: 4500, currency: "EUR" }], {
      trackingNumber: "6A12345678901",
    });
    const dismissed = await draft(a, null, [{ name: "Pull" }]);
    await json(await call("POST", `/api/me/orders/${dismissed}/dismiss`, a.cookie), 200);
    await draft(other, shop.id, [{ name: "Jupe" }]);

    const { orders } = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    expect(orders.map((o) => o.id)).toEqual([kept]);
    const [order] = orders;
    expect(order).toMatchObject({
      status: "draft",
      shop: { id: shop.id, name: "Maison Lila", returnsUrl: null },
      shopName: "Maison Lila",
      lines: [{ name: "Robe Lina", sizeLabel: "M", quantity: 1, priceCents: 4500, currency: "EUR", itemId: null }],
      parcels: [{ carrier: "colissimo", trackingNumber: "6A12345678901", status: "pending", lastEventLabel: null }],
    });
  });

  it("answers 404 on another account's order", async () => {
    const a = await account();
    const other = await account();
    const theirs = await draft(other, null, [{ name: "Robe" }]);
    expect((await confirm(a, theirs)).status).toBe(404);
    expect((await call("POST", `/api/me/orders/${theirs}/dismiss`, a.cookie)).status).toBe(404);
    expect((await call("PATCH", `/api/me/orders/${theirs}`, a.cookie, { externalRef: "9" })).status).toBe(404);
    const [row] = await t.db.select().from(schema.orders).where(eq(schema.orders.id, theirs));
    expect(row?.status).toBe("draft");
  });
});

describe("« C'est bon » (RF 3)", () => {
  it("links a line to her wish of the same shop and name, carries the size, creates no duplicate", async () => {
    const a = await account();
    const shop = await newShop();
    const product = await newProduct(shop.id, "Robe « Léa »");
    const wished = await wish(a, product.id);
    const orderId = await draft(a, shop.id, [{ name: "ROBE LEA", sizeLabel: "38", priceCents: 6900, currency: "EUR" }]);

    const order = await json<OrderView>(await confirm(a, orderId), 200);
    expect(order.status).toBe("confirmed");
    expect(order.lines[0]?.itemId).toBe(wished);
    const items = await itemsOf(a);
    expect(items.map((i) => i.id)).toEqual([wished]);
    const item = await getItem(a, wished);
    expect(item).toMatchObject({ stage: "ordered", sizeLabel: "38", pricePaidCents: 6900, inOrderDraft: false });
    const events = await t.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, wished));
    expect(events.filter((e) => e.stage === "ordered").map((e) => [e.at.toISOString(), e.spentCents])).toEqual([
      ["2026-11-10T09:00:00.000Z", 6900],
    ]);
  });

  it("links a line of a captured product to her item for it, before any name (RF 3)", async () => {
    const a = await account();
    const shop = await newShop();
    const product = await newProduct(shop.id, "Chemise Iris");
    const wished = await wish(a, product.id);
    // Another wish of that shop named exactly as the line: the product wins, the name is never tried.
    const namesake = await wish(a, (await newProduct(shop.id, "Chemise du soir")).id);
    const orderId = await draft(a, shop.id, [{ name: "Chemise du soir", productId: product.id, sizeLabel: "S" }]);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    expect(order.lines[0]?.itemId).toBe(wished);
    expect(await getItem(a, wished)).toMatchObject({ stage: "ordered", sizeLabel: "S" });
    expect((await getItem(a, namesake)).stage).toBe("spotted");
    expect((await itemsOf(a)).map((i) => i.id).sort()).toEqual([wished, namesake].sort());
  });

  it("links an article already in « Commandé » without changing its stage again", async () => {
    const a = await account();
    const shop = await newShop();
    const product = await newProduct(shop.id, "Gilet");
    const id = await wish(a, product.id);
    await json(
      await call("POST", `/api/me/items/${id}/stage`, a.cookie, { stage: "ordered", at: "2026-11-09T10:00:00Z" }),
      200,
    );
    const orderId = await draft(a, shop.id, [{ name: "Gilet", sizeLabel: "M" }]);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    expect(order.lines[0]?.itemId).toBe(id);
    const events = await t.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, id));
    expect(events.filter((e) => e.stage === "ordered")).toHaveLength(1);
    expect((await getItem(a, id)).sizeLabel).toBe("M");
  });

  it("creates an article « Commandé » without a product when nothing matches", async () => {
    const a = await account();
    const shop = await newShop("Atelier Nuit");
    const product = await newProduct(shop.id, "Robe Lina");
    const wished = await wish(a, product.id);
    const orderId = await draft(a, shop.id, [
      { name: "Robe Lina courte", sizeLabel: "M", quantity: 2, priceCents: 3000, currency: "EUR" },
    ]);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    const created = order.lines[0]?.itemId;
    expect(created).toBeTruthy();
    expect(created).not.toBe(wished);
    const item = await getItem(a, created as string);
    expect(item).toMatchObject({
      product: null,
      stage: "ordered",
      name: "Robe Lina courte",
      nameOverride: "Robe Lina courte",
      shopName: "Atelier Nuit",
      sizeLabel: "M",
      pricePaidCents: 6000,
      illustration: { kind: "other", color: null },
      alertState: null,
      checkedAt: null,
    });
    expect((await getItem(a, wished)).stage).toBe("spotted");

    const page = await json<ItemPage>(await call("GET", "/api/me/items?stage=ordered", a.cookie), 200);
    expect(page.items.map((i) => i.id)).toEqual([created]);
    const search = await json<ItemPage>(await call("GET", "/api/me/items?q=atelier", a.cookie), 200);
    expect(search.items.map((i) => i.id).sort()).toEqual([created, wished].sort());
    const counts = await json<ItemCounts>(await call("GET", "/api/me/items/counts", a.cookie), 200);
    expect(counts).toMatchObject({ envie: 1, commande: 1 });
  });

  it("never links by name without a known shop, nor when two articles share the name", async () => {
    const a = await account();
    const shop = await newShop();
    const one = await wish(a, (await newProduct(shop.id, "Top Iris")).id);
    const two = await wish(a, (await newProduct(shop.id, "Top Iris")).id);
    const noShop = await json<OrderView>(await confirm(a, await draft(a, null, [{ name: "Top Iris" }])), 200);
    const twice = await json<OrderView>(await confirm(a, await draft(a, shop.id, [{ name: "Top Iris" }])), 200);
    for (const order of [noShop, twice]) expect([one, two]).not.toContain(order.lines[0]?.itemId);
    expect((await getItem(a, one)).stage).toBe("spotted");
  });

  it("links her item of another of her profiles by its product, never by name, never another account's", async () => {
    const a = await account();
    const other = await account();
    const shop = await newShop();
    const theirs = await wish(other, (await newProduct(shop.id, "Blouse Aya")).id);
    const lea = await json<{ id: string }>(
      await call("POST", "/api/me/profiles", a.cookie, { name: "Léa", audience: "women", color: "plum" }),
      201,
    );
    const wishOfLea = async (name: string) => {
      const product = await newProduct(shop.id, name);
      const created = await json<{ item: ItemView }>(
        await call("POST", "/api/me/items", a.cookie, { productId: product.id, action: "wish", profileId: lea.id }),
        201,
      );
      return { productId: product.id, itemId: created.item.id };
    };
    const byProduct = await wishOfLea("Robe Mila");
    const byName = await wishOfLea("Jupe Nina");
    // The order is Moi's: Léa's wish is linked through its product (one active item per product, G2), never by name.
    const orderId = await draft(a, shop.id, [
      { name: "Robe Mila", productId: byProduct.productId },
      { name: "Jupe Nina" },
      { name: "Blouse Aya" },
    ]);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    expect(order.lines[0]?.itemId).toBe(byProduct.itemId);
    expect((await getItem(a, byProduct.itemId)).profileId).toBe(lea.id);
    const created = order.lines[1]?.itemId;
    expect(created).not.toBe(byName.itemId);
    expect((await getItem(a, created as string)).profileId).toBe(a.moi);
    expect((await getItem(a, byName.itemId)).stage).toBe("spotted");
    expect(order.lines[2]?.itemId).not.toBe(theirs);
    expect((await getItem(other, theirs)).stage).toBe("spotted");
  });

  it("names a typed shop on the article when the order has no known shop", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Sac Paola" }]);
    await json(await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, { shopName: "Chez Personne 42" }), 200);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    expect(order).toMatchObject({ shop: null, shopName: "Chez Personne 42" });
    expect((await getItem(a, order.lines[0]?.itemId as string)).shopName).toBe("Chez Personne 42");
  });

  it("is idempotent, also when sent twice at once", async () => {
    const a = await account();
    const shop = await newShop();
    const orderId = await draft(a, shop.id, [{ name: "Robe A" }, { name: "Robe B" }]);
    const [first, second] = await Promise.all([confirm(a, orderId), confirm(a, orderId)]);
    const views = [await json<OrderView>(first, 200), await json<OrderView>(second, 200)];
    expect(views[0]?.lines.map((l) => l.itemId)).toEqual(views[1]?.lines.map((l) => l.itemId));
    const again = await json<OrderView>(await confirm(a, orderId), 200);
    expect(again.lines.map((l) => l.itemId)).toEqual(views[0]?.lines.map((l) => l.itemId));
    expect(await itemsOf(a)).toHaveLength(2);
  });

  it("refuses a dismissed order (order_dismissed)", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Robe" }]);
    await json(await call("POST", `/api/me/orders/${orderId}/dismiss`, a.cookie), 200);
    expect(await json(await confirm(a, orderId), 409)).toEqual({ error: "order_dismissed" });
    expect(await itemsOf(a)).toHaveLength(0);
  });
});

describe("« Corriger » and « Ce n'est pas une commande »", () => {
  it("replaces the lines and finds a shop by its exact name, case and accents aside", async () => {
    const a = await account();
    const n = ++counter;
    const shop = await newShop(`Les Étoffes ${n}`);
    const orderId = await draft(a, null, [{ name: "Ancienne ligne" }]);
    const order = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, {
        shopName: `  les etoffes ${n} `,
        externalRef: "",
        orderedAt: "2026-11-11T10:00:00Z",
        lines: [
          { name: "Robe", sizeLabel: "M", quantity: 1, priceCents: 1000, currency: "EUR" },
          { name: "Jupe", quantity: 2 },
        ],
      }),
      200,
    );
    expect(order).toMatchObject({
      shop: { id: shop.id },
      shopName: shop.name,
      externalRef: null,
      orderedAt: "2026-11-11T10:00:00.000Z",
      status: "draft",
    });
    expect(order.lines.map((l) => [l.name, l.quantity])).toEqual([
      ["Robe", 1],
      ["Jupe", 2],
    ]);
  });

  it("keeps the product read from the e-mail on a line whose name stays", async () => {
    const a = await account();
    const shop = await newShop();
    const product = await newProduct(shop.id, "Cardigan");
    const orderId = await draft(a, shop.id, [{ name: "Cardigan Lou", productId: product.id }, { name: "Bonnet" }]);
    const order = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, {
        lines: [
          { name: "cardigan lou", sizeLabel: "M", quantity: 1 },
          { name: "Écharpe", quantity: 1 },
        ],
      }),
      200,
    );
    expect(order.lines.map((l) => [l.name, l.productId])).toEqual([
      ["cardigan lou", product.id],
      ["Écharpe", null],
    ]);
  });

  it("keeps a typed name that matches no shop, and creates no shop", async () => {
    const a = await account();
    const orderId = await draft(a, (await newShop()).id, [{ name: "Robe" }]);
    const [{ n: before } = { n: 0 }] = await t.db.select({ n: sql<number>`count(*)::int` }).from(schema.shops);
    const order = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, { shopName: "Boutique Inventée Zx" }),
      200,
    );
    expect(order).toMatchObject({ shop: null, shopName: "Boutique Inventée Zx" });
    const [{ n: after } = { n: 0 }] = await t.db.select({ n: sql<number>`count(*)::int` }).from(schema.shops);
    expect(after).toBe(before);
  });

  it("moves the order to another of her profiles only", async () => {
    const a = await account();
    const other = await account();
    const orderId = await draft(a, null, [{ name: "Robe" }]);
    await t.db
      .insert(schema.alertEvents)
      .values({ userId: a.userId, profileId: a.moi, orderId, kind: "order_received" });
    expect((await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, { profileId: other.moi })).status).toBe(404);
    const created = await json<{ id: string }>(
      await call("POST", "/api/me/profiles", a.cookie, { name: "Léa", audience: "women", color: "plum" }),
      201,
    );
    const order = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, { profileId: created.id }),
      200,
    );
    expect(order.profileId).toBe(created.id);
    // « Commande reçue de … » goes with it.
    const alerts = await t.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.orderId, orderId));
    expect(alerts.map((alert) => alert.profileId)).toEqual([created.id]);
    const confirmed = await json<OrderView>(await confirm(a, orderId), 200);
    const [item] = await itemsOf(a);
    expect(item?.profileId).toBe(created.id);
    expect(confirmed.lines[0]?.itemId).toBe(item?.id);
  });

  it("changes only drafts (order_not_draft)", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Robe" }]);
    await json(await confirm(a, orderId), 200);
    expect(await json(await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, { externalRef: "2" }), 409)).toEqual({
      error: "order_not_draft",
    });
    expect(await json(await call("POST", `/api/me/orders/${orderId}/dismiss`, a.cookie), 409)).toEqual({
      error: "order_not_draft",
    });
  });

  it("dismisses a draft, twice without harm", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Robe" }]);
    const first = await json<OrderView>(await call("POST", `/api/me/orders/${orderId}/dismiss`, a.cookie), 200);
    expect(first.status).toBe("dismissed");
    await json(await call("POST", `/api/me/orders/${orderId}/dismiss`, a.cookie), 200);
    expect(await itemsOf(a)).toHaveLength(0);
  });

  it("rejects an invalid body (invalid_request)", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Robe" }]);
    const res = await call("PATCH", `/api/me/orders/${orderId}`, a.cookie, {
      lines: [{ name: "Robe", quantity: 1, priceCents: 100 }],
    });
    expect(await json(res, 400)).toEqual({ error: "invalid_request" });
  });
});

describe("POST /api/me/orders (saisie manuelle)", () => {
  it("records a confirmed order with its articles and parcel", async () => {
    const a = await account();
    const shop = await newShop();
    const wished = await wish(a, (await newProduct(shop.id, "Robe Nina")).id);
    const order = await json<OrderView>(
      await call("POST", "/api/me/orders", a.cookie, {
        profileId: a.moi,
        shopName: shop.name.toUpperCase(),
        lines: [
          { name: "Robe Nina", sizeLabel: "40", quantity: 1 },
          { name: "Ceinture", quantity: 1, priceCents: 1500, currency: "EUR" },
        ],
        trackingNumber: "6a 1234 5678 901",
      }),
      201,
    );
    expect(order).toMatchObject({
      status: "confirmed",
      source: "manual",
      parseMethod: "manual",
      shop: { id: shop.id },
    });
    expect(order.lines[0]?.itemId).toBe(wished);
    expect(order.parcels).toMatchObject([{ trackingNumber: "6A12345678901", carrier: "colissimo", status: "pending" }]);
    const [parcel] = await t.db.select().from(schema.parcels).where(eq(schema.parcels.orderId, order.id));
    expect(parcel?.nextCheckAt).not.toBeNull();
    expect(await itemsOf(a)).toHaveLength(2);
  });

  it("replaces an unreadable e-mail once (order_exists)", async () => {
    const a = await account();
    const [inbox] = await t.db
      .insert(schema.orderInboxes)
      .values({ userId: a.userId, localPart: `moi-${++counter}` })
      .returning();
    const [mail] = await t.db
      .insert(schema.inboundEmails)
      .values({
        userId: a.userId,
        inboxId: inbox?.id as string,
        queueId: `q${counter}`,
        fromAddress: "x@t.local",
        authOk: true,
        status: "failed",
        purgeAfter: new Date(Date.now() + 86_400_000),
      })
      .returning();
    const body = { profileId: a.moi, shopName: "X", lines: [{ name: "Robe", quantity: 1 }], inboundEmailId: mail?.id };
    const [first, second] = await Promise.all([
      call("POST", "/api/me/orders", a.cookie, body),
      call("POST", "/api/me/orders", a.cookie, body),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(await json((first.status === 409 ? first : second) as Response, 409)).toEqual({ error: "order_exists" });
    expect(await itemsOf(a)).toHaveLength(1);
  });

  it("replaces an unreadable e-mail of hers only", async () => {
    const a = await account();
    const other = await account();
    const [inbox] = await t.db
      .insert(schema.orderInboxes)
      .values({ userId: other.userId, localPart: `autre-${++counter}` })
      .returning();
    const [mail] = await t.db
      .insert(schema.inboundEmails)
      .values({
        userId: other.userId,
        inboxId: inbox?.id as string,
        queueId: `q${counter}`,
        fromAddress: "x@t.local",
        authOk: true,
        status: "failed",
        purgeAfter: new Date(Date.now() + 86_400_000),
      })
      .returning();
    const res = await call("POST", "/api/me/orders", a.cookie, {
      profileId: a.moi,
      shopName: "X",
      lines: [{ name: "Robe", quantity: 1 }],
      inboundEmailId: mail?.id,
    });
    expect(res.status).toBe(404);
  });

  it("replaces only an e-mail nothing could read (`failed`), never one still being read", async () => {
    const a = await account();
    const [inbox] = await t.db
      .insert(schema.orderInboxes)
      .values({ userId: a.userId, localPart: `elle-${++counter}` })
      .returning();
    for (const status of ["queued", "parsed", "ignored"]) {
      const [mail] = await t.db
        .insert(schema.inboundEmails)
        .values({
          userId: a.userId,
          inboxId: inbox?.id as string,
          queueId: `q${++counter}`,
          fromAddress: "x@t.local",
          authOk: true,
          status,
          purgeAfter: new Date(Date.now() + 86_400_000),
        })
        .returning();
      const res = await call("POST", "/api/me/orders", a.cookie, {
        profileId: a.moi,
        shopName: "X",
        lines: [{ name: "Robe", quantity: 1 }],
        inboundEmailId: mail?.id,
      });
      expect(res.status, status).toBe(404);
    }
    expect(await t.db.select().from(schema.orders).where(eq(schema.orders.userId, a.userId))).toEqual([]);
  });
});

describe("POST /api/me/items/{id}/tracking", () => {
  async function ordered(a: Account, name = "Veste") {
    const shop = await newShop();
    const id = await wish(a, (await newProduct(shop.id, name)).id);
    await json(
      await call("POST", `/api/me/items/${id}/stage`, a.cookie, { stage: "ordered", at: "2026-11-09T10:00:00Z" }),
      200,
    );
    return { id, shop };
  }

  it("starts an order `tracking` with its parcel, picked up by the tracking", async () => {
    const a = await account();
    const { id, shop } = await ordered(a);
    const order = await json<OrderView>(
      await call("POST", `/api/me/items/${id}/tracking`, a.cookie, { trackingNumber: "6A12345678901" }),
      201,
    );
    expect(order).toMatchObject({
      status: "confirmed",
      source: "tracking",
      shop: { id: shop.id },
      lines: [{ itemId: id, name: "Veste", quantity: 1 }],
      parcels: [{ carrier: "colissimo", trackingNumber: "6A12345678901", status: "pending" }],
    });
    const [parcel] = await t.db.select().from(schema.parcels).where(eq(schema.parcels.orderId, order.id));
    expect(parcel?.nextCheckAt?.getTime()).toBeGreaterThan(Date.now());
    expect(parcel?.checkUntil.getTime()).toBeGreaterThan(parcel?.nextCheckAt?.getTime() ?? 0);
  });

  it("takes her carrier for a digits-only number, and keeps an unknown one as `unknown`", async () => {
    const a = await account();
    const { id } = await ordered(a);
    const relay = await json<OrderView>(
      await call("POST", `/api/me/items/${id}/tracking`, a.cookie, {
        trackingNumber: "12345678",
        carrier: "mondial_relay",
      }),
      201,
    );
    expect(relay.parcels).toMatchObject([{ carrier: "mondial_relay", status: "pending" }]);
    const unknown = await json<OrderView>(
      await call("POST", `/api/me/items/${id}/tracking`, a.cookie, { trackingNumber: "ZZ99887766" }),
      200,
    );
    expect(unknown.id).toBe(relay.id);
    expect(unknown.parcels.find((p) => p.trackingNumber === "ZZ99887766")).toMatchObject({
      carrier: null,
      status: "unknown",
    });
  });

  it("adds the parcel to the order of an article born from one, once", async () => {
    const a = await account();
    const orderId = await draft(a, null, [{ name: "Écharpe" }]);
    const confirmed = await json<OrderView>(await confirm(a, orderId), 200);
    const itemId = confirmed.lines[0]?.itemId as string;
    const body = { trackingNumber: "6A12345678901" };
    const first = await json<OrderView>(await call("POST", `/api/me/items/${itemId}/tracking`, a.cookie, body), 200);
    expect(first.id).toBe(orderId);
    const again = await json<OrderView>(await call("POST", `/api/me/items/${itemId}/tracking`, a.cookie, body), 200);
    expect(again.parcels).toHaveLength(1);
  });

  it("never deadlocks nor links twice with a « C'est bon » of the draft holding the number", async () => {
    for (let round = 0; round < 5; round++) {
      const a = await account();
      const { id, shop } = await ordered(a, "Veste Noé");
      const number = `6A${String(10_000_000_000 + round * 7 + counter).slice(0, 11)}`;
      const orderId = await draft(a, shop.id, [{ name: "Veste Noé" }], { trackingNumber: number });
      const [confirmed, pasted] = await Promise.all([
        confirm(a, orderId),
        call("POST", `/api/me/items/${id}/tracking`, a.cookie, { trackingNumber: number }),
      ]);
      expect(confirmed.status).toBe(200);
      expect([200, 409]).toContain(pasted.status);
      const holders = await t.db
        .selectDistinct({ orderId: schema.orderLines.orderId })
        .from(schema.orderLines)
        .innerJoin(schema.orders, eq(schema.orders.id, schema.orderLines.orderId))
        .where(and(eq(schema.orderLines.itemId, id), eq(schema.orders.status, "confirmed")));
      expect(holders).toEqual([{ orderId }]);
    }
  });

  it("refuses a number already on another of her orders (tracking_exists)", async () => {
    const a = await account();
    await draft(a, null, [{ name: "Robe" }], { trackingNumber: "6A99999999999" });
    const { id } = await ordered(a);
    const res = await call("POST", `/api/me/items/${id}/tracking`, a.cookie, { trackingNumber: "6A99999999999" });
    expect(await json(res, 409)).toEqual({ error: "tracking_exists" });
  });

  it("needs an article « Commandé » of hers", async () => {
    const a = await account();
    const other = await account();
    const shop = await newShop();
    const spotted = await wish(a, (await newProduct(shop.id, "Robe")).id);
    const body = { trackingNumber: "6A12345678901" };
    expect(await json(await call("POST", `/api/me/items/${spotted}/tracking`, a.cookie, body), 409)).toEqual({
      error: "item_not_ordered",
    });
    const { id } = await ordered(a);
    expect((await call("POST", `/api/me/items/${id}/tracking`, other.cookie, body)).status).toBe(404);
    expect((await call("POST", `/api/me/items/${id}/tracking`, a.cookie, { trackingNumber: "12" })).status).toBe(400);
  });
});

describe("articles without a product", () => {
  async function productless(a: Account) {
    const orderId = await draft(a, null, [{ name: "Bonnet" }]);
    const order = await json<OrderView>(await confirm(a, orderId), 200);
    return order.lines[0]?.itemId as string;
  }

  it("go to the trash and come back, one by one or in a batch", async () => {
    const a = await account();
    const id = await productless(a);
    await json(await call("DELETE", `/api/me/items/${id}`, a.cookie), 200);
    const restored = await json<MutationResult & { item: ItemView }>(
      await call("POST", `/api/me/items/${id}/restore`, a.cookie),
      200,
    );
    expect(restored.item).toMatchObject({ id, deletedAt: null, product: null });

    await json(await call("POST", "/api/me/items/bulk", a.cookie, { ids: [id], op: "delete" }), 200);
    const batch = await json<MutationResult>(
      await call("POST", "/api/me/items/bulk", a.cookie, { ids: [id], op: "restore" }),
      200,
    );
    expect(batch.itemIds).toEqual([id]);
    expect((await getItem(a, id)).deletedAt).toBeNull();
  });

  it("change stage in a batch, and their name in place", async () => {
    const a = await account();
    const id = await productless(a);
    await json(
      await call("POST", "/api/me/items/bulk", a.cookie, {
        ids: [id],
        op: "stage",
        stage: "owned",
        at: "2026-11-12T10:00:00Z",
      }),
      200,
    );
    await json(await call("PATCH", `/api/me/items/${id}`, a.cookie, { nameOverride: "Bonnet rayé" }), 200);
    expect(await getItem(a, id)).toMatchObject({ stage: "owned", name: "Bonnet rayé", product: null });
  });
});
