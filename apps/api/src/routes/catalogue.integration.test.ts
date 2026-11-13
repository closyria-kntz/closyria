import { eq, schema, sql } from "@closyria/db";
import { type CatalogCard, catalogDetailSchema, catalogPageSchema } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { foldText } from "../catalog/catalogue";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

// Catalogue « Découvrir », task 3: the catalogue of visible products, its sheet and the reports.

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let me: { cookie: string; userId: string };
let other: { cookie: string; userId: string };
let counter = 0;
const NOW = new Date("2026-11-13T12:00:00Z");
const DAY = 24 * 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let ref: {
  dresses: string;
  shortDress: string;
  wrapDress: string;
  shoes: string;
  bags: string;
  red: string;
  black: string;
};

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
  me = await t.signIn();
  other = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ name: "Camille Secrète", email: "camille.secrete@example.test", isAnonymous: false })
    .where(eq(schema.user.id, other.userId));
  const cat = async (slug: string, name: string, parentId?: string) => {
    const [row] = await t.db
      .insert(schema.categories)
      .values({ slug, name, ...(parentId ? { parentId } : {}) })
      .returning();
    if (!row) throw new Error("no category");
    return row.id;
  };
  const color = async (slug: string, name: string, keywords: string[]) => {
    const [row] = await t.db.insert(schema.colors).values({ slug, name, hex: "#aa0000", keywords }).returning();
    if (!row) throw new Error("no color");
    return row.id;
  };
  const dresses = await cat("robes", "Robes");
  ref = {
    dresses,
    shortDress: await cat("robe-courte", "Robe courte", dresses),
    // A sub-category the size table does not name: it inherits « Robes ».
    wrapDress: await cat("robe-portefeuille", "Robe portefeuille", dresses),
    shoes: await cat("chaussures", "Chaussures"),
    bags: await cat("sacs", "Sacs"),
    red: await color("rouge", "Rouge", ["rouge", "bordeaux"]),
    black: await color("noir", "Noir", ["noir"]),
  };
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

beforeEach(async () => {
  await t.db.delete(schema.productReports);
  await t.db.delete(schema.itemEvents);
  await t.db.delete(schema.items);
  await t.db.delete(schema.profiles);
  await t.db.delete(schema.products);
  await t.db.delete(schema.shopDomains);
  await t.db.delete(schema.shops);
});

function call(method: string, path: string, cookie: string, body?: unknown) {
  return t.app.request(`/api${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newShop(values: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `cat-shop-${n}`, status: "published", ...values })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

type ProductOptions = Partial<typeof schema.products.$inferInsert> & {
  image?: boolean;
  sizes?: [string, boolean][];
};

async function newProduct(shopId: string, options: ProductOptions = {}) {
  const n = ++counter;
  const { image = true, sizes = [], ...values } = options;
  const [p] = await t.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://cat.test/${n}`,
      name: `Article ${n}`,
      priceCents: 5000,
      currency: "EUR",
      createdAt: ago(30 * DAY),
      ...values,
    })
    .returning();
  if (!p) throw new Error("no product");
  if (image) {
    await t.db.insert(schema.productImages).values({
      productId: p.id,
      position: 0,
      key: `products/${p.id}/${n}.webp`,
      width: 600,
      height: 800,
      sourceHash: `h${n}`,
    });
  }
  if (sizes.length > 0) {
    await t.db
      .insert(schema.productSizes)
      .values(sizes.map(([label, available], position) => ({ productId: p.id, label, available, position })));
  }
  return p;
}

async function newProfile(userId: string, values: Partial<typeof schema.profiles.$inferInsert> = {}) {
  const [row] = await t.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum", ...values })
    .returning();
  if (!row) throw new Error("no profile");
  return row;
}

