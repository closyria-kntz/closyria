import { and, eq, inArray, isNull, schema, sql } from "@closyria/db";
import {
  extractWooStorePage,
  extractWooVariation,
  type WooListedProduct,
  type WooVariationStock,
  withVariationStock,
} from "@closyria/extract";
import { CaptureError } from "../capture/capture-error";
import { decodeBody } from "../capture/decode";
import type { SafeResponse } from "../capture/safe-fetch";
import { WOO_STORE_PRODUCTS } from "../capture/woo-store";
import { writeProduct } from "../capture/write-product";
import {
  type CatalogSource,
  hashOf,
  type ImportContext,
  ImportStop,
  type Listed,
  RETRIED,
  withRetry,
} from "./import-core";

/** The Store API's largest page. */
export const WOO_PAGE_SIZE = 100;
/** 100 000 products. */
const MAX_PAGES = 1000;
/** Variation reads per import (each is one request, 1 s apart): an hourly run stays short. */
export const WOO_VARIATION_BUDGET = 300;
/** A variable product's per-size stock is read again at least this often, even with an unchanged listing. */
export const WOO_VARIANTS_RECHECK_MS = 24 * 60 * 60 * 1000;
const CHUNK = 1000;
/** Variation answers that say it is gone: that size is no longer on sale. */
const GONE = new Set([404, 410]);

/** The shop's counts on a listing page: its products, and its pages. */
const COUNT_HEADERS = ["x-wp-total", "x-wp-totalpages"] as const;

/** One of the shop's counts on a listing page, when it sends it. */
const headerCount = (response: SafeResponse, name: string): number | null => {
  const value = response.headers?.[name];
  return value !== undefined && /^\d{1,9}$/.test(value.trim()) ? Number(value) : null;
};

/** A 4xx is the shop's answer, not a hiccup: never asked again. */
const retried = (error: CaptureError) =>
  RETRIED.has(error.code) && !(error.httpStatus !== undefined && error.httpStatus < 500);

/**
 * A WooCommerce shop's public catalogue, through its Store API (`/wp-json/wc/store/v1/products?per_page=100&page=n`),
 * on the shop's own spacing (never the Shopify line). The listing's `X-WP-Total` is the progress bar's scale and
 * `X-WP-TotalPages` its end (else a short page). An API that is absent or disabled (404, not JSON) stops the import
 * with `woocommerce_api_unavailable`: nothing else is crawled.
 *
 * The listing has no per-size stock: one request per variation gives it, for the variable products that are new or
 * whose listing changed, and for every variable product at most once a day (`variants_checked_at`), the longest
 * unchecked first, within `WOO_VARIATION_BUDGET` requests per import. Between two reads a product keeps the per-size
 * stock last read (a new one takes the product's own until its first read).
 */
export function createWooSource(): CatalogSource<WooListedProduct> {
  /** The variable products listed, by WooCommerce id; and those this import wrote (new or changed). */
  const variable = new Map<string, WooListedProduct>();
  const changed = new Set<string>();
  let totalPages: number | null = null;

  return {
    maxPages: MAX_PAGES,
    // Products the Store API lists are known by their numeric id; another id (a SKU read from a pasted page) is not
    // the import's to judge.
    judged: sql`${schema.products.externalId} ~ '^[0-9]+$'`,
    fetchPage: async (ctx, page) => {
      const url = `${ctx.origin}${WOO_STORE_PRODUCTS}?per_page=${WOO_PAGE_SIZE}&page=${page}`;
      let response: SafeResponse;
      try {
        response = await withRetry(ctx, () => ctx.fetch(url, "json", { keepHeaders: COUNT_HEADERS }), retried);
      } catch (error) {
        if (error instanceof CaptureError && !ctx.signal.aborted) {
          // No Store API: an address the shop does not know (404), or a page that is not JSON.
          const missing = error.code === "invalid_data" || (error.code === "http_error" && error.httpStatus === 404);
          if (page === 1 && missing) throw new ImportStop("woocommerce_api_unavailable");
          // Past the last page of a shop that gives no page count: the listing is over.
          if (
            page > 1 &&
            totalPages === null &&
            error.code === "http_error" &&
            [400, 404].includes(error.httpStatus ?? 0)
          ) {
            return { count: 0, listedIds: [], products: [], last: true };
          }
        }
        throw error;
      }
      const listing = extractWooStorePage(decodeBody(response.body, response.contentType), ctx.origin);
      if (!listing) throw new ImportStop(page === 1 ? "woocommerce_api_unavailable" : "invalid_data");
      if (page === 1) totalPages = headerCount(response, "x-wp-totalpages");
      const last = totalPages !== null ? page >= totalPages : listing.count < WOO_PAGE_SIZE;
      return { ...listing, last, ...(page === 1 ? { total: headerCount(response, "x-wp-total") } : {}) };
    },
    // Its variations too: a size added or dropped is a change.
    hash: (item, listingKind) =>
      hashOf({ url: item.url, product: item.product, variations: item.variations }, listingKind),
    prepare: async (ctx, items) => lastKnownStock(ctx, items),
    pageDone: async (_ctx, { unchanged, written }) => {
      for (const item of [...unchanged.keys(), ...written]) {
        const id = item.product.externalId;
        if (id && item.variations.length > 0) variable.set(id, item);
      }
      for (const item of written) if (item.product.externalId) changed.add(item.product.externalId);
    },
    afterListing: async (ctx) => readVariations(ctx, variable, changed),
  };
}

/**
 * The variable products about to be written, with the per-size stock last read for them (by label); a new one, or a
 * new size, takes the product's own stock.
 */
