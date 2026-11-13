import { eq, schema, sql } from "@closyria/db";
import { type CatalogCard, catalogDetailSchema, catalogPageSchema, isOneSize, sizeTokens } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { foldText } from "../catalog/catalogue";
import { requestSheetRefresh } from "../catalog/sheet-refresh";
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
  await t.db.delete(schema.captures);
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
      // Read just now: opening its sheet asks nothing in the background (the « stocks frais » tests set it).
      lastCapturedAt: NOW,
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
const textArrayParam = (values: string[]) =>
  sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

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

  it("« Ma taille en stock » is strict: one of her sizes for its kind available, or « taille unique » only", async () => {
    const shop = await newShop();
    const dressM = await newProduct(shop.id, {
      categoryId: ref.shortDress,
      sizes: [
        ["S", false],
        [" m ", true],
      ],
    });
    // One of her several sizes is enough (« 38 » finds « 38 FR »).
    const dress38 = await newProduct(shop.id, { categoryId: ref.dresses, sizes: [["38 FR", true]] });
    const dressSoldOut = await newProduct(shop.id, {
      categoryId: ref.dresses,
      sizes: [
        ["M", false],
        ["L", true],
      ],
    });
    const shoes38 = await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["EU 38,5", true]] });
    const shoes40 = await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["40", true]] });
    const bag = await newProduct(shop.id, { categoryId: ref.bags, sizes: [["M", true]] });
    const unfiled = await newProduct(shop.id, { sizes: [["M", true]] });
    const sizeless = await newProduct(shop.id, { categoryId: ref.shortDress });
    // « Taille unique » fits a sized kind (even shoes, where she gave none for Léa); never a bag or an unfiled one.
    const oneSize = await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["Taille unique", true]] });
    const oneSizeBag = await newProduct(shop.id, { categoryId: ref.bags, sizes: [["TU", true]] });
    const oneSizeUnfiled = await newProduct(shop.id, { sizes: [["T.U.", true]] });
    const oneSizeSoldOut = await newProduct(shop.id, { categoryId: ref.dresses, sizes: [["TU", false]] });
    const oneSizeAndMore = await newProduct(shop.id, {
      categoryId: ref.dresses,
      sizes: [
        ["TU", true],
        ["XL", true],
      ],
    });
    await newProfile(me.userId, { sizesTop: ["M", "38"], sizesShoes: ["38,5"] });
    const kid = await newProfile(me.userId, { name: "Léa", position: 1, sizesTop: ["L"] });

    const all = await page();
    const inStock = new Map(all.items.map((i) => [i.productId, i.sizeInStock]));
    expect(inStock.get(dressM.id)).toBe(true);
    expect(inStock.get(dress38.id)).toBe(true);
    expect(inStock.get(dressSoldOut.id)).toBe(false);
    expect(inStock.get(shoes38.id)).toBe(true);
    expect(inStock.get(shoes40.id)).toBe(false);
    expect(inStock.get(bag.id)).toBeNull();
    expect(inStock.get(unfiled.id)).toBeNull();
    expect(inStock.get(sizeless.id)).toBe(false);
    expect(inStock.get(oneSize.id)).toBe(true);
    expect(inStock.get(oneSizeBag.id)).toBeNull();
    expect(inStock.get(oneSizeUnfiled.id)).toBeNull();
    expect(inStock.get(oneSizeSoldOut.id)).toBe(false);
    expect(inStock.get(oneSizeAndMore.id)).toBe(false);

    // Accessories, unfiled and sizeless articles are left out, even in « taille unique »; a sized kind in it is kept.
    expect(new Set(ids((await page("?mySize=true")).items))).toEqual(
      new Set([dressM.id, dress38.id, shoes38.id, oneSize.id]),
    );
    // The sizes of the chosen profile: a kind she left empty (shoes for Léa) shows only its « taille unique ».
    expect(new Set(ids((await page(`?mySize=true&profile=${kid.id}`)).items))).toEqual(
      new Set([dressSoldOut.id, oneSize.id]),
    );
    // Another person's profile is never read: her first profile is used.
    const stranger = await newProfile(other.userId, { sizesTop: ["L"] });
    expect(new Set(ids((await page(`?mySize=true&profile=${stranger.id}`)).items))).toEqual(
      new Set([dressM.id, dress38.id, shoes38.id, oneSize.id]),
    );
  });

  it("« Ma taille en stock » gives a sub-category its parent's kind of size, on the list and the sheet", async () => {
    const shop = await newShop();
    const inSize = await newProduct(shop.id, { categoryId: ref.wrapDress, sizes: [["M", true]] });
    const soldOut = await newProduct(shop.id, { categoryId: ref.wrapDress, sizes: [["M", false]] });
    await newProfile(me.userId, { sizesTop: ["M", "38"] });

    const inStock = new Map((await page()).items.map((i) => [i.productId, i.sizeInStock]));
    expect(inStock.get(inSize.id)).toBe(true);
    expect(inStock.get(soldOut.id)).toBe(false);
    expect(ids((await page("?mySize=true")).items)).toEqual([inSize.id]);
    expect((await detail(inSize.id)).body.mySizes).toEqual(["M", "38"]);
  });

  it("« Ma taille en stock » filters nothing when she has no sizes", async () => {
    const shop = await newShop();
    await newProduct(shop.id, { categoryId: ref.shortDress, sizes: [["M", true]] });
    await newProduct(shop.id, { categoryId: ref.shoes, sizes: [["TU", true]] });
    expect((await page("?mySize=true")).items).toHaveLength(2);
    expect((await page()).items.map((i) => i.sizeInStock)).toEqual([null, null]);
    // The page says so, for « Ajoute tes tailles ».
    expect((await page()).hasSizes).toBe(false);
    const profile = await newProfile(me.userId, { sizesShoes: [" "] });
    expect((await page()).hasSizes).toBe(false);
    await t.db
      .update(schema.profiles)
      .set({ sizesShoes: ["38"] })
      .where(eq(schema.profiles.id, profile.id));
    expect((await page()).hasSizes).toBe(true);
  });

  it("matches labels in SQL exactly as `sizeTokens` and `isOneSize` do", async () => {
    const labels = [
      "38 FR",
      "FR 38",
      "EU 38",
      "T38",
      "Taille 38",
      "T 38",
      "S/M",
      "M - 38",
      "M (38)",
      "36-38",
      "36/38",
      "2XL",
      "XXL",
      "3XL",
      "XXXL",
      "38,5",
      "38.5",
      "38 1/2",
      "38½",
      "W28",
      "W28 L32",
      "w 28",
      " m ",
      "x l",
      "TU",
      "T.U.",
      "Taille unique",
      "One size",
      "OS",
      "Unique",
      "U",
      "XS",
      "Taille 38 (M)",
      "40|42",
      "L;XL",
      "1/2",
      "",
      "  ",
      "38\u00a0FR",
      "W28/L32",
      "Taille 36 ½",
      "S+M",
      "W28 L 32",
      "W 28 L 32",
      "W28L32",
      "EU38",
      "FR38",
      "T.38",
      "1XL",
      "1xs",
      "U 2",
      "TU 38",
      "L 40",
      "taille38",
      "XXS",
    ];
    const { rows } = await t.db.execute<{ label: string; tokens: string[]; one: boolean }>(sql`
      select label, catalog_size_tokens(label) as tokens, catalog_is_one_size(label) as one
      from unnest(${textArrayParam(labels)}) as label`);
    for (const row of rows) {
      expect([...row.tokens].sort(), JSON.stringify(row.label)).toEqual(sizeTokens(row.label));
      expect(row.one, JSON.stringify(row.label)).toBe(isOneSize(row.label));
    }
    expect(rows).toHaveLength(labels.length);
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

  it("« Nouveautés » goes by the shop's put-online date, else the day Closyria first saw the article", async () => {
    const shop = await newShop();
    // Imported today, but online at the shop for a month: not new.
    const old = await newProduct(shop.id, { createdAt: ago(DAY / 2), publishedAt: ago(30 * DAY) });
    // Seen long ago, put online 2 days ago: new, and newer than one first seen 3 days ago without a date.
    const fresh = await newProduct(shop.id, { createdAt: ago(40 * DAY), publishedAt: ago(2 * DAY) });
    const undated = await newProduct(shop.id, { createdAt: ago(3 * DAY) });

    expect(ids((await page("?sort=new")).items)).toEqual([fresh.id, undated.id, old.id]);
    expect(ids((await page("?isNew=true")).items)).toEqual([fresh.id, undated.id]);
  });

  for (const sort of ["new", "price_asc", "price_desc", "popular"] as const) {
    it(`pages by 24 without duplicates nor gaps (${sort}), even when products arrive between pages`, async () => {
      const shop = await newShop();
      const created: string[] = [];
      for (let i = 0; i < 50; i++) {
        // Ties on the price and the date, so that the id breaks them; a third put online by the shop (its date wins).
        const p = await newProduct(shop.id, {
          createdAt: ago((i % 5) * DAY),
          ...(i % 3 === 0 ? { publishedAt: ago((i % 4) * DAY + 3_600_000) } : {}),
          priceCents: 1000 * (i % 7),
        });
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
    await newProfile(me.userId, { sizesTop: ["m"] });

    const before = (await detail(p.id)).body;
    expect(before.images).toHaveLength(2);
    expect(before.imageUrl).toBe(before.images[0]);
    expect(before.sizes).toEqual([
      { label: "S", available: false },
      { label: "M", available: true },
    ]);
    expect(before).toMatchObject({ sizeInStock: true, previousPriceCents: 6000, wanted: false, myItem: null });
    // Her size for this kind of article, to put forward among the sizes; the shop's page for « Voir chez ».
    expect(before.mySizes).toEqual(["m"]);
    expect(before.url).toBe(p.canonicalUrl);
    const bag = await newProduct(shop.id, { categoryId: ref.bags });
    expect((await detail(bag.id)).body.mySizes).toEqual([]);

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

describe("GET /api/catalog/{productId} — live check (« stocks frais »)", () => {
  const MIN = 60_000;
  const refreshesOf = (productId: string) =>
    t.db.select().from(schema.captures).where(eq(schema.captures.productId, productId));
  /** Direct call, waiting for the asking the sheet never waits for. */
  const ask = async (productId: string, checkedAt: Date | null, queue = t.queue) => {
    const outcome = await requestSheetRefresh(t.db, queue, productId, checkedAt, NOW);
    await outcome.done;
    return outcome.refreshing;
  };
  const stale = { lastCapturedAt: ago(20 * MIN) };

  it("asks a fresh read of an article read over 15 min ago, once, and says so; never for a fresh one", async () => {
    const shop = await newShop();
    const old = await newProduct(shop.id, stale);
    const fresh = await newProduct(shop.id, { lastCapturedAt: ago(5 * MIN) });
    const callsBefore = t.calls.length;

    expect((await detail(old.id)).body).toMatchObject({ refreshing: true, checkedAt: ago(20 * MIN).toISOString() });
    await vi.waitFor(async () => expect(await refreshesOf(old.id)).toHaveLength(1));
    const [capture] = await refreshesOf(old.id);
    expect(capture).toMatchObject({ trigger: "refresh", status: "queued", requestedBy: null, url: old.canonicalUrl });
    await vi.waitFor(() => expect(t.calls.slice(callsBefore)).toEqual([{ queue: "capture-refresh", id: capture?.id }]));

    // Opened again while it runs (by her or anyone): the same read, nothing more asked.
    expect((await detail(old.id, "", other.cookie)).body.refreshing).toBe(true);
    expect(await refreshesOf(old.id)).toHaveLength(1);

    expect((await detail(fresh.id)).body).toMatchObject({ refreshing: false, checkedAt: ago(5 * MIN).toISOString() });
    expect(await refreshesOf(fresh.id)).toEqual([]);
  });

  it("a fresh sheet runs no query at all", async () => {
    const noDb = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("no query expected");
        },
      },
    ) as unknown as typeof t.db;
    const outcome = await requestSheetRefresh(
      noDb,
      t.queue,
      "00000000-0000-4000-8000-000000000000",
      ago(14 * MIN),
      NOW,
    );
    expect(outcome.refreshing).toBe(false);
  });

  it("never waits for the queue: a queue that hangs still gives refreshing at once", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, stale);
    const hanging = { ...t.queue, refreshProduct: () => new Promise<boolean>(() => {}) };
    const outcome = await requestSheetRefresh(t.db, hanging, p.id, ago(20 * MIN), NOW);
    expect(outcome.refreshing).toBe(true);
  });

  it("asks one for an article never read, but not again within the window after a failed one", async () => {
    const shop = await newShop();
    const never = await newProduct(shop.id, { lastCapturedAt: null });
    expect(await ask(never.id, null)).toBe(true);
    expect(await refreshesOf(never.id)).toHaveLength(1);

    const failed = await newProduct(shop.id, { lastCapturedAt: ago(60 * MIN) });
    await t.db.insert(schema.captures).values({
      productId: failed.id,
      shopId: shop.id,
      url: failed.canonicalUrl,
      trigger: "refresh",
      status: "failed",
      errorCode: "timeout",
      createdAt: ago(5 * MIN),
    });
    expect((await detail(failed.id)).body.refreshing).toBe(false);
    expect(await refreshesOf(failed.id)).toHaveLength(1);
  });

  it("never asks for a hidden or removed article, an unpublished or merged shop, or a shop captured by hand", async () => {
    const auto = await newShop();
    const manual = await newShop({ captureMode: "manual" });
    const pending = await newShop({ status: "pending" });
    const merged = await newShop({ mergedIntoId: auto.id });
    const old = { lastCapturedAt: ago(DAY) };
    const products = [
      await newProduct(auto.id, { ...old, hiddenAt: ago(DAY) }),
      await newProduct(auto.id, { ...old, removedAt: ago(DAY) }),
      await newProduct(manual.id, old),
      await newProduct(pending.id, old),
      await newProduct(merged.id, old),
    ];
    for (const p of products) {
      expect(await ask(p.id, ago(DAY))).toBe(false);
      expect(await refreshesOf(p.id)).toEqual([]);
    }
    // The sheet of the manual shop's article still opens, quietly.
    expect((await detail(products[2]?.id ?? "")).body.refreshing).toBe(false);
  });

  it("asks at most 10 refreshes a minute, every article together; past that the sheet shows its age", async () => {
    const shop = await newShop();
    const filler = await newProduct(shop.id, { lastCapturedAt: ago(MIN) });
    const recent = (n: number) =>
      t.db.insert(schema.captures).values(
        Array.from({ length: n }, (_, i) => ({
          productId: filler.id,
          shopId: shop.id,
          url: filler.canonicalUrl,
          trigger: "refresh",
          status: "succeeded",
          createdAt: ago(50_000 - i),
        })),
      );
    await recent(9);
    const ninth = await newProduct(shop.id, stale);
    expect(await ask(ninth.id, ago(20 * MIN))).toBe(true);
    const over = await newProduct(shop.id, stale);
    expect(await ask(over.id, ago(20 * MIN))).toBe(false);
    expect(await refreshesOf(over.id)).toEqual([]);
    expect((await detail(over.id)).body.refreshing).toBe(false);
  });

  it("Shopify slowed down: a 60 min window while doubled, no refresh in the nightly rhythm; other shops as usual", async () => {
    const shopify = await newShop({ platform: "shopify" });
    const otherShop = await newShop({ platform: "other" });
    await t.db.delete(schema.crawlSlowdowns);
    try {
      await t.db
        .insert(schema.crawlSlowdowns)
        .values({ platform: "shopify", level: "doubled", since: ago(MIN), until: ago(-5 * 60 * MIN) });
      const halfHour = await newProduct(shopify.id, { lastCapturedAt: ago(30 * MIN) });
      expect(await ask(halfHour.id, ago(30 * MIN))).toBe(false);
      const hourAndMore = await newProduct(shopify.id, { lastCapturedAt: ago(70 * MIN) });
      expect(await ask(hourAndMore.id, ago(70 * MIN))).toBe(true);
      const elsewhere = await newProduct(otherShop.id, { lastCapturedAt: ago(30 * MIN) });
      expect(await ask(elsewhere.id, ago(30 * MIN))).toBe(true);

      await t.db.update(schema.crawlSlowdowns).set({ level: "nightly" });
      const night = await newProduct(shopify.id, { lastCapturedAt: ago(DAY) });
      expect(await ask(night.id, ago(DAY))).toBe(false);
      expect(await refreshesOf(night.id)).toEqual([]);
      const nightElsewhere = await newProduct(otherShop.id, { lastCapturedAt: ago(DAY) });
      expect(await ask(nightElsewhere.id, ago(DAY))).toBe(true);
    } finally {
      await t.db.delete(schema.crawlSlowdowns);
    }
  });

  it("drops its row when the queue already has one for the article, and keeps the sheet when the queue is down", async () => {
    const shop = await newShop();
    const p = await newProduct(shop.id, { lastCapturedAt: ago(DAY) });
    const taken = { ...t.queue, refreshProduct: async () => false };
    await ask(p.id, ago(DAY), taken);
    expect(await refreshesOf(p.id)).toEqual([]);

    const down = {
      ...t.queue,
      refreshProduct: async () => {
        throw new Error("queue down");
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await ask(p.id, ago(DAY), down);
    log.mockRestore();
    expect(await refreshesOf(p.id)).toEqual([
      expect.objectContaining({ trigger: "refresh", status: "failed", errorCode: "queue_unavailable" }),
    ]);
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