async function newItem(
  userId: string,
  productId: string,
  values: Partial<typeof schema.items.$inferInsert> = {},
): Promise<string> {
  const [profile] = await t.db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1);
  const profileId = values.profileId ?? profile?.id ?? (await newProfile(userId)).id;
  const [row] = await t.db
    .insert(schema.items)
    .values({ userId, productId, profileId, ...values })
    .returning();
  if (!row) throw new Error("no item");
  return row.id;
}

async function page(query = "", cookie = me.cookie) {
  const res = await call("GET", `/catalog${query}`, cookie);
  expect(res.status).toBe(200);
  return catalogPageSchema.parse(await res.json());
}

const ids = (cards: CatalogCard[]) => cards.map((c) => c.productId);

async function detail(productId: string, query = "", cookie = me.cookie) {
  const res = await call("GET", `/catalog/${productId}${query}`, cookie);
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, body: catalogDetailSchema.parse(JSON.parse(text)) };
}

describe("access", () => {
  it("needs a session for every route", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id);
    expect((await call("GET", "/catalog", "")).status).toBe(401);
    expect((await call("GET", `/catalog/${p.id}`, "")).status).toBe(401);
    expect((await call("POST", `/catalog/${p.id}/report`, "", { reason: "other" })).status).toBe(401);
  });
});

describe("GET /api/catalog — visibility", () => {
  it("lists only products of published shops, not hidden, not removed, with a photo, a price and a name", async () => {
    const shop = await newShop();
    const visible = await newProduct(shop.id);
    await newProduct((await newShop({ status: "pending" })).id);
    await newProduct((await newShop({ status: "draft" })).id);
    await newProduct(shop.id, { hiddenAt: ago(DAY) });
    await newProduct(shop.id, { removedAt: ago(DAY) });
    await newProduct(shop.id, { image: false });
    await newProduct(shop.id, { priceCents: null });
    await newProduct(shop.id, { name: null });

    const { items, nextCursor } = await page();
    expect(ids(items)).toEqual([visible.id]);
    expect(nextCursor).toBeNull();
    expect(items[0]).toMatchObject({
      name: visible.name,
      shop: { id: shop.id, name: shop.name },
      priceCents: 5000,
      previousPriceCents: null,
      currency: "EUR",
      sizeInStock: null,
      wanted: false,
    });
    expect(items[0]?.imageUrl).toMatch(/^\/api\/catalog-images\/[0-9a-f-]{36}$/);
  });

  it("answers 404 on the sheet of a product that is not visible, and on an unknown one", async () => {
    const hidden = await newProduct((await newShop()).id, { hiddenAt: ago(DAY) });
    const pending = await newProduct((await newShop({ status: "pending" })).id);
    for (const id of [hidden.id, pending.id, "00000000-0000-4000-8000-000000000000"]) {
      expect((await call("GET", `/catalog/${id}`, me.cookie)).status).toBe(404);
    }
    expect((await call("GET", "/catalog/not-a-uuid", me.cookie)).status).toBe(400);
  });
});

