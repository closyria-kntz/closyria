import { type ExtractedProduct, extractedProductSchema, shopDomain } from "@closyria/shared";
import { z } from "zod";
import { buildShopData, cleanImages, cleanList, cleanRichText, cleanText } from "./clean";
import { COLOR_OPTION, SIZE_OPTION, sizeOptionIndex } from "./shopify";
import type { Candidate } from "./types";

/**
 * The WooCommerce Store API (public, no key): `GET /wp-json/wc/store/v1/products?per_page=100&page=n` lists the
 * products, `GET …/products/{id}` gives one product or one variation. Prices are strings in the currency's minor
 * units (`currency_minor_unit`). The listing gives each variation's attributes, never its stock: the per-size stock
 * needs one request per variation (`extractWooVariation`).
 */

const amount = z.string().regex(/^\d{1,15}$/);
const pricesSchema = z.object({
  price: amount,
  regular_price: z.string().nullish(),
  sale_price: z.string().nullish(),
  currency_code: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .nullish(),
  currency_minor_unit: z.number().int().min(0).max(4).default(2),
});
const termSchema = z.object({ name: z.string(), slug: z.string().nullish() });
const attributeSchema = z.object({
  name: z.string(),
  taxonomy: z.string().nullish(),
  has_variations: z.boolean().default(false),
  terms: z.array(termSchema).default([]),
});
const variationRefSchema = z.object({
  id: z.number().int().nonnegative(),
  attributes: z.array(z.object({ name: z.string(), value: z.string().nullish() })).default([]),
});
const named = z.array(z.object({ name: z.string() })).nullish();
const productSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  type: z.string().nullish(),
  permalink: z.string(),
  sku: z.string().nullish(),
  description: z.string().nullish(),
  short_description: z.string().nullish(),
  prices: pricesSchema,
  images: z.array(z.object({ src: z.string() })).default([]),
  categories: named,
  tags: named,
  brands: named,
  attributes: z.array(attributeSchema).default([]),
  variations: z.array(variationRefSchema).default([]),
  is_in_stock: z.boolean(),
  is_purchasable: z.boolean().nullish(),
});
const listedIdSchema = z.object({ id: z.number().int().nonnegative() });
const variationSchema = z.object({
  id: z.number().int().nonnegative(),
  is_in_stock: z.boolean(),
  is_purchasable: z.boolean().nullish(),
  prices: pricesSchema.nullish(),
});

/** One variation of a variable product: its id and the size labels it is sold in (all of them for « any size »). */
export type WooVariation = { id: string; sizes: string[] };

/** A product of the listing, as a capture would give it; its sizes take the product's own stock (no variation read). */
export type WooListedProduct = { url: string; product: ExtractedProduct; variations: WooVariation[] };

export type WooStorePage = {
  /** Products listed on the page, valid or not: fewer than the page size means the last page. */
  count: number;
  /** WooCommerce id of every listed product, valid or not: a product skipped here is still on sale. */
  listedIds: string[];
  products: WooListedProduct[];
};

/** What a variation read gives: its stock, and its price (in cents) when the shop sends one. */
export type WooVariationStock = { available: boolean; priceCents?: number };

/** An amount in the currency's minor units, as cents (`12345` with 3 decimals → 1235). */
function toCents(value: string, minorUnit: number): number {
  const n = Number(value);
  return minorUnit <= 2 ? n * 10 ** (2 - minorUnit) : Math.round(n / 10 ** (minorUnit - 2));
}

const centsOf = (prices: z.infer<typeof pricesSchema>) => {
  const priceCents = toCents(prices.price, prices.currency_minor_unit);
  const regular = prices.regular_price && amount.safeParse(prices.regular_price).success ? prices.regular_price : null;
  const regularCents = regular === null ? undefined : toCents(regular, prices.currency_minor_unit);
  return {
    priceCents,
    compareAtCents: regularCents !== undefined && regularCents > priceCents ? regularCents : undefined,
  };
};

