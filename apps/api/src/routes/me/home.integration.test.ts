import { eq, schema } from "@closyria/db";
import type { HomeView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
/** 11 November 2026, 10:00 in Paris (UTC+1). */
const NOW = new Date("2026-11-11T09:00:00.000Z");
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(`/api${path}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

async function home(cookie: string) {
  const res = await call("GET", "/me/home", cookie);
  expect(res.status).toBe(200);
  return (await res.json()) as HomeView;
}

async function profileOf(cookie: string) {
  const profiles = (await (await call("GET", "/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const id = profiles.profiles[0]?.id;
  if (!id) throw new Error("no profile");
  return id;
}

type ItemOptions = {
  stage?: string;
  sizeLabel?: string;
  priority?: boolean;
  photo?: boolean;
  createdAt?: Date;
  /** Captures of the product, oldest first. */
  history?: { seenAt: string; priceCents: number; sizes?: Record<string, boolean> }[];
};

async function newItem(cookie: string, userId: string, options: ItemOptions = {}) {
  const k = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique H${k}`, slug: `me-home-shop-${k}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const last = options.history?.at(-1);
  const [product] = await t.db
    .insert(schema.products)
    .values({
      shopId: shop.id,
      canonicalUrl: `https://me-home-${k}.test/p`,
      name: `Robe ${k}`,
      currency: "EUR",
      priceCents: last?.priceCents ?? 5000,
      captureStatus: "ok",
    })
    .returning();
  if (!product) throw new Error("no product");
  if (options.photo) {
    await t.db.insert(schema.productImages).values({
      productId: product.id,
      position: 0,
      key: `products/${product.id}/a.webp`,
      width: 300,
      height: 400,
      sourceHash: `h${k}`,
    });
  }
  for (const point of options.history ?? []) {
    await t.db.insert(schema.productHistory).values({
      productId: product.id,
      seenAt: at(point.seenAt),
      priceCents: point.priceCents,
      sizes: point.sizes ?? {},
    });
  }
  const [item] = await t.db
    .insert(schema.items)
    .values({
      userId,
      profileId: await profileOf(cookie),
      productId: product.id,
      stage: options.stage ?? "spotted",
      sizeLabel: options.sizeLabel ?? null,
      priority: options.priority ?? false,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    })
    .returning();
  if (!item) throw new Error("no item");
  return { item, product, shop };
}