describe("GET /api/catalog — filters", () => {
  it("filters by category (with its sub-categories), color, shop and price", async () => {
    const shop = await newShop();
    const otherShop = await newShop();
    const dress = await newProduct(shop.id, { categoryId: ref.dresses, colorId: ref.red, priceCents: 3000 });
    const short = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.black, priceCents: 6000 });
    const shoes = await newProduct(otherShop.id, { categoryId: ref.shoes, colorId: ref.red, priceCents: 9000 });

    expect(new Set(ids((await page(`?category=${ref.dresses}`)).items))).toEqual(new Set([dress.id, short.id]));
    expect(ids((await page(`?category=${ref.shortDress}`)).items)).toEqual([short.id]);
    expect(new Set(ids((await page(`?color=${ref.red}`)).items))).toEqual(new Set([dress.id, shoes.id]));
    expect(ids((await page(`?shop=${otherShop.id}`)).items)).toEqual([shoes.id]);
    expect(ids((await page("?priceMin=4000&priceMax=7000")).items)).toEqual([short.id]);
    expect(ids((await page(`?category=${ref.dresses}&color=${ref.red}`)).items)).toEqual([dress.id]);
  });

  it("filters by the shop's values (all of them), sales and novelties", async () => {
    const eco = await newShop({ values: ["eco", "made_in_france"] });
    const plain = await newShop();
    const a = await newProduct(eco.id, { createdAt: ago(2 * DAY), priceCents: 4000, compareAtCents: 5000 });
    const b = await newProduct(plain.id, { createdAt: ago(8 * DAY), priceCents: 4000, compareAtCents: 4000 });
    const c = await newProduct(plain.id, { createdAt: ago(10 * DAY), priceCents: 4000, compareAtCents: 3000 });

    expect(ids((await page("?values=eco")).items)).toEqual([a.id]);
    expect(ids((await page("?values=eco,made_in_france")).items)).toEqual([a.id]);
    expect(ids((await page("?values=eco,second_hand")).items)).toEqual([]);
    expect(ids((await page("?onSale=true")).items)).toEqual([a.id]);
    expect(ids((await page("?isNew=true")).items)).toEqual([a.id]);
    const all = await page();
    expect(ids(all.items)).toEqual([a.id, b.id, c.id]);
    // The crossed price only when it is above the price (the same rule as the item card's « −10 € »).
    expect(all.items.map((i) => i.previousPriceCents)).toEqual([5000, null, null]);
  });

  it("searches the name, the brand, the shop, the category and the color, accents and case aside", async () => {
    const shop = await newShop({ name: "Maison Élise" });
    const dress = await newProduct(shop.id, { name: "Robe Bohème", categoryId: ref.shortDress, colorId: ref.red });
    const top = await newProduct((await newShop({ name: "Atelier" })).id, {
      name: "T-shirt écru",
      brand: "Cœur Léger",
    });
    const coat = await newProduct((await newShop({ name: "Autre" })).id, { name: "Manteau", colorId: ref.black });

    expect(ids((await page("?q=boheme")).items)).toEqual([dress.id]);
    expect(ids((await page("?q=ELISE")).items)).toEqual([dress.id]);
    expect(ids((await page("?q=coeur")).items)).toEqual([top.id]);
    expect(ids((await page("?q=t-shirt")).items)).toEqual([top.id]);
    expect(ids((await page("?q=Ecru")).items)).toEqual([top.id]);
    expect(ids((await page(`?q=${encodeURIComponent("robe rouge")}`)).items)).toEqual([dress.id]);
    expect(ids((await page("?q=bordeaux")).items)).toEqual([dress.id]);
    expect(ids((await page("?q=noir")).items)).toEqual([coat.id]);
    expect(ids((await page(`?q=${encodeURIComponent("robe noir")}`)).items)).toEqual([]);
    // Nothing searchable left: no article, never the whole catalogue.
    expect(ids((await page(`?q=${encodeURIComponent("'&|!:*()")}`)).items)).toEqual([]);
    expect(ids((await page(`?q=${encodeURIComponent("— !")}`)).items)).toEqual([]);
  });

  it("folds the letters of Latin Extended-A the same way in the search and in the stored text", async () => {
    const shop = await newShop({ name: "Łódź Atelier" });
    const a = await newProduct(shop.id, { name: "Veste Šimić" });
    const b = await newProduct((await newShop()).id, { name: "Gürtel Straße Øre" });
    expect(ids((await page("?q=simic")).items)).toEqual([a.id]);
    expect(ids((await page(`?q=${encodeURIComponent("ŠIMIĆ")}`)).items)).toEqual([a.id]);
    expect(ids((await page("?q=lodz")).items)).toEqual([a.id]);
    expect(ids((await page("?q=strasse")).items)).toEqual([b.id]);
    expect(ids((await page(`?q=${encodeURIComponent("gürtel øre")}`)).items)).toEqual([b.id]);
  });

  it("folds every letter of Latin-1 and Latin Extended-A alike in SQL (`catalog_fold`) and in the API", async () => {
    const letters = Array.from({ length: 0x180 - 0xc0 }, (_, i) => String.fromCodePoint(0xc0 + i))
      .filter((ch) => /\p{L}/u.test(ch) && ch !== "ŉ" && ch !== "İ")
      .join(" ");
    const { rows } = await t.db.execute<{ folded: string }>(sql`select catalog_fold(${letters}) as folded`);
    expect(rows[0]?.folded).toBe(foldText(letters));
    expect(foldText(letters)).toMatch(/^[a-z ]+$/);
  });

  it("« Ma taille en stock » compares her size by kind of article, case and spaces aside", async () => {
    const shop = await newShop();
    const dressM = await newProduct(shop.id, {
      categoryId: ref.shortDress,
      sizes: [
        ["S", false],
        [" m ", true],
      ],
    });
    const dressSoldOut = await newProduct(shop.id, {
      categoryId: ref.dresses,
      sizes: [
        ["M", false],
        ["L", true],
      ],
    });
    const shoes38 = await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["38", true]] });
    const shoes40 = await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["40", true]] });
    const bag = await newProduct(shop.id, { categoryId: ref.bags });
    const unfiled = await newProduct(shop.id);
    await newProfile(me.userId, { sizeTop: "M", sizeShoes: "38" });
    const kid = await newProfile(me.userId, { name: "Léa", position: 1, sizeTop: "L" });

    const all = await page();
    const inStock = new Map(all.items.map((i) => [i.productId, i.sizeInStock]));
    expect(inStock.get(dressM.id)).toBe(true);
    expect(inStock.get(dressSoldOut.id)).toBe(false);
    expect(inStock.get(shoes38.id)).toBe(true);
    expect(inStock.get(shoes40.id)).toBe(false);
    expect(inStock.get(bag.id)).toBeNull();
    expect(inStock.get(unfiled.id)).toBeNull();

    // Articles without a kind of size are not filtered out; those in her size but sold out are.
    expect(new Set(ids((await page("?mySize=true")).items))).toEqual(
      new Set([dressM.id, shoes38.id, bag.id, unfiled.id]),
    );
    // The sizes of the chosen profile.
    expect(new Set(ids((await page(`?mySize=true&profile=${kid.id}`)).items))).toEqual(
      new Set([dressSoldOut.id, shoes38.id, shoes40.id, bag.id, unfiled.id]),
    );
    // Another person's profile is never read: her first profile is used.
    const stranger = await newProfile(other.userId, { sizeTop: "L" });
    expect(new Set(ids((await page(`?mySize=true&profile=${stranger.id}`)).items))).toEqual(
      new Set([dressM.id, shoes38.id, bag.id, unfiled.id]),
    );
  });

  it("« Ma taille en stock » gives a sub-category its parent's kind of size, on the list and the sheet", async () => {
    const shop = await newShop();
    const inSize = await newProduct(shop.id, { categoryId: ref.wrapDress, sizes: [["M", true]] });
    const soldOut = await newProduct(shop.id, { categoryId: ref.wrapDress, sizes: [["M", false]] });
    await newProfile(me.userId, { sizeTop: "M" });

    const inStock = new Map((await page()).items.map((i) => [i.productId, i.sizeInStock]));
    expect(inStock.get(inSize.id)).toBe(true);
    expect(inStock.get(soldOut.id)).toBe(false);
    expect(ids((await page("?mySize=true")).items)).toEqual([inSize.id]);
    expect((await detail(inSize.id)).body.mySize).toBe("M");
  });

  it("« Ma taille en stock » filters nothing when she has no sizes", async () => {
    const shop = await newShop();
    await newProduct(shop.id, { categoryId: ref.shortDress, sizes: [["M", true]] });
    await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["38", false]] });
    expect((await page("?mySize=true")).items).toHaveLength(2);
    expect((await page()).items.map((i) => i.sizeInStock)).toEqual([null, null]);
    // The page says so, for « Ajoute tes tailles ».
    expect((await page()).hasSizes).toBe(false);
    const profile = await newProfile(me.userId, { sizeShoes: " " });
    expect((await page()).hasSizes).toBe(false);
    await t.db.update(schema.profiles).set({ sizeShoes: "38" }).where(eq(schema.profiles.id, profile.id));
    expect((await page()).hasSizes).toBe(true);
  });

  it("marks what she already wants, never what another person wants", async () => {
    const shop = await newShop();
    const mine = await newProduct(shop.id, { createdAt: ago(DAY) });
    const theirs = await newProduct(shop.id, { createdAt: ago(2 * DAY) });
    const trashed = await newProduct(shop.id, { createdAt: ago(3 * DAY) });
    await newItem(me.userId, mine.id);
    await newItem(other.userId, theirs.id);
    await newItem(me.userId, trashed.id, { deletedAt: ago(DAY) });
    expect((await page()).items.map((i) => i.wanted)).toEqual([true, false, false]);
  });

  it("rejects an invalid query or cursor", async () => {
    expect((await call("GET", "/catalog?sort=random", me.cookie)).status).toBe(400);
    expect((await call("GET", "/catalog?category=nope", me.cookie)).status).toBe(400);
    expect((await call("GET", "/catalog?cursor=garbage", me.cookie)).status).toBe(400);
    const forged = Buffer.from(JSON.stringify({ s: "new", k: ["x'; drop table products; --", "nope"] })).toString(
      "base64url",
    );
    expect((await call("GET", `/catalog?cursor=${forged}`, me.cookie)).status).toBe(400);
  });
});

