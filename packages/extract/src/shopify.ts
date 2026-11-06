import { z } from "zod";
import { buildShopData, cleanDate, cleanGtin, cleanImages, cleanList, cleanText } from "./clean";
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
  const found = names.findIndex((n) => SIZE_OPTION.test(n));
  const index = found === -1 ? 0 : found;
  const key = (["option1", "option2", "option3"] as const)[index];

  const bySize = new Map<string, { available: boolean; priceCents: number | undefined }>();
  if (key && names.length > 0) {
    for (const v of p.variants) {
      const label = cleanText(v[key], 40);
      if (!label) continue;
      const entry = bySize.get(label);
      const variantAvailable = v.available === true;
      if (!entry) {
        bySize.set(label, { available: variantAvailable, priceCents: v.price });
      } else if (variantAvailable && !entry.available) {
        bySize.set(label, { available: true, priceCents: v.price ?? entry.priceCents });
      }
    }
  }
  const sizes = [...bySize].map(([label, s]) => ({
    label,
    available: s.available,
    ...(s.priceCents !== undefined && s.priceCents !== p.price ? { priceCents: s.priceCents } : {}),
  }));

  const tags = typeof p.tags === "string" ? p.tags.split(",") : (p.tags ?? []);
  // No product-level code in Shopify: per-size barcodes are kept apart in shopData.gtins.
  const gtins = cleanList(p.variants.map((v) => cleanGtin(v.barcode)));

  return {
    name,
    publishedAt: cleanDate(p.published_at),
    shopData: buildShopData({ gtins, category: cleanText(p.type, 200), tags: cleanList(tags) }),
    brand: cleanText(p.vendor, 120),
    description: cleanText(p.description, 5000),
    priceCents: p.price,
    compareAtCents: p.compare_at_price ?? undefined,
    images: cleanImages(p.images, pageUrl),
    sizes,
    externalId: p.id === undefined ? undefined : String(p.id),
  };
}