const same = (a: string | null | undefined, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function listedProduct(item: unknown, origin: string): WooListedProduct | null {
  const parsed = productSchema.safeParse(item);
  if (!parsed.success) return null;
  const p = parsed.data;
  // The product's own address, on the shop's site only (it becomes the product's canonical address).
  let url: URL;
  try {
    url = new URL(p.permalink);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || shopDomain(url.href) !== shopDomain(origin)) {
    return null;
  }
  const { priceCents, compareAtCents } = centsOf(p.prices);
  const inStock = p.is_in_stock && p.is_purchasable !== false;

  // The sizes: from the attribute the variations vary on (« Taille/Size/Pointure », else the first one), like a
  // Shopify option; a simple product only has sizes when it shows a size attribute.
  const varying = p.attributes.filter((a) => a.has_variations);
  const sizeAttribute =
    p.variations.length > 0 && varying.length > 0
      ? varying[sizeOptionIndex(varying.map((a) => a.name))]
      : p.attributes.find((a) => SIZE_OPTION.test(a.name));
  const terms = cleanList(sizeAttribute?.terms.map((t) => t.name) ?? []).map((label) => label.slice(0, 40));
  const variations: WooVariation[] = [];
  if (sizeAttribute && p.variations.length > 0) {
    for (const v of p.variations) {
      const attribute = v.attributes.find(
        (a) => same(a.name, sizeAttribute.name) || same(sizeAttribute.taxonomy, a.name),
      );
      const value = attribute?.value?.trim() ?? "";
      let sizes: string[];
      if (!attribute || value === "") sizes = terms;
      else {
        const term = sizeAttribute.terms.find((t) => same(t.slug, value) || same(t.name, value));
        const label = cleanText(term?.name ?? value, 40);
        sizes = label ? [label] : [];
      }
      variations.push({ id: String(v.id), sizes });
    }
  }
  // Every size a variation is sold in, in the attribute's order; without variations, the attribute's terms.
  const covered = new Set(variations.flatMap((v) => v.sizes));
  const labels = variations.length > 0 ? [...new Set([...terms.filter((t) => covered.has(t)), ...covered])] : terms;

  const attributeValues = (pattern: RegExp) =>
    p.attributes.filter((a) => pattern.test(a.name.trim())).flatMap((a) => a.terms.map((t) => t.name));
  const categories = (p.categories ?? []).map((c) => c.name);
  const candidate: Candidate = {
    name: cleanText(p.name, 300) ?? "",
    brand: cleanText(p.brands?.[0]?.name, 120),
    description: cleanRichText(p.description || p.short_description, 5000),
    currency: (p.prices.currency_code ?? "EUR").toUpperCase(),
    priceCents,
    compareAtCents,
    images: cleanImages(
      p.images.map((i) => i.src),
      url.href,
    ),
    sizes: labels.map((label) => ({ label, available: inStock })),
    externalId: String(p.id),
    sku: cleanText(p.sku, 200),
    shopData: buildShopData({
      category: cleanText(categories[0], 200),
      tags: cleanList([...categories, ...(p.tags ?? []).map((t) => t.name)]),
      colors: cleanList(attributeValues(COLOR_OPTION)),
      material: cleanText(attributeValues(/composition|mati[eè]re/i)[0], 200),
    }),
  };
  const product = extractedProductSchema.safeParse({ ...candidate, platform: "other" });
  return product.success ? { url: url.href, product: product.data, variations } : null;
}

/**
 * One page of the Store API listing (a JSON array), each product mapped to what a capture gives. A product that does
 * not validate, or whose address is on another site, is skipped; null when the body is not such a page.
 */
export function extractWooStorePage(json: string, origin: string): WooStorePage | null {
  const raw = parseJson(json);
  if (!Array.isArray(raw)) return null;
  const listedIds: string[] = [];
  const products: WooListedProduct[] = [];
  for (const item of raw) {
    const id = listedIdSchema.safeParse(item);
    if (id.success) listedIds.push(String(id.data.id));
    const mapped = listedProduct(item, origin);
    if (mapped) products.push(mapped);
  }
  return { count: raw.length, listedIds, products };
}

/** One product of the Store API (`…/products/{id}`), mapped like a listed one; null when it is not one. */
export function extractWooStoreProduct(json: string, origin: string): WooListedProduct | null {
  const raw = parseJson(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return listedProduct(raw, origin);
}

/** The stock (and price) of one variation (`…/products/{variationId}`); null when the body is not one. */
export function extractWooVariation(json: string): (WooVariationStock & { id: string }) | null {
  const parsed = variationSchema.safeParse(parseJson(json));
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    id: String(v.id),
    available: v.is_in_stock && v.is_purchasable !== false,
    ...(v.prices ? { priceCents: centsOf(v.prices).priceCents } : {}),
  };
}

/**
 * The product with each size's stock from its variations: a size is available when one of its variations read is;
 * when none of them was read, its last known stock (`known`, by label), else the product's own. A size price is kept
 * only when it differs from the product price (as for Shopify).
 */
export function withVariationStock(
  item: WooListedProduct,
  stock: ReadonlyMap<string, WooVariationStock>,
  known: ReadonlyMap<string, boolean> = new Map(),
): ExtractedProduct {
  const { product } = item;
  const sizes = product.sizes.map((size) => {
    const read = item.variations
      .filter((v) => v.sizes.includes(size.label))
      .flatMap((v) => {
        const s = stock.get(v.id);
        return s ? [s] : [];
      });
    if (read.length === 0) return { label: size.label, available: known.get(size.label) ?? size.available };
    const chosen = read.find((s) => s.available) ?? read[0];
    const priceCents = chosen?.priceCents;
    return {
      label: size.label,
      available: chosen?.available ?? false,
      ...(priceCents !== undefined && priceCents !== product.priceCents ? { priceCents } : {}),
    };
  });
  return { ...product, sizes };
}