describe("GET /api/catalog — sorts and pages", () => {
  it("sorts by newest, price both ways and popularity", async () => {
    const shop = await newShop();
    const a = await newProduct(shop.id, { createdAt: ago(1 * DAY), priceCents: 3000 });
    const b = await newProduct(shop.id, { createdAt: ago(2 * DAY), priceCents: 1000 });
    const c = await newProduct(shop.id, { createdAt: ago(3 * DAY), priceCents: 2000 });
    const third = await t.signIn();
    for (const userId of [me.userId, other.userId, third.userId]) await newItem(userId, c.id);
    // Two people: counted as none, so the order does not tell (b stays after the newer a).
    await newItem(me.userId, b.id);
    await newItem(other.userId, b.id);

    expect(ids((await page()).items)).toEqual([a.id, b.id, c.id]);
    expect(ids((await page("?sort=new")).items)).toEqual([a.id, b.id, c.id]);
    expect(ids((await page("?sort=price_asc")).items)).toEqual([b.id, c.id, a.id]);
    expect(ids((await page("?sort=price_desc")).items)).toEqual([a.id, c.id, b.id]);
    expect(ids((await page("?sort=popular")).items)).toEqual([c.id, a.id, b.id]);
  });

  for (const sort of ["new", "price_asc", "price_desc", "popular"] as const) {
    it(`pages by 24 without duplicates nor gaps (${sort}), even when products arrive between pages`, async () => {
      const shop = await newShop();
      const created: string[] = [];
      for (let i = 0; i < 50; i++) {
        // Ties on the price and the date, so that the id breaks them.
        const p = await newProduct(shop.id, { createdAt: ago((i % 5) * DAY), priceCents: 1000 * (i % 7) });
        created.push(p.id);
        if (i % 9 === 0) await newItem(other.userId, p.id);
      }
      const first = await page(`?sort=${sort}`);
      expect(first.items).toHaveLength(24);
      expect(first.nextCursor).not.toBeNull();
      // A product added after the first page does not shift the next ones.
      await newProduct(shop.id, { createdAt: ago(0), priceCents: 1000 });
      const second = await page(`?sort=${sort}&cursor=${first.nextCursor}`);
      expect(second.items).toHaveLength(24);
      const third = await page(`?sort=${sort}&cursor=${second.nextCursor}`);
      const seen = [...ids(first.items), ...ids(second.items), ...ids(third.items)];
      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(seen.filter((id) => created.includes(id)))).toEqual(new Set(created));
      // A cursor of one sort is refused by another.
      const otherSort = sort === "new" ? "popular" : "new";
      expect((await call("GET", `/catalog?sort=${otherSort}&cursor=${first.nextCursor}`, me.cookie)).status).toBe(400);
    });
  }
});

