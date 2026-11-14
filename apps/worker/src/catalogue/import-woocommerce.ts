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
import { isChallengeAnswer, isHtmlAnswer, type SafeResponse } from "../capture/safe-fetch";
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

/**
 * The first listing page at the Store API's other address (one request, robots.txt checked for both), after the
 * first answered 404, something else than JSON, or an HTML page. Its listing, else: a refusal (401/403/429) stays one;
 * an HTML bot challenge at either address is a refusal (`blocked`); anything else means no Store API
 * (`woocommerce_api_unavailable`).
 */
async function probeOtherRoute(
  ctx: ImportContext,
  fetch: WooFetch,
  first: WooApi,
  params: string[],
  firstError: CaptureError,
): Promise<SafeResponse> {
  const challenged = (error: CaptureError) => new CaptureError("blocked", error.httpStatus);
  const other: WooApi = { origin: ctx.origin, plain: !first.plain };
  let response: SafeResponse;
  try {
    await ctx.spacing();
    response = await fetch(wooRequest(other, "", params), { keepHeaders: WOO_COUNT_HEADERS });
  } catch (error) {
    if (ctx.signal.aborted || !(error instanceof CaptureError) || error.code === "blocked") throw error;
    if (isChallengeAnswer(error)) throw challenged(error);
    if (isChallengeAnswer(firstError)) throw challenged(firstError);
    throw new ImportStop("woocommerce_api_unavailable");
  }
  if (!extractWooStorePage(decodeBody(response.body, response.contentType), ctx.origin)) {
    if (isChallengeAnswer(firstError)) throw challenged(firstError);
    throw new ImportStop("woocommerce_api_unavailable");
  }
  return response;
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
        if (page === 1 && (isHtmlAnswer(error) || missing(error))) {
          // The same API at its other address, once (plain permalinks, or back to pretty ones). A site with plain
          // permalinks may serve its home page (HTML) for `/wp-json/…`: an HTML page here is not a refusal yet.
          response = await probeOtherRoute(ctx, fetch, at, params, error);
          api = { origin: ctx.origin, plain: !at.plain };
          await rememberRoute(ctx.deps.db, ctx.shop.id, api.plain);
        } else if (isHtmlAnswer(error)) {
          // A page where the JSON should be, on a route that answered before: the shop (or its firewall) turns us away.
          throw new CaptureError("blocked", error.httpStatus);
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

type Candidate = {
  id: string;
  item: WooListedProduct;
  rows: string[];
  checked: number | null;
  changed: boolean;
  /** Since when it waits for a full read: its last one, else since Closyria knows it. */
  waitingSince: number;
  /** Variations already read by a pass spread over several imports. */
  cursor: number;
};

/** The variable products whose stock is due: new or changed, or unread for a day; not those that failed within 24 h. */
async function dueCandidates(
  ctx: ImportContext,
  variable: Map<string, WooListedProduct>,
  changed: Set<string>,
): Promise<Candidate[]> {
  const { db } = ctx.deps;
  const ids = [...variable.keys()];
  const rows: {
    id: string;
    externalId: string | null;
    checkedAt: Date | null;
    triedAt: Date | null;
    createdAt: Date;
    cursor: number;
  }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    rows.push(
      ...(await db
        .select({
          id: schema.products.id,
          externalId: schema.products.externalId,
          checkedAt: schema.products.variantsCheckedAt,
          triedAt: schema.products.variantsTriedAt,
          createdAt: schema.products.createdAt,
          cursor: schema.products.variantsCursor,
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
    candidates.push({
      id,
      item,
      rows: own.map((r) => r.id),
      checked,
      changed: isChanged,
      waitingSince: checked ?? Math.min(...own.map((r) => r.createdAt.getTime())),
      cursor: own[0]?.cursor ?? 0,
    });
  }
  const rank = (c: Candidate) => (c.checked === null ? 0 : c.changed ? 1 : 2);
  return candidates.sort((a, b) => rank(a) - rank(b) || (a.checked ?? 0) - (b.checked ?? 0));
}

/** Listing requests that read the variations of `count` variations. */
const pagesFor = (count: number) => Math.max(1, Math.ceil(count / WOO_PAGE_SIZE));

/**
 * Reads the per-size stock of the variable products that need it (`dueCandidates`), never more requests per import
 * than the budget (`WOO_VARIATION_REQUESTS` listing requests; `WOO_VARIATION_REQUESTS_ONE_BY_ONE` for a shop that
 * refuses the listing, the listing requests already made counted in):
 * - listed 25 products at a time; a shop that refuses the listing (400, even after earlier batches) has the rest read
 *   one by one, and is remembered so;
 * - a product with more variations than the budget is read over several imports (`variants_cursor`): once it has
 *   waited 24 h (since its last full read, else since it is known) the import starts with it; otherwise only when
 *   there is nothing else to read;
 * - the first failure (5xx, timeout, unreadable) ends the reads of this import, its products waiting 24 h;
 * - a refusal (robots.txt, 401/403/429, an HTML page) stops the import like a page's.
 */
async function readVariations(
  ctx: ImportContext,
  api: WooApi,
  variable: Map<string, WooListedProduct>,
  changed: Set<string>,
): Promise<void> {
  const due = await dueCandidates(ctx, variable, changed);
  if (due.length === 0) return;
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
  let spent = 0;
  const left = () => (oneByOne ? WOO_VARIATION_REQUESTS_ONE_BY_ONE : WOO_VARIATION_REQUESTS) - spent;
  let failed = false;
  let read = 0;
  const switchToOneByOne = async () => {
    console.info(`catalogue import ${shopId}: the shop refuses to list variations, read one by one`);
    await rememberOneByOne(ctx.deps.db, shopId, ctx.now());
    oneByOne = true;
  };
  const fail = async (candidates: Candidate[]) => {
    failed = true;
    await markTried(ctx, candidates);
  };

  /** A product more than the budget can read: part of it in this import, the rest in the next ones. */
  const oversized = (c: Candidate) =>
    oneByOne
      ? c.item.variations.length > WOO_VARIATION_REQUESTS_ONE_BY_ONE
      : pagesFor(c.item.variations.length) > WOO_VARIATION_REQUESTS;
  const readInParts = async (candidate: Candidate) => {
    const count = candidate.item.variations.length;
    read += 1;
    if (oneByOne) {
      const start = candidate.cursor < count ? candidate.cursor : 0;
      const stock = new Map<string, WooVariationStock>();
      const part = candidate.item.variations.slice(start, start + left());
      for (const variation of part) {
        const one = await readVariation(fetch, api, variation.id);
        stopIfInterrupted();
        spent += 1;
        if (!one) return fail([candidate]);
        stock.set(variation.id, one);
      }
      const end = start + part.length;
      return writeStock(ctx, candidate, stock, end >= count ? null : end);
    }
    const firstPage = Math.floor((candidate.cursor < count ? candidate.cursor : 0) / WOO_PAGE_SIZE) + 1;
    const result = await readVariationsInBulk(fetch, api, [candidate.id], left(), firstPage);
    stopIfInterrupted();
    spent += result.requests;
    if (result.kind === "unsupported") return switchToOneByOne();
    if (result.kind === "failed") return fail([candidate]);
    if (result.kind === "incomplete") {
      return writeStock(ctx, candidate, result.stock, (result.nextPage - 1) * WOO_PAGE_SIZE);
    }
    // The pass is over: from its first page, a variation not listed is no longer on sale.
    const stock = firstPage === 1 ? completeStock(candidate, result.stock, result.rejected) : result.stock;
    await writeStock(ctx, candidate, stock, null);
  };

  const big = due.filter(oversized);
  const queue = due.filter((c) => !oversized(c));
  // Its guaranteed share: a big product waiting for a day takes this import first.
  const now = ctx.now().getTime();
  const starving = big.find((c) => c.waitingSince <= now - WOO_VARIANTS_RECHECK_MS);
  if (starving) {
    console.info(
      `catalogue import ${shopId}: product ${starving.id} (${starving.item.variations.length} variations) read first`,
    );
    big.splice(big.indexOf(starving), 1);
    await readInParts(starving);
  }

  while (!oneByOne && !failed && queue.length > 0 && left() > 0) {
    const batch: Candidate[] = [];
    let count = 0;
    for (let i = 0; i < queue.length && batch.length < WOO_BULK_PARENTS; ) {
      const next = queue[i] as Candidate;
      const cost = next.item.variations.length;
      if (pagesFor(count + cost) > left()) {
        // Waits for the next import, when the budget is whole again; a smaller one may still fit.
        if (batch.length === 0) {
          i += 1;
          continue;
        }
        break;
      }
      batch.push(next);
      queue.splice(i, 1);
      count += cost;
    }
    if (batch.length === 0) break;
    const result = await readVariationsInBulk(
      fetch,
      api,
      batch.map((c) => c.id),
      left(),
    );
    stopIfInterrupted();
    spent += result.requests;
    if (result.kind === "unsupported") {
      // The rest of this import one by one, the listing requests already made counted in.
      await switchToOneByOne();
      queue.unshift(...batch);
      break;
    }
    if (result.kind === "incomplete") break;
    read += batch.length;
    if (result.kind === "failed") {
      await fail(batch);
      break;
    }
    for (const candidate of batch) {
      await writeStock(ctx, candidate, completeStock(candidate, result.stock, result.rejected), null);
    }
  }

  while (oneByOne && !failed && queue.length > 0 && left() > 0) {
    const candidate = queue.shift() as Candidate;
    // Too many for what is left: it waits for the next import (the big ones are read in parts).
    if (candidate.item.variations.length > left()) {
      if (oversized(candidate)) big.push(candidate);
      continue;
    }
    read += 1;
    const stock = new Map<string, WooVariationStock>();
    let complete = true;
    for (const variation of candidate.item.variations) {
      const one = await readVariation(fetch, api, variation.id);
      stopIfInterrupted();
      spent += 1;
      if (!one) {
        complete = false;
        break;
      }
      stock.set(variation.id, one);
    }
    if (complete) await writeStock(ctx, candidate, stock, null);
    else await fail([candidate]);
  }

  // Nothing else to read: a big product takes what is left.
  const [first, ...waiting] = big;
  if (first && read === 0 && !failed && left() > 0) {
    console.info(
      `catalogue import ${shopId}: product ${first.id} (${first.item.variations.length} variations) read in parts`,
    );
    await readInParts(first);
  } else if (first) {
    waiting.unshift(first);
  }
  for (const candidate of waiting) {
    console.info(
      `catalogue import ${shopId}: product ${candidate.id} (${candidate.item.variations.length} variations) waits for its share`,
    );
  }
}

/**
 * Every variation of a product listed in full: one the listing does not hold is no longer on sale; one it holds but
 * could not read (`rejected`) keeps its last known stock.
 */
function completeStock(
  candidate: Candidate,
  stock: Map<string, WooVariationStock>,
  rejected: Set<string>,
): Map<string, WooVariationStock> {
  const out = new Map<string, WooVariationStock>();
  for (const v of candidate.item.variations) {
    const read = stock.get(v.id);
    if (read) out.set(v.id, read);
    else if (!rejected.has(v.id)) out.set(v.id, { available: false });
  }
  return out;
}

/**
 * Writes the product with the stock read; a size none of whose variations was read keeps its last known stock. With
 * `cursor` null the read is whole (its date moves, a failure before is forgotten); otherwise a pass goes on from it.
 */
async function writeStock(
  ctx: ImportContext,
  candidate: Candidate,
  stock: Map<string, WooVariationStock>,
  cursor: number | null,
) {
  const at = ctx.now();
  const known = new Map<string, boolean>();
  for (const row of await ctx.deps.db
    .select({ label: schema.productSizes.label, available: schema.productSizes.available })
    .from(schema.productSizes)
    .where(inArray(schema.productSizes.productId, candidate.rows))) {
    known.set(row.label, (known.get(row.label) ?? false) || row.available);
  }
  const product = withVariationStock(candidate.item, stock, known);
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
        extra:
          cursor === null
            ? { variantsCheckedAt: at, variantsTriedAt: null, variantsCursor: 0 }
            : { variantsTriedAt: null, variantsCursor: cursor },
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
