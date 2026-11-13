import { and, type Database, eq, inArray, isNull, schema, sql } from "@closyria/db";
import {
  extractWooStorePage,
  type WooListedProduct,
  type WooVariationStock,
  withVariationStock,
} from "@closyria/extract";
import { readImportHints } from "@closyria/shared";
import { CaptureError } from "../capture/capture-error";
import { decodeBody } from "../capture/decode";
import { isHtmlAnswer, type SafeResponse } from "../capture/safe-fetch";
import {
  readsVariationsOneByOne,
  readVariation,
  readVariationsInBulk,
  rememberOneByOne,
  WOO_BULK_PARENTS,
  WOO_COUNT_HEADERS,
  WOO_PAGE_SIZE,
  type WooApi,
  type WooFetch,
  wooCount,
  wooRequest,
} from "../capture/woo-store";
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

/** 100 000 products. */
const MAX_PAGES = 1000;
/** Listing requests for the variations per import (25 products, 100 variations a page): an hourly run stays short. */
export const WOO_VARIATION_REQUESTS = 30;
/** For a shop that refuses the listing of variations: one request per variation, at most this many per import. */
export const WOO_VARIATION_REQUESTS_ONE_BY_ONE = 300;
/** A variable product's per-size stock is read again at least this often, even with an unchanged listing. */
export const WOO_VARIANTS_RECHECK_MS = 24 * 60 * 60 * 1000;
/** A product whose stock could not be read (5xx, unreadable) is not tried again for this long. */
export const WOO_VARIANTS_RETRY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 1000;

/** A 4xx is the shop's answer, not a hiccup: never asked again. */
const retried = (error: CaptureError) =>
  RETRIED.has(error.code) && !(error.httpStatus !== undefined && error.httpStatus < 500);

/** No Store API at that address: unknown to the shop (404), or an answer that is not JSON (and not an HTML page). */
const missing = (error: unknown) =>
  error instanceof CaptureError &&
  (error.code === "invalid_data" || (error.code === "http_error" && error.httpStatus === 404));

/** Requests to the Store API through the import's guard rails; `?rest_route=` is also checked against `/wp-json/`. */
function storeFetch(ctx: ImportContext): WooFetch {
  return async (request, options) => {
    if (request.robotsUrl !== request.url && !(await ctx.deps.robots.allows(request.robotsUrl))) {
      throw new ImportStop("robots_disallowed");
    }
    return ctx.fetch(request.url, "json", options?.keepHeaders ? { keepHeaders: options.keepHeaders } : {});
  };
}

/** Records where the shop's Store API answers (best effort: a failed write costs one more request next time). */
async function rememberRoute(db: Database, shopId: string, plain: boolean): Promise<void> {
  try {
    await db
      .update(schema.shops)
      .set({
        importHints: plain
          ? sql`${schema.shops.importHints} || '{"wooRoute":"plain"}'::jsonb`
          : sql`${schema.shops.importHints} - 'wooRoute'`,
      })
      .where(eq(schema.shops.id, shopId));
  } catch (error) {
    console.error(`catalogue import ${shopId}: cannot remember its Store API address`, error);
  }
}

/**
 * A WooCommerce shop's public catalogue, through its Store API (`/wp-json/wc/store/v1/products?per_page=100&page=n`;
 * on a site with plain permalinks `/?rest_route=/wc/store/v1/products&…`, tried once when the first answers 404 and
 * remembered on the shop), on the shop's own spacing (never the Shopify line). The listing's `X-WP-Total` is the
 * progress bar's scale and `X-WP-TotalPages` its end (else a short page). No Store API at either address (404, not
 * JSON) stops the import with `woocommerce_api_unavailable`: nothing else is crawled. An HTML page where the JSON
 * should be is a refusal (`blocked`). Products the parser rejects are counted and logged.
 *
 * The listing has no per-size stock: after the pages (« lecture des tailles »), the variations of the variable
 * products that are new or whose listing changed, and of every variable product at most once a day
 * (`variants_checked_at`), are listed 25 products at a time (`?type=variation&parent[]=…`), never read first, then
 * the changed ones, then the longest unread, within `WOO_VARIATION_REQUESTS` requests. A shop that refuses that
 * listing (400) has them read one by one within `WOO_VARIATION_REQUESTS_ONE_BY_ONE`, and is remembered so. A product
 * whose stock could not be read waits 24 h (`variants_tried_at`); one too big for the budget is read alone in a run
 * with nothing else to read. Between two reads a product keeps the per-size stock last read (a new one takes the
 * product's own until its first read).
 */