describe("GET /api/catalog/{productId}", () => {
  it("gives the photos, the sizes and her own item", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, {
      categoryId: ref.shortDress,
      sizes: [
        ["S", false],
        ["M", true],
      ],
      priceCents: 4000,
      compareAtCents: 6000,
    });
    await t.db.insert(schema.productImages).values({
      productId: p.id,
      position: 1,
      key: `products/${p.id}/b.webp`,
      width: 600,
      height: 800,
      sourceHash: "b",
    });
    await newProfile(me.userId, { sizeTop: "m" });

    const before = (await detail(p.id)).body;
    expect(before.images).toHaveLength(2);
    expect(before.imageUrl).toBe(before.images[0]);
    expect(before.sizes).toEqual([
      { label: "S", available: false },
      { label: "M", available: true },
    ]);
    expect(before).toMatchObject({ sizeInStock: true, previousPriceCents: 6000, wanted: false, myItem: null });
    // Her size for this kind of article, to put forward among the sizes; the shop's page for « Voir chez ».
    expect(before.mySize).toBe("m");
    expect(before.url).toBe(p.canonicalUrl);
    const bag = await newProduct(shop.id, { categoryId: ref.bags });
    expect((await detail(bag.id)).body.mySize).toBeNull();

    const itemId = await newItem(me.userId, p.id, { stage: "ordered" });
    const after = (await detail(p.id)).body;
    expect(after.wanted).toBe(true);
    expect(after.myItem).toEqual({ itemId, stage: "ordered" });
  });

  it("counts likes only from 3 people and never says who", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id);
    const third = await t.signIn();
    const fourth = await t.signIn();
    await newItem(other.userId, p.id);
    await newItem(third.userId, p.id);
    await newItem(fourth.userId, p.id, { deletedAt: ago(DAY) });
    expect((await detail(p.id)).body.likes).toBeNull();

    await newItem(me.userId, p.id, { stage: "owned" });
    const { body, text } = await detail(p.id);
    expect(body.likes).toBe(3);
    for (const secret of [other.userId, third.userId, fourth.userId, "Camille", "camille.secrete"]) {
      expect(text).not.toContain(secret);
    }
    // Her own item is hers; another person's never shows.
    const seenByOther = await detail(p.id, "", other.cookie);
    expect(seenByOther.text).not.toContain(me.userId);
    expect(seenByOther.body.myItem?.stage).toBe("spotted");
  });

  it("« proche »: up to 3 of her own owned pieces of the same category and color", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red });
    const mine: string[] = [];
    for (let i = 0; i < 4; i++) {
      const q = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red, createdAt: ago(i * DAY) });
      mine.push(await newItem(me.userId, q.id, { stage: "owned", createdAt: ago(i * DAY) }));
    }
    // Not close: a wish, a trashed piece, another color, someone else's dressing.
    const wish = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red });
    await newItem(me.userId, wish.id, { stage: "spotted" });
    const trashed = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red });
    await newItem(me.userId, trashed.id, { stage: "owned", deletedAt: ago(DAY) });
    const black = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.black });
    await newItem(me.userId, black.id, { stage: "owned" });
    const theirs = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red, createdAt: ago(0) });
    const theirItem = await newItem(other.userId, theirs.id, { stage: "owned", createdAt: ago(0) });

    const { body } = await detail(p.id);
    expect(body.close.map((c) => c.itemId)).toEqual(mine.slice(0, 3));
    // Her own sheet of each piece is at its product.
    const { rows: owned } = await t.db.execute<{ id: string; product_id: string }>(
      sql`select id, product_id from items where id = any(${`{${mine.join(",")}}`}::uuid[])`,
    );
    const productOf = new Map(owned.map((r) => [r.id, r.product_id]));
    expect(body.close.map((c) => c.productId)).toEqual(mine.slice(0, 3).map((id) => productOf.get(id)));
    // Her correction of the color wins over the product's.
    await t.db
      .update(schema.items)
      .set({ colorId: ref.black })
      .where(eq(schema.items.id, mine[0] ?? ""));
    expect((await detail(p.id)).body.close.map((c) => c.itemId)).toEqual(mine.slice(1, 4));
    // Another person sees nothing of her dressing, only her own.
    const seenByOther = await detail(p.id, "", other.cookie);
    expect(seenByOther.body.close.map((c) => c.itemId)).toEqual([theirItem]);
    for (const id of mine) expect(seenByOther.text).not.toContain(id);
  });

  it("« proche » lists her pieces as they are: hidden or unpublished products, no price, her cover first", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red });
    const hidden = await newProduct(shop.id, {
      name: "Robe masquée",
      categoryId: ref.shortDress,
      colorId: ref.red,
      hiddenAt: ago(DAY),
      priceCents: null,
      createdAt: ago(3 * DAY),
    });
    const unpublished = await newProduct((await newShop({ status: "pending" })).id, {
      name: "Robe en attente",
      categoryId: ref.shortDress,
      colorId: ref.red,
      image: false,
    });
    const profile = await newProfile(me.userId);
    const withCover = await newItem(me.userId, hidden.id, {
      stage: "owned",
      profileId: profile.id,
      nameOverride: "Ma robe rouge",
      createdAt: ago(2 * DAY),
    });
    const [cover] = await t.db
      .insert(schema.media)
      .values({
        id: crypto.randomUUID(),
        userId: me.userId,
        key: `media/${me.userId}/cover.webp`,
        contentType: "image/webp",
        sizeBytes: 10,
        width: 600,
        height: 800,
      })
      .returning();
    await t.db.update(schema.items).set({ coverMediaId: cover?.id }).where(eq(schema.items.id, withCover));
    const bare = await newItem(me.userId, unpublished.id, {
      stage: "owned",
      profileId: profile.id,
      createdAt: ago(DAY),
    });
    // On her second profile: not shown while she looks as her first one.
    const second = await newProfile(me.userId, { name: "Léa", position: 1 });
    const elsewhere = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red });
    const onSecond = await newItem(me.userId, elsewhere.id, { stage: "owned", profileId: second.id });

    const { body } = await detail(p.id);
    expect(body.close).toEqual([
      { itemId: bare, productId: unpublished.id, name: "Robe en attente", imageUrl: null, stage: "owned" },
      {
        itemId: withCover,
        productId: hidden.id,
        name: "Ma robe rouge",
        imageUrl: `/api/me/media/${cover?.id}`,
        stage: "owned",
      },
    ]);
    for (const piece of body.close) {
      expect(Object.keys(piece).sort()).toEqual(["imageUrl", "itemId", "name", "productId", "stage"]);
    }
    // Without her cover: the shop's photo.
    await t.db.update(schema.items).set({ coverMediaId: null }).where(eq(schema.items.id, withCover));
    const [shopPhoto] = await t.db
      .select({ id: schema.productImages.id })
      .from(schema.productImages)
      .where(eq(schema.productImages.productId, hidden.id));
    expect((await detail(p.id)).body.close[1]?.imageUrl).toBe(`/api/catalog-images/${shopPhoto?.id}`);
    // Looking as her second profile.
    expect((await detail(p.id, `?profile=${second.id}`)).body.close.map((c) => c.itemId)).toEqual([onSecond]);
  });

  it("« proche » is empty when the product has no category or color", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id);
    const q = await newProduct(shop.id);
    await newItem(me.userId, q.id, { stage: "owned" });
    expect((await detail(p.id)).body.close).toEqual([]);
  });

  it("same shop (up to 8) and same style (up to 8, other shops), visible ones only", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, { categoryId: ref.shortDress, colorId: ref.red, priceCents: 5000 });
    for (let i = 0; i < 9; i++) await newProduct(shop.id, { createdAt: ago(i * DAY) });
    await newProduct(shop.id, { hiddenAt: ago(DAY), createdAt: ago(0) });
    const elsewhere = await newShop();
    const sameBoth = await newProduct(elsewhere.id, {
      categoryId: ref.shortDress,
      colorId: ref.red,
      priceCents: 90000,
    });
    const sameColor = await newProduct(elsewhere.id, { categoryId: ref.shoes, colorId: ref.red, priceCents: 90000 });
    const nearPrice = await newProduct(elsewhere.id, { categoryId: ref.bags, colorId: ref.black, priceCents: 5500 });
    // Unfiled, at a near price (and newer): after the others, never first.
    const unfiled = await newProduct(elsewhere.id, { priceCents: 5200, createdAt: ago(0) });
    await newProduct(elsewhere.id, { categoryId: ref.bags, colorId: ref.black, priceCents: 90000 });
    await newProduct(elsewhere.id, { categoryId: ref.shortDress, colorId: ref.red, removedAt: ago(DAY) });

    const { body } = await detail(p.id);
    expect(body.sameShop).toHaveLength(8);
    expect(ids(body.sameShop)).not.toContain(p.id);
    expect(body.sameShop.every((c) => c.shop.id === shop.id)).toBe(true);
    expect(ids(body.sameStyle)).toEqual([sameBoth.id, sameColor.id, unfiled.id, nearPrice.id]);
  });
});

