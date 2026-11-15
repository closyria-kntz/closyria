import { eq, schema } from "@closyria/db";
import type { HomeView, ItemView, OrderList, OrderView, OwnerGroupOrder, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

/**
 * « Après la commande », Task 7: what the screens need from the API — a carrier corrected on a parcel, the e-mails
 * nothing could read, the return deadline on an article, the return reminder as the « une », and articles without a
 * product in her lists, the shop filter and her friends' view.
 */

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
// Sunday 15 November 2026, 10:00 in Paris.
const NOW = new Date("2026-11-15T09:00:00Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
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

async function account() {
  const session = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ isAnonymous: false, name: "Marie Test", email: `screens${++counter}@t.local`, emailVerified: true })
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

async function shop(name = "Maison Lune") {
  const [row] = await t.db
    .insert(schema.shops)
    .values({ name, slug: `screens-shop-${++counter}`, status: "published" })
    .returning();
  return row?.id as string;
}

/** A validated order of one article without a product, with a parcel in `status`. */
async function orderWithParcel(
  a: Account,
  parcel: { carrier: "colissimo" | null; status: string; checkUntil?: Date; failures?: number },
  shopId: string | null = null,
) {
  const [order] = await t.db
    .insert(schema.orders)
    .values({ userId: a.userId, profileId: a.moi, shopId, status: "confirmed", source: "email", parseMethod: "known" })
    .returning();
  const [item] = await t.db
    .insert(schema.items)
    .values({ userId: a.userId, profileId: a.moi, productId: null, nameOverride: "Robe Iris", stage: "ordered" })
    .returning();
  await t.db.insert(schema.orderLines).values({ orderId: order?.id as string, itemId: item?.id, name: "Robe Iris" });
  const [row] = await t.db
    .insert(schema.parcels)
    .values({
      orderId: order?.id as string,
      carrier: parcel.carrier,
      trackingNumber: `12345${String(++counter).padStart(3, "0")}`,
      status: parcel.status,
      nextCheckAt: null,
      checkFailures: parcel.failures ?? 3,
      checkUntil: parcel.checkUntil ?? new Date(NOW.getTime() + 20 * DAY),
    })
    .returning();
  return { orderId: order?.id as string, itemId: item?.id as string, parcelId: row?.id as string };
}

const parcelRow = async (id: string) => (await t.db.select().from(schema.parcels).where(eq(schema.parcels.id, id)))[0];

describe("GET /api/me/orders", () => {
  it("gives each parcel the carrier's latest step", async () => {
    const a = await account();
    const { parcelId } = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    await t.db.insert(schema.parcelEvents).values([
      { parcelId, at: new Date(NOW.getTime() - 5 * HOUR), status: "in_transit", label: "Pris en charge" },
      { parcelId, at: new Date(NOW.getTime() - HOUR), status: "in_transit", label: "En cours d'acheminement" },
    ]);
    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    const parcel = list.orders.flatMap((o) => o.parcels).find((p) => p.id === parcelId);
    expect(parcel?.lastEventLabel).toBe("En cours d'acheminement");
  });
});

describe("PATCH /api/me/orders/{id}/parcels/{parcelId}", () => {
  it("sets the carrier she picked and starts the tracking again (pending, no failure, next check due)", async () => {
    const a = await account();
    const { orderId, parcelId } = await orderWithParcel(a, { carrier: null, status: "unknown" });
    const view = await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}/parcels/${parcelId}`, a.cookie, { carrier: "mondial_relay" }),
      200,
    );
    expect(view.parcels[0]).toMatchObject({ id: parcelId, carrier: "mondial_relay", status: "pending" });
    const row = await parcelRow(parcelId);
    expect(row).toMatchObject({ carrier: "mondial_relay", status: "pending", checkFailures: 0 });
    // The usual rhythm (6 hours for a parcel not out for delivery), within its 30 days.
    expect(row?.nextCheckAt?.toISOString()).toBe(new Date(NOW.getTime() + 6 * HOUR).toISOString());
    expect(row?.checkUntil.toISOString()).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
  });

  it("gives a tracking already over 30 more days", async () => {
    const a = await account();
    const { orderId, parcelId } = await orderWithParcel(a, {
      carrier: "colissimo",
      status: "unknown",
      checkUntil: new Date(NOW.getTime() - DAY),
    });
    await json<OrderView>(
      await call("PATCH", `/api/me/orders/${orderId}/parcels/${parcelId}`, a.cookie, { carrier: "chronopost" }),
      200,
    );
    const row = await parcelRow(parcelId);
    expect(row?.checkUntil.toISOString()).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(row?.nextCheckAt?.toISOString()).toBe(new Date(NOW.getTime() + 6 * HOUR).toISOString());
  });

  it("refuses a delivered parcel, a dismissed order, another account's parcel, a guest and a bad carrier", async () => {
    const a = await account();
    const delivered = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    const path = (o: { orderId: string; parcelId: string }) => `/api/me/orders/${o.orderId}/parcels/${o.parcelId}`;
    expect(await json(await call("PATCH", path(delivered), a.cookie, { carrier: "chronopost" }), 409)).toEqual({
      error: "parcel_delivered",
    });
    expect((await parcelRow(delivered.parcelId))?.carrier).toBe("colissimo");

    const dismissed = await orderWithParcel(a, { carrier: null, status: "unknown" });
    await t.db.update(schema.orders).set({ status: "dismissed" }).where(eq(schema.orders.id, dismissed.orderId));
    expect(await json(await call("PATCH", path(dismissed), a.cookie, { carrier: "gls" }), 409)).toEqual({
      error: "order_dismissed",
    });

    const other = await account();
    const theirs = await orderWithParcel(other, { carrier: null, status: "unknown" });
    expect(await json(await call("PATCH", path(theirs), a.cookie, { carrier: "gls" }), 404)).toEqual({
      error: "not_found",
    });
    // A parcel of another of her orders under this order's address: not found either.
    const mine = await orderWithParcel(a, { carrier: null, status: "unknown" });
    expect(
      await json(
        await call("PATCH", `/api/me/orders/${mine.orderId}/parcels/${dismissed.parcelId}`, a.cookie, {
          carrier: "gls",
        }),
        404,
      ),
    ).toEqual({ error: "not_found" });
    expect(await json(await call("PATCH", path(mine), a.cookie, { carrier: "la_poste" }), 400)).toEqual({
      error: "invalid_request",
    });

    const guest = await t.signIn();
    expect(await json(await call("PATCH", path(mine), guest.cookie, { carrier: "gls" }), 403)).toEqual({
      error: "account_required",
    });
  });
});

describe("« On n'a pas su lire cet e-mail »", () => {
  async function failedEmail(a: Account, receivedAt: Date, options: { purgeAfter?: Date; status?: string } = {}) {
    const [inbox] = await t.db
      .insert(schema.orderInboxes)
      .values({ userId: a.userId, localPart: `marie-s${++counter}`, active: false })
      .returning();
    const [row] = await t.db
      .insert(schema.inboundEmails)
      .values({
        userId: a.userId,
        inboxId: inbox?.id as string,
        queueId: `q${counter}`,
        fromAddress: "marie@example.com",
        authOk: true,
        status: options.status ?? "failed",
        receivedAt,
        purgeAfter: options.purgeAfter ?? new Date(receivedAt.getTime() + 30 * DAY),
      })
      .returning();
    return row?.id as string;
  }

  it("lists her unreadable e-mails, newest first, until typed, set aside or purged", async () => {
    const a = await account();
    const older = await failedEmail(a, new Date(NOW.getTime() - 3 * DAY));
    const newer = await failedEmail(a, new Date(NOW.getTime() - HOUR));
    const typed = await failedEmail(a, new Date(NOW.getTime() - 2 * HOUR));
    await failedEmail(a, new Date(NOW.getTime() - 40 * DAY), { purgeAfter: new Date(NOW.getTime() - DAY) });
    await failedEmail(a, new Date(NOW.getTime() - HOUR), { status: "parsed" });
    const other = await account();
    const theirs = await failedEmail(other, new Date(NOW.getTime() - HOUR));

    await json<OrderView>(
      await call("POST", "/api/me/orders", a.cookie, {
        profileId: a.moi,
        shopName: "Atelier Mona",
        lines: [{ name: "Pull marin", quantity: 1 }],
        inboundEmailId: typed,
      }),
      201,
    );
    const list = await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200);
    expect(list.unreadEmails).toEqual([
      { id: newer, receivedAt: new Date(NOW.getTime() - HOUR).toISOString() },
      { id: older, receivedAt: new Date(NOW.getTime() - 3 * DAY).toISOString() },
    ]);

    // « Ce n'est pas une commande »: no longer listed; twice is harmless; not another account's.
    const after = await json<OrderList>(await call("POST", `/api/me/order-emails/${older}/dismiss`, a.cookie), 200);
    expect(after.unreadEmails.map((e) => e.id)).toEqual([newer]);
    await json<OrderList>(await call("POST", `/api/me/order-emails/${older}/dismiss`, a.cookie), 200);
    expect(await json(await call("POST", `/api/me/order-emails/${theirs}/dismiss`, a.cookie), 404)).toEqual({
      error: "not_found",
    });
    // An e-mail she already typed cannot be set aside (its order stands).
    expect(await json(await call("POST", `/api/me/order-emails/${typed}/dismiss`, a.cookie), 404)).toEqual({
      error: "not_found",
    });
    const guest = await t.signIn();
    expect(await json(await call("POST", `/api/me/order-emails/${newer}/dismiss`, guest.cookie), 403)).toEqual({
      error: "account_required",
    });
  });
});

describe("articles after their order", () => {
  it("shows the return deadline on the article", async () => {
    const a = await account();
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-29" })
      .where(eq(schema.items.id, itemId));
    const item = await json<ItemView>(await call("GET", `/api/me/items/${itemId}`, a.cookie), 200);
    expect(item.returnDeadline).toBe("2026-11-29");
  });

  it("makes a due return reminder the « une » of « Accueil », photo or not, until it can no longer go back", async () => {
    const a = await account();
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "delivered" });
    await t.db
      .update(schema.items)
      .set({ stage: "owned", returnDeadline: "2026-11-18" })
      .where(eq(schema.items.id, itemId));
    await t.db.insert(schema.alertEvents).values({
      userId: a.userId,
      profileId: a.moi,
      itemId,
      kind: "return_reminder",
      createdAt: new Date(NOW.getTime() - HOUR),
      status: "sent",
    });
    const home = await json<HomeView>(await call("GET", "/api/me/home", a.cookie), 200);
    expect(home.une).toMatchObject({
      kind: "return_reminder",
      itemId,
      title: "Robe Iris",
      href: `/articles/${itemId}`,
      returnDeadline: "2026-11-18",
      returnDaysLeft: 3,
      photoUrl: null,
    });

    // Sent back: no longer news.
    await t.db.update(schema.items).set({ stage: "returned" }).where(eq(schema.items.id, itemId));
    const later = await json<HomeView>(await call("GET", "/api/me/home", a.cookie), 200);
    expect(later.une).toBeNull();
    expect(later.news.filter((n) => n.kind === "return_reminder")).toEqual([]);
  });

  it("lists articles without a product in her lists, under their order's shop, and to her friends", async () => {
    const a = await account();
    const shopId = await shop("Atelier Nuit");
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, shopId);
    const list = await json<WishlistView>(
      await call("POST", "/api/me/wishlists", a.cookie, { name: "Pour l'été" }),
      201,
    );
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId }), 200);

    const inList = await json<{ items: ItemView[] }>(
      await call("GET", `/api/me/items?wishlist=${list.id}`, a.cookie),
      200,
    );
    expect(inList.items.map((i) => i.id)).toEqual([itemId]);

    // « Boutique »: the order's shop is offered, and finds the article.
    const facets = await json<{ shops: { id: string; name: string }[] }>(
      await call("GET", "/api/me/facets", a.cookie),
      200,
    );
    expect(facets.shops).toContainEqual({ id: shopId, name: "Atelier Nuit" });
    const byShop = await json<{ items: ItemView[] }>(await call("GET", `/api/me/items?shop=${shopId}`, a.cookie), 200);
    expect(byShop.items.map((i) => i.id)).toEqual([itemId]);

    // Her own brand for an article stays hers: neither the bare article's nor a product's without a catalogue brand.
    await t.db.update(schema.items).set({ brandOverride: "Maison Rosa" }).where(eq(schema.items.id, itemId));
    const [product] = await t.db
      .insert(schema.products)
      .values({ shopId, canonicalUrl: `https://atelier-nuit.test/p/${++counter}`, name: "Robe Lune", brand: null })
      .returning();
    const [withProduct] = await t.db
      .insert(schema.items)
      .values({
        userId: a.userId,
        profileId: a.moi,
        productId: product?.id as string,
        stage: "spotted",
        brandOverride: "Ma marque à moi",
      })
      .returning();
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId: withProduct?.id }), 200);

    // Her friends see it too: her name for it and the order's shop, no brand, no shop link, no private photo.
    const share = await json<{ url: string }>(await call("POST", `/api/me/wishlists/${list.id}/share`, a.cookie), 200);
    const shared = await json<{
      items: { itemId: string; name: string | null; shopName: string; url: string; imageUrl: string | null }[];
    }>(await call("GET", `/api/shared/${share.url.slice("/l/".length)}`, undefined), 200);
    expect(shared.items).toEqual([
      expect.objectContaining({
        itemId,
        name: "Robe Iris",
        brand: null,
        shopName: "Atelier Nuit",
        url: "",
        imageUrl: null,
      }),
      expect.objectContaining({ itemId: withProduct?.id, name: "Robe Lune", brand: null }),
    ]);
  });

  it("puts an article without a product in a group order of its order's shop (no sizes, no photo)", async () => {
    const a = await account();
    const shopId = await shop("Atelier Nuit");
    const { itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "pending" }, shopId);
    const list = await json<WishlistView>(
      await call("POST", "/api/me/wishlists", a.cookie, { name: "Commande des copines" }),
      201,
    );
    await json(await call("POST", `/api/me/wishlists/${list.id}/items`, a.cookie, { itemId }), 200);
    await json(await call("POST", `/api/me/wishlists/${list.id}/share`, a.cookie), 200);

    const opened = await json<OwnerGroupOrder>(
      await call("POST", `/api/me/wishlists/${list.id}/group-order`, a.cookie, {
        shopId,
        shipping: { label: "Colissimo", shippingCents: 590, freeFromCents: null },
        deadline: null,
      }),
      201,
    );
    expect(opened.ownItems).toEqual([{ itemId, name: "Robe Iris", imageUrl: null, sizes: [] }]);

    const mine = await json<OwnerGroupOrder>(
      await call("PUT", `/api/me/group-orders/${opened.id}/own-lines`, a.cookie, {
        lines: [{ itemId, sizeLabel: "M", quantity: 1 }],
      }),
      200,
    );
    const owner = mine.people.find((p) => p.isOwner);
    expect(owner?.lines).toEqual([expect.objectContaining({ itemId, name: "Robe Iris" })]);
  });

  it("tells each line's article step: « Ajouter un numéro de suivi » only while still « Commandé »", async () => {
    const a = await account();
    const { orderId, itemId } = await orderWithParcel(a, { carrier: "colissimo", status: "in_transit" });
    const stageOf = async () =>
      (await json<OrderList>(await call("GET", "/api/me/orders", a.cookie), 200)).orders.find((o) => o.id === orderId)
        ?.lines[0]?.itemStage;
    expect(await stageOf()).toBe("ordered");
    await json(await call("POST", `/api/me/orders/${orderId}/received`, a.cookie, { answer: "yes" }), 200);
    expect(await stageOf()).toBe("owned");
    // Received: the API refuses a number on it, with its own code (the screen no longer offers it).
    expect(
      await json(
        await call("POST", `/api/me/items/${itemId}/tracking`, a.cookie, { trackingNumber: "6A12345678903" }),
        409,
      ),
    ).toEqual({ error: "item_not_ordered" });
    await t.db.update(schema.items).set({ deletedAt: NOW }).where(eq(schema.items.id, itemId));
    expect(await stageOf()).toBeNull();
  });
});