async function newList(cookie: string, name: string) {
  const res = await call("POST", "/me/wishlists", cookie, { name });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function addToList(cookie: string, listId: string, itemId: string) {
  expect((await call("POST", `/me/wishlists/${listId}/items`, cookie, { itemId })).status).toBe(200);
}

async function addOpinion(listId: string, itemId: string, name: string, when: string, note = "Fonce !") {
  await t.db.insert(schema.wishlistOpinions).values({
    wishlistId: listId,
    itemId,
    authorName: name,
    authorNameKey: name.toLowerCase(),
    level: 4,
    note,
    createdAt: at(when),
    updatedAt: at(when),
  });
}

/** Everything that can be news, for one account. */
async function everyKind() {
  const { cookie, userId } = await t.signIn();
  const drop = await newItem(cookie, userId, {
    photo: true,
    history: [
      { seenAt: "2026-10-20T08:00:00.000Z", priceCents: 6290 },
      { seenAt: "2026-11-10T08:00:00.000Z", priceCents: 4990 },
    ],
  });
  const back = await newItem(cookie, userId, {
    sizeLabel: "38",
    history: [
      { seenAt: "2026-10-20T08:00:00.000Z", priceCents: 5000, sizes: { "38": false, "40": true } },
      { seenAt: "2026-11-09T08:00:00.000Z", priceCents: 5000, sizes: { "38": true, "40": true } },
    ],
  });
  const opinionList = await newList(cookie, "Anniversaire");
  const liked = await newItem(cookie, userId);
  await addToList(cookie, opinionList.id, liked.item.id);
  await addOpinion(opinionList.id, liked.item.id, "Léa", "2026-11-08T08:00:00.000Z", "Jolie");
  await addOpinion(opinionList.id, liked.item.id, "Inès", "2026-11-08T12:00:00.000Z", "Fonce, il est parfait");
  const groupList = await newList(cookie, "Commande");
  await t.db.insert(schema.groupOrders).values({
    wishlistId: groupList.id,
    shopId: liked.shop.id,
    status: "open",
    shippingLabel: "Colissimo",
    shippingCents: 590,
    currency: "EUR",
    updatedAt: at("2026-11-07T08:00:00.000Z"),
  });
  const giftList = await newList(cookie, "Noël");
  await t.db
    .update(schema.wishlists)
    .set({ allowGifts: true, giftOccasion: "Mon anniversaire", giftDate: "2026-11-05" })
    .where(eq(schema.wishlists.id, giftList.id));
  return { cookie, userId, drop, back, opinionList, liked, groupList, giftList };
}

describe("GET /api/me/home", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/me/home", undefined)).status).toBe(401);
  });

  it("is empty for a new account: no une, no news, no wishes", async () => {
    const { cookie } = await t.signIn();
    expect(await home(cookie)).toEqual({ greetingName: null, hasItems: false, une: null, news: [], wishes: [] });
  });

  it("gives each kind of news with its link, newest first, the une being the newest with a photo", async () => {
    const s = await everyKind();
    const view = await home(s.cookie);

    expect(view.hasItems).toBe(true);
    expect(view.une).toMatchObject({
      kind: "price_drop",
      itemId: s.drop.item.id,
      title: s.drop.product.name,
      detail: s.drop.shop.name,
      href: `/produits/${s.drop.product.id}`,
      at: "2026-11-10T08:00:00.000Z",
      priceCents: 4990,
      previousPriceCents: 6290,
      currency: "EUR",
    });
    expect(view.une?.photoUrl).toEqual(expect.stringContaining("/api/catalog-images/"));
    expect(view.news.map((n) => [n.kind, n.href])).toEqual([
      ["size_back", `/produits/${s.back.product.id}`],
      ["opinion", `/listes/${s.opinionList.id}`],
      ["group_order", `/listes/${s.groupList.id}/commande-groupee`],
      ["gift_reminder", `/listes/${s.giftList.id}`],
    ]);
    expect(view.news[0]).toMatchObject({ itemId: s.back.item.id, sizeLabel: "38", at: "2026-11-09T08:00:00.000Z" });
    expect(view.news[1]).toMatchObject({
      itemId: s.liked.item.id,
      title: s.liked.product.name,
      authorName: "Inès",
      detail: "Fonce, il est parfait",
      count: 2,
    });
    expect(view.news[2]).toMatchObject({ title: "Commande", detail: s.liked.shop.name, groupOrderStatus: "open" });
    expect(view.news[3]).toMatchObject({ title: "Noël", detail: "Mon anniversaire" });
  });

  it("drops opinions once seen, and old or foreign changes are never news", async () => {
    const { cookie, userId } = await t.signIn();
    // A drop 12 days ago, a price rise, a size back that is not hers, and her size still out.
    await newItem(cookie, userId, {
      history: [
        { seenAt: "2026-10-01T08:00:00.000Z", priceCents: 6000 },
        { seenAt: "2026-10-30T08:00:00.000Z", priceCents: 5000 },
      ],
    });
    await newItem(cookie, userId, {
      history: [
        { seenAt: "2026-10-01T08:00:00.000Z", priceCents: 5000 },
        { seenAt: "2026-11-10T08:00:00.000Z", priceCents: 6000 },
      ],
    });
    await newItem(cookie, userId, {
      sizeLabel: "36",
      history: [
        { seenAt: "2026-10-01T08:00:00.000Z", priceCents: 5000, sizes: { "36": false, "40": false } },
        { seenAt: "2026-11-10T08:00:00.000Z", priceCents: 5000, sizes: { "36": false, "40": true } },
      ],
    });
    // A drop on an item she already received is no longer news.
    await newItem(cookie, userId, {
      stage: "owned",
      history: [
        { seenAt: "2026-10-01T08:00:00.000Z", priceCents: 6000 },
        { seenAt: "2026-11-10T08:00:00.000Z", priceCents: 5000 },
      ],
    });
    const list = await newList(cookie, "Été");
    const liked = await newItem(cookie, userId);
    await addToList(cookie, list.id, liked.item.id);
    await addOpinion(list.id, liked.item.id, "Léa", "2026-11-10T08:00:00.000Z");
    expect((await home(cookie)).news.map((n) => n.kind)).toEqual(["opinion"]);
    expect((await call("POST", `/me/wishlists/${list.id}/opinions/seen`, cookie)).status).toBe(204);

    // Another account's news never reach her.
    await everyKind();
    const view = await home(cookie);
    expect(view.une).toBeNull();
    expect(view.news).toEqual([]);
  });

  it("keeps at most five news", async () => {
    const { cookie, userId } = await t.signIn();
    for (let day = 4; day <= 10; day++) {
      await newItem(cookie, userId, {
        history: [
          { seenAt: "2026-10-01T08:00:00.000Z", priceCents: 6000 },
          { seenAt: `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`, priceCents: 5000 },
        ],
      });
    }
    const view = await home(cookie);
    expect(view.une).toBeNull();
    expect(view.news.map((n) => n.at)).toEqual([
      "2026-11-10T08:00:00.000Z",
      "2026-11-09T08:00:00.000Z",
      "2026-11-08T08:00:00.000Z",
      "2026-11-07T08:00:00.000Z",
      "2026-11-06T08:00:00.000Z",
    ]);
  });

  it("shows four wishes, priority ones first then the newest, never other steps or the trash", async () => {
    const { cookie, userId } = await t.signIn();
    const made = [];
    for (let day = 1; day <= 5; day++) {
      made.push(await newItem(cookie, userId, { createdAt: at(`2026-11-0${day}T08:00:00.000Z`) }));
    }
    const priority = await newItem(cookie, userId, { priority: true, createdAt: at("2026-10-01T08:00:00.000Z") });
    await newItem(cookie, userId, { stage: "owned", createdAt: at("2026-11-10T08:00:00.000Z") });
    const trashed = await newItem(cookie, userId, { createdAt: at("2026-11-10T09:00:00.000Z") });
    await t.db.update(schema.items).set({ deletedAt: NOW }).where(eq(schema.items.id, trashed.item.id));

    const view = await home(cookie);
    expect(view.wishes.map((w) => w.id)).toEqual([
      priority.item.id,
      made[4]?.item.id,
      made[3]?.item.id,
      made[2]?.item.id,
    ]);
  });
});