describe("POST /api/catalog/{productId}/report", () => {
  it("records one report per person and article, whatever the number of calls", async () => {
    const p = await newProduct((await newShop()).id);
    expect((await call("POST", `/catalog/${p.id}/report`, me.cookie, { reason: "shocking" })).status).toBe(204);
    expect((await call("POST", `/catalog/${p.id}/report`, me.cookie, { reason: "other" })).status).toBe(204);
    expect((await call("POST", `/catalog/${p.id}/report`, other.cookie, { reason: "not_fashion" })).status).toBe(204);
    const rows = await t.db.select().from(schema.productReports).where(eq(schema.productReports.productId, p.id));
    expect(rows.map((r) => [r.userId, r.reason]).sort()).toEqual(
      [
        [me.userId, "shocking"],
        [other.userId, "not_fashion"],
      ].sort(),
    );
  });

  it("refuses an unknown reason, an invisible or unknown article", async () => {
    const p = await newProduct((await newShop()).id);
    const hidden = await newProduct((await newShop()).id, { hiddenAt: ago(DAY) });
    expect((await call("POST", `/catalog/${p.id}/report`, me.cookie, { reason: "ugly" })).status).toBe(400);
    expect((await call("POST", `/catalog/${hidden.id}/report`, me.cookie, { reason: "other" })).status).toBe(404);
    expect(
      (await call("POST", "/catalog/00000000-0000-4000-8000-000000000000/report", me.cookie, { reason: "other" }))
        .status,
    ).toBe(404);
  });

  it("allows 20 reports an hour per person", async () => {
    const reporter = await t.signIn();
    const shop = await newShop();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const p = await newProduct(shop.id);
      statuses.push((await call("POST", `/catalog/${p.id}/report`, reporter.cookie, { reason: "other" })).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 204)).toBe(true);
    expect(statuses[20]).toBe(429);
    // Others are not affected.
    const p = await newProduct(shop.id);
    expect((await call("POST", `/catalog/${p.id}/report`, me.cookie, { reason: "other" })).status).toBe(204);
  });
});