async function lastKnownStock(ctx: ImportContext, items: WooListedProduct[]): Promise<Map<WooListedProduct, Listed>> {
  const out = new Map<WooListedProduct, Listed>();
  const variableItems = items.filter((item) => item.variations.length > 0 && item.product.externalId);
  if (variableItems.length === 0) return out;
  const rows = await ctx.deps.db
    .select({
      externalId: schema.products.externalId,
      label: schema.productSizes.label,
      available: schema.productSizes.available,
    })
    .from(schema.productSizes)
    .innerJoin(schema.products, eq(schema.products.id, schema.productSizes.productId))
    .where(
      and(
        eq(schema.products.shopId, ctx.shop.id),
        inArray(
          schema.products.externalId,
          variableItems.map((item) => item.product.externalId ?? ""),
        ),
      ),
    );
  const known = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const key = row.externalId ?? "";
    const sizes = known.get(key) ?? new Map<string, boolean>();
    // Several rows for one product (pasted under two addresses): in stock if one of them says so.
    sizes.set(row.label, (sizes.get(row.label) ?? false) || row.available);
    known.set(key, sizes);
  }
  for (const item of variableItems) {
    out.set(item, {
      url: item.url,
      product: withVariationStock(item, new Map(), known.get(item.product.externalId ?? "")),
    });
  }
  return out;
}

type Candidate = { item: WooListedProduct; rows: string[]; checked: number | null; changed: boolean };

/**
 * Reads the per-size stock of the variable products that need it (new or changed this import, or unchecked for a
 * day), never checked first, then the changed ones, then the longest unchecked, within the budget of requests. Each
 * variation is one request, 1 s apart; a gone one (404/410) is a size no longer on sale. A refusal (robots.txt,
 * 401/403/429) stops the import like a page's; any other failure leaves that product's stock as it was.
 */
async function readVariations(ctx: ImportContext, variable: Map<string, WooListedProduct>, changed: Set<string>) {
  const { db } = ctx.deps;
  const ids = [...variable.keys()];
  const rows: { id: string; externalId: string | null; variantsCheckedAt: Date | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(
      ...(await db
        .select({
          id: schema.products.id,
          externalId: schema.products.externalId,
          variantsCheckedAt: schema.products.variantsCheckedAt,
        })
        .from(schema.products)
        .where(
          and(
            eq(schema.products.shopId, ctx.shop.id),
            inArray(schema.products.externalId, ids.slice(i, i + CHUNK)),
            isNull(schema.products.removedAt),
          ),
        )),
    );
  }
  const byId = new Map<string, typeof rows>();
  for (const row of rows) byId.set(row.externalId ?? "", [...(byId.get(row.externalId ?? "") ?? []), row]);

  const dayAgo = ctx.now().getTime() - WOO_VARIANTS_RECHECK_MS;
  const candidates: Candidate[] = [];
  for (const [id, item] of variable) {
    const own = byId.get(id);
    if (!own?.length) continue;
    const checked = own.some((r) => r.variantsCheckedAt === null)
      ? null
      : Math.min(...own.map((r) => r.variantsCheckedAt?.getTime() ?? 0));
    const isChanged = changed.has(id);
    if (!isChanged && checked !== null && checked >= dayAgo) continue;
    candidates.push({ item, rows: own.map((r) => r.id), checked, changed: isChanged });
  }
  const rank = (c: Candidate) => (c.checked === null ? 0 : c.changed ? 1 : 2);
  candidates.sort((a, b) => rank(a) - rank(b) || (a.checked ?? 0) - (b.checked ?? 0));

  let budget = WOO_VARIATION_BUDGET;
  for (const candidate of candidates) {
    const { item } = candidate;
    // A product with more variations than what is left waits for the next import; smaller ones may still fit.
    if (item.variations.length > budget) continue;
    budget -= item.variations.length;
    const stock = await readStock(ctx, item);
    if (!stock) continue;
    const at = ctx.now();
    const product = withVariationStock(item, stock);
    for (const productId of candidate.rows) {
      await db.transaction(async (tx) => {
        await writeProduct(tx, {
          productId,
          product,
          url: item.url,
          listingKind: ctx.shop.listingKind,
          reference: ctx.reference,
          at,
          history: "on_change",
          extra: { variantsCheckedAt: at },
        });
      });
    }
  }
}

/** The stock of every variation of a product, or null when one could not be read (its stock stays as it was). */
async function readStock(ctx: ImportContext, item: WooListedProduct): Promise<Map<string, WooVariationStock> | null> {
  const stock = new Map<string, WooVariationStock>();
  for (const variation of item.variations) {
    await ctx.spacing();
    await ctx.beat();
    try {
      const response = await ctx.fetch(`${ctx.origin}${WOO_STORE_PRODUCTS}/${variation.id}`, "json");
      const read = extractWooVariation(decodeBody(response.body, response.contentType));
      if (!read || read.id !== variation.id) return null;
      stock.set(variation.id, {
        available: read.available,
        ...(read.priceCents === undefined ? {} : { priceCents: read.priceCents }),
      });
    } catch (error) {
      if (ctx.signal.aborted) throw new ImportStop("interrupted");
      // robots.txt, an interruption, a refusal (401/403/429, a challenge): the import stops.
      if (error instanceof ImportStop || (error instanceof CaptureError && error.code === "blocked")) throw error;
      if (error instanceof CaptureError && error.code === "http_error" && GONE.has(error.httpStatus ?? 0)) {
        stock.set(variation.id, { available: false });
        continue;
      }
      return null;
    }
  }
  return stock;
}
