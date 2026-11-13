import { type ExtractedProduct, extractedProductSchema } from "@closyria/shared";
import { z } from "zod";
import {
  buildShopData,
  cleanDate,
  cleanGtin,
  cleanImages,
  cleanList,
  cleanRichText,
  cleanText,
  parseMachinePriceCents,
} from "./clean";
import type { Candidate } from "./types";

/** True when the HTML carries Shopify markers. */
export function isShopifyPage(body: string): boolean {
  return body.includes("Shopify.shop") || body.includes("cdn.shopify.com");
}

/** `<product page>.js` for `…/products/<handle>` whatever the prefix; null for other pages. */
export function shopifyJsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/^(.*\/products\/[^/]+?)\/?$/);
  if (!match) return null;
  return `${parsed.origin}${match[1]}.js`;
}

const optionSchema = z.union([z.string(), z.object({ name: z.string() })]);
const shopifyProductSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  title: z.string(),
  vendor: z.string().nullish(),
  description: z.string().nullish(),
  images: z.array(z.unknown()).default([]),
  options: z.array(optionSchema).default([]),
  variants: z
    .array(
      z.object({
        available: z.boolean().optional(),
        price: z.number().optional(),
        sku: z.string().nullish(),
        barcode: z.union([z.string(), z.number()]).nullish(),
        option1: z.string().nullish(),
        option2: z.string().nullish(),
        option3: z.string().nullish(),
      }),
    )
    .default([]),
  price: z.number(),
  published_at: z.string().nullish(),
  type: z.string().nullish(),
  tags: z.union([z.array(z.string()), z.string()]).nullish(),
  compare_at_price: z.number().nullish(),
});

const SIZE_OPTION = /taille|size|pointure/i;

type VariantSizes = {
  available?: boolean | undefined;
  priceCents: number | undefined;
  option1?: string | null | undefined;
  option2?: string | null | undefined;
  option3?: string | null | undefined;
};

/**
 * Sizes from the variants: the « Taille/Size/Pointure » option, else the first one; a label is available when one
 * of its variants is. A size price is kept only when it differs from the product price.
 */
function sizesOf(names: string[], variants: VariantSizes[], productPriceCents: number): Candidate["sizes"] {
  const found = names.findIndex((n) => SIZE_OPTION.test(n));
  const index = found === -1 ? 0 : found;
  const key = (["option1", "option2", "option3"] as const)[index];

  const bySize = new Map<string, { available: boolean; priceCents: number | undefined }>();
  if (key && names.length > 0) {
    for (const v of variants) {
      const label = cleanText(v[key], 40);
      if (!label) continue;
      const entry = bySize.get(label);
      const variantAvailable = v.available === true;
      if (!entry) {
        bySize.set(label, { available: variantAvailable, priceCents: v.priceCents });
      } else if (variantAvailable && !entry.available) {
        bySize.set(label, { available: true, priceCents: v.priceCents ?? entry.priceCents });
      }
    }
  }
  return [...bySize].map(([label, s]) => ({
    label,
    available: s.available,
    ...(s.priceCents !== undefined && s.priceCents !== productPriceCents ? { priceCents: s.priceCents } : {}),
  }));
}

/** Candidate from a Shopify `/products/<handle>.js` body; null when it is not valid JSON of that shape. */
export function extractShopify(json: string, pageUrl: string): Candidate | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = shopifyProductSchema.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const name = cleanText(p.title, 300);
  if (!name) return null;

  const names = p.options.map((o) => (typeof o === "string" ? o : o.name));
  const variants = p.variants.map((v) => ({ ...v, priceCents: v.price }));
  const sizes = sizesOf(names, variants, p.price);

  const tags = typeof p.tags === "string" ? p.tags.split(",") : (p.tags ?? []);
  // No product-level code in Shopify: per-size barcodes are kept apart in shopData.gtins.
  const gtins = cleanList(p.variants.map((v) => cleanGtin(v.barcode)));

  return {
    name,
    publishedAt: cleanDate(p.published_at),
    shopData: buildShopData({ gtins, category: cleanText(p.type, 200), tags: cleanList(tags) }),
    brand: cleanText(p.vendor, 120),
    description: cleanRichText(p.description, 5000),
    priceCents: p.price,
    compareAtCents: p.compare_at_price ?? undefined,
    images: cleanImages(p.images, pageUrl),
    sizes,
    externalId: p.id === undefined ? undefined : String(p.id),
  };
}