export function createWooSource(): CatalogSource<WooListedProduct> {
  /** The variable products listed, by WooCommerce id; and those this import wrote (new or changed). */
  const variable = new Map<string, WooListedProduct>();
  const changed = new Set<string>();
  let totalPages: number | null = null;
  let api: WooApi | null = null;

  return {
    maxPages: MAX_PAGES,
    countsSkipped: true,
    // Products the Store API lists are known by their numeric id; another id (a SKU read from a pasted page) is not
    // the import's to judge.
    judged: sql`${schema.products.externalId} ~ '^[0-9]+$'`,
    fetchPage: async (ctx, page) => {
      const fetch = storeFetch(ctx);
      const at: WooApi = api ?? {
        origin: ctx.origin,
        plain: readImportHints(ctx.shop.importHints).wooRoute === "plain",
      };
      const params = [`per_page=${WOO_PAGE_SIZE}`, `page=${page}`];
      let response: SafeResponse;
      try {
        response = await withRetry(
          ctx,
          () => fetch(wooRequest(at, "", params), { keepHeaders: WOO_COUNT_HEADERS }),
          retried,
        );
        api = at;
      } catch (error) {
        if (ctx.signal.aborted || !(error instanceof CaptureError)) throw error;
        // A page where the JSON should be: the shop (or its firewall) turns us away.
        if (isHtmlAnswer(error)) throw new CaptureError("blocked", error.httpStatus);
        if (page === 1 && missing(error)) {
          // The same API at its other address, once (plain permalinks, or back to pretty ones).
          const other: WooApi = { origin: ctx.origin, plain: !at.plain };
          try {
            await ctx.spacing();
            response = await fetch(wooRequest(other, "", params), { keepHeaders: WOO_COUNT_HEADERS });
          } catch (retry) {
            if (ctx.signal.aborted || !(retry instanceof CaptureError) || retry.code === "blocked") throw retry;
            throw new ImportStop("woocommerce_api_unavailable");
          }
          api = other;
          await rememberRoute(ctx.deps.db, ctx.shop.id, other.plain);
        } else if (
          // Past the last page of a shop that gives no page count: the listing is over.
          page > 1 &&
          totalPages === null &&
          error.code === "http_error" &&
          [400, 404].includes(error.httpStatus ?? 0)
        ) {
          return { count: 0, listedIds: [], products: [], last: true };
        } else {
          throw error;
        }
      }
      const listing = extractWooStorePage(decodeBody(response.body, response.contentType), ctx.origin);
      if (!listing) throw new ImportStop(page === 1 ? "woocommerce_api_unavailable" : "invalid_data");
      if (page === 1) totalPages = wooCount(response, "x-wp-totalpages");
      const last = totalPages !== null ? page >= totalPages : listing.count < WOO_PAGE_SIZE;
      return { ...listing, last, ...(page === 1 ? { total: wooCount(response, "x-wp-total") } : {}) };
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
    afterListing: async (ctx) => {
      if (api) await readVariations(ctx, api, variable, changed);
    },
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

type Candidate = { id: string; item: WooListedProduct; rows: string[]; checked: number | null; changed: boolean };

/** The variable products whose stock is due: new or changed, or unread for a day; not those that failed within 24 h. */
async function dueCandidates(
  ctx: ImportContext,
  variable: Map<string, WooListedProduct>,
  changed: Set<string>,
): Promise<Candidate[]> {
  const { db } = ctx.deps;
  const ids = [...variable.keys()];
  const rows: { id: string; externalId: string | null; checkedAt: Date | null; triedAt: Date | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(
      ...(await db
        .select({
          id: schema.products.id,
          externalId: schema.products.externalId,
          checkedAt: schema.products.variantsCheckedAt,
          triedAt: schema.products.variantsTriedAt,
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

  const now = ctx.now().getTime();
  const candidates: Candidate[] = [];
  for (const [id, item] of variable) {
    const own = byId.get(id);
    if (!own?.length) continue;
    if (own.some((r) => r.triedAt !== null && r.triedAt.getTime() > now - WOO_VARIANTS_RETRY_MS)) continue;
    const checked = own.some((r) => r.checkedAt === null)
      ? null
      : Math.min(...own.map((r) => r.checkedAt?.getTime() ?? 0));
    const isChanged = changed.has(id);
    if (!isChanged && checked !== null && checked > now - WOO_VARIANTS_RECHECK_MS) continue;
    candidates.push({ id, item, rows: own.map((r) => r.id), checked, changed: isChanged });
  }
  const rank = (c: Candidate) => (c.checked === null ? 0 : c.changed ? 1 : 2);
  return candidates.sort((a, b) => rank(a) - rank(b) || (a.checked ?? 0) - (b.checked ?? 0));
}

/** Listing requests that read the variations of `count` variations. */
const pagesFor = (count: number) => Math.max(1, Math.ceil(count / WOO_PAGE_SIZE));

/**
 * Reads the per-size stock of the variable products that need it (`dueCandidates`), within the run's budget of
 * requests: listed 25 products at a time, else one variation per request for a shop that refuses the listing. A
 * refusal (robots.txt, 401/403/429, an HTML page) stops the import like a page's.
 */
async function readVariations(
  ctx: ImportContext,
  api: WooApi,
  variable: Map<string, WooListedProduct>,
  changed: Set<string>,
): Promise<void> {
  const queue = await dueCandidates(ctx, variable, changed);
  if (queue.length === 0) return;
  await ctx.setPhase("sizes");
  const shopId = ctx.shop.id;
  const pageFetch = storeFetch(ctx);
  // Each request 1 s after the previous one, with a heartbeat.
  const fetch: WooFetch = async (request, options) => {
    await ctx.spacing();
    await ctx.beat();
    return pageFetch(request, options);
  };
  const stopIfInterrupted = () => {
    if (ctx.signal.aborted) throw new ImportStop("interrupted");
  };
  let oneByOne = readsVariationsOneByOne(readImportHints(ctx.shop.importHints), ctx.now());
  let left = oneByOne ? WOO_VARIATION_REQUESTS_ONE_BY_ONE : WOO_VARIATION_REQUESTS;
  /** Products too big for what was left of the budget. */
  const tooBig: Candidate[] = [];
  let read = 0;

  while (!oneByOne && queue.length > 0 && left > 0) {
    const batch: Candidate[] = [];
    let count = 0;
    while (queue.length > 0 && batch.length < WOO_BULK_PARENTS) {
      const next = queue[0] as Candidate;
      const cost = next.item.variations.length;
      if (pagesFor(count + cost) > left) {
        if (batch.length > 0) break;
        tooBig.push(next);
        queue.shift();
        continue;
      }
      batch.push(next);
      queue.shift();
      count += cost;
    }
    if (batch.length === 0) break;
    const result = await readVariationsInBulk(
      fetch,
      api,
      batch.map((c) => c.id),
      left,
    );
    stopIfInterrupted();
    left -= result.requests;
    if (result.kind === "unsupported") {
      // An older WooCommerce: one by one from now on (this run included), within that budget.
      console.info(`catalogue import ${shopId}: the shop refuses to list variations, read one by one`);
      await rememberOneByOne(ctx.deps.db, shopId, ctx.now());
      oneByOne = true;
      left = WOO_VARIATION_REQUESTS_ONE_BY_ONE - result.requests;
      queue.unshift(...batch);
      break;
    }
    if (result.kind === "incomplete") break;
    read += batch.length;
    if (result.kind === "failed") {
      await markTried(ctx, batch);
      continue;
    }
    for (const candidate of batch) await writeStock(ctx, candidate, completeStock(candidate, result.stock));
  }

  const readOneByOne = async (candidate: Candidate) => {
    const stock = new Map<string, WooVariationStock>();
    for (const variation of candidate.item.variations) {
      const one = await readVariation(fetch, api, variation.id);
      stopIfInterrupted();
      left -= 1;
      if (!one) return markTried(ctx, [candidate]);
      stock.set(variation.id, one);
    }
    await writeStock(ctx, candidate, stock);
  };
  while (oneByOne && queue.length > 0 && left > 0) {
    const candidate = queue.shift() as Candidate;
    if (candidate.item.variations.length > left) {
      tooBig.push(candidate);
      continue;
    }
    read += 1;
    await readOneByOne(candidate);
  }

  // A product too big for any run's budget is never skipped for good: read alone in a run with nothing else to read.
  const [big, ...waiting] = tooBig;
  if (big && read === 0) {
    const count = big.item.variations.length;
    console.info(`catalogue import ${shopId}: product ${big.id} has ${count} variations, read alone in this run`);
    if (oneByOne) await readOneByOne(big);
    else {
      const result = await readVariationsInBulk(fetch, api, [big.id], pagesFor(count) + 1);
      stopIfInterrupted();
      if (result.kind === "ok") await writeStock(ctx, big, completeStock(big, result.stock));
      else if (result.kind === "failed") await markTried(ctx, [big]);
    }
  } else if (big) {
    waiting.unshift(big);
  }
  for (const candidate of waiting) {
    console.info(
      `catalogue import ${shopId}: product ${candidate.id} (${candidate.item.variations.length} variations) waits for a run with nothing else to read`,
    );
  }
}

/** Every variation of a product listed in full: one the listing does not hold is no longer on sale. */
function completeStock(candidate: Candidate, stock: Map<string, WooVariationStock>): Map<string, WooVariationStock> {
  return new Map(candidate.item.variations.map((v) => [v.id, stock.get(v.id) ?? { available: false }]));
}

/** Writes the product with the stock read; its read date moves, a failure before is forgotten. */
async function writeStock(ctx: ImportContext, candidate: Candidate, stock: Map<string, WooVariationStock>) {
  const at = ctx.now();
  const product = withVariationStock(candidate.item, stock);
  for (const productId of candidate.rows) {
    await ctx.deps.db.transaction(async (tx) => {
      await writeProduct(tx, {
        productId,
        product,
        url: candidate.item.url,
        listingKind: ctx.shop.listingKind,
        reference: ctx.reference,
        at,
        history: "on_change",
        extra: { variantsCheckedAt: at, variantsTriedAt: null },
      });
    });
  }
}

/** Their stock could not be read (5xx, unreadable): they keep it as it was, and wait 24 h before another try. */
async function markTried(ctx: ImportContext, candidates: Candidate[]): Promise<void> {
  const ids = candidates.flatMap((c) => c.rows);
  if (ids.length === 0) return;
  await ctx.deps.db.update(schema.products).set({ variantsTriedAt: ctx.now() }).where(inArray(schema.products.id, ids));
}
