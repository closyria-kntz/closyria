import { type Database, eq, schema } from "@closyria/db";
import {
  extractWooStoreProduct,
  extractWooVariation,
  type WooVariationStock,
  withVariationStock,
} from "@closyria/extract";
import { canonicalizeUrl, type ExtractedProduct, shopDomain } from "@closyria/shared";
import type { AddressPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";
import { decodeBody } from "./decode";
import type { RobotsCache } from "./robots";
import { safeFetch } from "./safe-fetch";
import type { Throttle } from "./throttle";

/** The WooCommerce Store API's products: public, no key. */
export const WOO_STORE_PRODUCTS = "/wp-json/wc/store/v1/products";
/** Variations read for one sheet (each one request on the shop's spacing); past them, the last known stock stays. */
export const WOO_REFRESH_MAX_VARIATIONS = 20;
/** Variation answers that say it is gone: that size is no longer on sale. */
const GONE = new Set([404, 410]);

export type WooStoreDeps = {
  db: Database;
  policy: AddressPolicy;
  robots: RobotsCache;
  throttle: Throttle;
  lookup?: Parameters<typeof safeFetch>[1]["lookup"];
};

export type WooStoreRead = {
  product: ExtractedProduct;
  httpStatus: number;
  /** Every variation's stock was read: the product's `variants_checked_at` moves. */
  complete: boolean;
};

/**
 * « Stocks frais » for an imported WooCommerce product (known by its numeric WooCommerce id): the product from the
 * Store API (`…/products/{id}`), then each variation's stock (at most `WOO_REFRESH_MAX_VARIATIONS`), on the shop's own
 * spacing, robots.txt checked first. Null when the Store API cannot say (off, unreadable, robots.txt, or a product at
 * another address than this one): the capture then reads the page as before. A refusal (401/403/429, a challenge)
 * throws, without asking the page.
 */
export async function readWooStore(url: string, productId: string, deps: WooStoreDeps): Promise<WooStoreRead | null> {
  const [row] = await deps.db
    .select({ externalId: schema.products.externalId, canonicalUrl: schema.products.canonicalUrl })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!row?.externalId || !/^\d{1,19}$/.test(row.externalId)) return null;
  const origin = new URL(url).origin;
  const fetchJson = async (target: string) => {
    if (!(await deps.robots.allows(target))) throw new CaptureError("robots_disallowed");
    await deps.throttle.wait(shopDomain(target));
    return safeFetch(target, { accept: "json", policy: deps.policy, ...(deps.lookup ? { lookup: deps.lookup } : {}) });
  };
  const refused = (error: unknown) => error instanceof CaptureError && error.code === "blocked";

  let item: ReturnType<typeof extractWooStoreProduct>;
  let httpStatus: number;
  try {
    const response = await fetchJson(`${origin}${WOO_STORE_PRODUCTS}/${row.externalId}`);
    item = extractWooStoreProduct(decodeBody(response.body, response.contentType), origin);
    httpStatus = response.status;
  } catch (error) {
    if (refused(error)) throw error;
    return null;
  }
  // Another product under that id (the shop renumbered, or an id that is not WooCommerce's): the page decides.
  if (!item || canonicalizeUrl(item.url) !== row.canonicalUrl) return null;

  const stock = new Map<string, WooVariationStock>();
  let complete = item.variations.length > 0 && item.variations.length <= WOO_REFRESH_MAX_VARIATIONS;
  for (const variation of item.variations.slice(0, WOO_REFRESH_MAX_VARIATIONS)) {
    try {
      const response = await fetchJson(`${origin}${WOO_STORE_PRODUCTS}/${variation.id}`);
      const read = extractWooVariation(decodeBody(response.body, response.contentType));
      if (!read || read.id !== variation.id) {
        complete = false;
        break;
      }
      stock.set(variation.id, {
        available: read.available,
        ...(read.priceCents === undefined ? {} : { priceCents: read.priceCents }),
      });
    } catch (error) {
      if (refused(error)) throw error;
      if (error instanceof CaptureError && error.code === "http_error" && GONE.has(error.httpStatus ?? 0)) {
        stock.set(variation.id, { available: false });
        continue;
      }
      complete = false;
      break;
    }
  }
  // A size whose variations could not be read keeps its last known stock.
  const known = new Map(
    (
      await deps.db
        .select({ label: schema.productSizes.label, available: schema.productSizes.available })
        .from(schema.productSizes)
        .where(eq(schema.productSizes.productId, productId))
    ).map((s) => [s.label, s.available] as const),
  );
  return { product: withVariationStock(item, stock, known), httpStatus, complete };
}