const COLOR_OPTION = /^(couleur|couleurs|color|colour|colors|colours)$/i;
const HANDLE = /^[^/?#\\\s]+$/;
const catalogPageSchema = z.object({ products: z.array(z.unknown()) });
const listedIdSchema = z.object({ id: z.union([z.number().int().nonnegative(), z.string().min(1).max(40)]) });
const catalogProductSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  handle: z
    .string()
    .regex(HANDLE)
    .refine((h) => h !== "." && h !== ".."),
  body_html: z.string().nullish(),
  published_at: z.string().nullish(),
  vendor: z.string().nullish(),
  product_type: z.string().nullish(),
  tags: z.union([z.array(z.string()), z.string()]).nullish(),
  options: z.array(z.object({ name: z.string(), values: z.array(z.string()).default([]) })).default([]),
  variants: z
    .array(
      z.object({
        available: z.boolean().optional(),
        price: z.union([z.string(), z.number()]),
        compare_at_price: z.union([z.string(), z.number()]).nullish(),
        barcode: z.union([z.string(), z.number()]).nullish(),
        option1: z.string().nullish(),
        option2: z.string().nullish(),
        option3: z.string().nullish(),
      }),
    )
    .min(1),
  images: z.array(z.object({ src: z.string() })).default([]),
});

export type ShopifyCatalogPage = {
  /** Products listed on the page, valid or not: fewer than the page size means the last page. */
  count: number;
  /** Shopify id of every listed product, valid or not: a product skipped here is still on sale. */
  listedIds: string[];
  products: { url: string; product: ExtractedProduct }[];
};

/**
 * One page of a Shopify `/products.json` (public catalogue, prices as decimal strings), each product mapped to what a
 * capture of its `.js` gives. A product that does not validate is skipped; null when the body is not such a page.
 */
export function extractShopifyCatalogPage(json: string, origin: string): ShopifyCatalogPage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const page = catalogPageSchema.safeParse(raw);
  if (!page.success) return null;
  const products: ShopifyCatalogPage["products"] = [];
  const listedIds: string[] = [];
  for (const item of page.data.products) {
    const id = listedIdSchema.safeParse(item);
    if (id.success) listedIds.push(String(id.data.id));
    const mapped = catalogProduct(item, origin);
    if (mapped) products.push(mapped);
  }
  return { count: page.data.products.length, listedIds, products };
}

function catalogProduct(item: unknown, origin: string): ShopifyCatalogPage["products"][number] | null {
  const parsed = catalogProductSchema.safeParse(item);
  if (!parsed.success) return null;
  const p = parsed.data;
  const variants = p.variants.map((v) => ({
    ...v,
    priceCents: parseMachinePriceCents(v.price) ?? undefined,
    compareAtCents: v.compare_at_price == null ? undefined : (parseMachinePriceCents(v.compare_at_price) ?? undefined),
  }));
  // Like the `.js`: the product price is the lowest variant price, with that variant's compare-at price.
  let cheapest: (typeof variants)[number] | undefined;
  for (const v of variants) {
    if (v.priceCents !== undefined && (!cheapest || v.priceCents < (cheapest.priceCents ?? 0))) cheapest = v;
  }
  if (cheapest?.priceCents === undefined) return null;
  const priceCents = cheapest.priceCents;
  const compareAtCents =
    cheapest.compareAtCents !== undefined && cheapest.compareAtCents > priceCents ? cheapest.compareAtCents : undefined;

  const url = `${origin}/products/${encodeURIComponent(decodeHandle(p.handle))}`;
  const names = p.options.map((o) => o.name);
  const tags = typeof p.tags === "string" ? p.tags.split(",") : (p.tags ?? []);
  const colors = p.options.filter((o) => COLOR_OPTION.test(o.name.trim())).flatMap((o) => o.values);
  const candidate: Candidate = {
    name: cleanText(p.title, 300) ?? "",
    publishedAt: cleanDate(p.published_at),
    shopData: buildShopData({
      gtins: cleanList(p.variants.map((v) => cleanGtin(v.barcode))),
      category: cleanText(p.product_type, 200),
      tags: cleanList(tags),
      colors: cleanList(colors),
    }),
    brand: cleanText(p.vendor, 120),
    description: cleanRichText(p.body_html, 5000),
    priceCents,
    compareAtCents,
    images: cleanImages(
      p.images.map((i) => i.src),
      url,
    ),
    sizes: sizesOf(names, variants, priceCents),
    externalId: String(p.id),
  };
  const product = extractedProductSchema.safeParse({ ...candidate, currency: "EUR", platform: "shopify" });
  return product.success ? { url, product: product.data } : null;
}

function decodeHandle(handle: string): string {
  try {
    return decodeURIComponent(handle);
  } catch {
    return handle;
  }
}
