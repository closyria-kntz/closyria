import { type Database, eq, schema, sql } from "@closyria/db";
import {
  extractWooStoreProduct,
  extractWooVariation,
  extractWooVariations,
  type WooListedProduct,
  type WooVariationStock,
  withVariationStock,
} from "@closyria/extract";
import { canonicalizeUrl, type ExtractedProduct, readImportHints, shopDomain } from "@closyria/shared";
import type { AddressPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";
import { decodeBody } from "./decode";
import type { RobotsCache } from "./robots";
import { isHtmlAnswer, type SafeResponse, safeFetch } from "./safe-fetch";
import type { Throttle } from "./throttle";

/**
 * The WooCommerce Store API (public, no key), shared by the catalogue import and the captures of its products:
 * `/wp-json/wc/store/v1/products` (or `/?rest_route=/wc/store/v1/products` on a site with plain permalinks).
 */
export const WOO_STORE_ROUTE = "/wc/store/v1/products";
/** The Store API's largest page. */
export const WOO_PAGE_SIZE = 100;
/** Products whose variations one listing request asks for (`parent[]=…`). */
export const WOO_BULK_PARENTS = 25;
/** Answers that say a variation is gone: that size is no longer on sale. */
export const WOO_GONE = new Set([404, 410]);
/** The shop's counts on a listing page: its entries, and its pages. */
export const WOO_COUNT_HEADERS = ["x-wp-total", "x-wp-totalpages"] as const;
/** A listing of variations is tried again this long after the shop refused it (an older WooCommerce may be updated). */
export const WOO_SINGLE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Where the shop's Store API answers. */
export type WooApi = { origin: string; plain: boolean };

/** One request to the Store API: its address, and the address robots.txt is asked about (always under `/wp-json/`). */
export type WooRequest = { url: string; robotsUrl: string };

export function wooRequest(api: WooApi, path = "", params: string[] = []): WooRequest {
  const query = params.join("&");
  const pretty = `${api.origin}/wp-json${WOO_STORE_ROUTE}${path}`;
  return {
    url: api.plain
      ? `${api.origin}/?rest_route=${WOO_STORE_ROUTE}${path}${query ? `&${query}` : ""}`
      : `${pretty}${query ? `?${query}` : ""}`,
    // `?rest_route=` is the same API: what robots.txt forbids under `/wp-json/` is not read there either.
    robotsUrl: pretty,
  };
}

/** One request through the caller's guard rails (robots.txt for both addresses, spacing, policy, caps). */
export type WooFetch = (request: WooRequest, options?: { keepHeaders?: readonly string[] }) => Promise<SafeResponse>;

/** One of the shop's counts on a listing page, when it sends it. */
export function wooCount(response: SafeResponse, name: (typeof WOO_COUNT_HEADERS)[number]): number | null {
  const value = response.headers?.[name];
  return value !== undefined && /^\d{1,9}$/.test(value.trim()) ? Number(value) : null;
}

/** An HTML page where JSON was asked is the shop (or its firewall) turning us away: a refusal, never retried. */
function refusal(error: unknown): CaptureError | null {
  if (error instanceof CaptureError && error.code === "blocked") return error;
  if (isHtmlAnswer(error)) return new CaptureError("blocked", (error as CaptureError).httpStatus);
  return null;
}

/**
 * The variations of these products, through the Store API's listing (`?type=variation&parent[]=…&per_page=100`), page
 * after page within `maxRequests`:
 * - `ok`: every page read; a variation of these products the listing does not hold is no longer on sale;
 * - `incomplete`: out of requests before the last page (`stock` holds what was read);
 * - `unsupported`: the shop refuses the listing (400 on its first page: an older WooCommerce);
 * - `failed`: anything else (5xx, timeout, unreadable).
 * A refusal (401/403/429, a challenge, an HTML page) throws, like anything that is not a failed request (robots.txt,
 * an interruption).
 */
export async function readVariationsInBulk(
  fetch: WooFetch,
  api: WooApi,
  parents: string[],
  maxRequests: number,
): Promise<{
  kind: "ok" | "incomplete" | "unsupported" | "failed";
  stock: Map<string, WooVariationStock>;
  requests: number;
}> {
  const stock = new Map<string, WooVariationStock>();
  const wanted = new Set(parents);
  let requests = 0;
  let totalPages: number | null = null;
  for (let page = 1; ; page++) {
    if (requests >= maxRequests) return { kind: "incomplete", stock, requests };
    const params = [
      "type=variation",
      ...parents.map((p) => `parent[]=${p}`),
      `per_page=${WOO_PAGE_SIZE}`,
      `page=${page}`,
    ];
    requests += 1;
    let response: SafeResponse;
    try {
      response = await fetch(wooRequest(api, "", params), { keepHeaders: WOO_COUNT_HEADERS });
    } catch (error) {
      const refused = refusal(error);
      if (refused) throw refused;
      if (!(error instanceof CaptureError)) throw error;
      const unsupported = page === 1 && error.code === "http_error" && error.httpStatus === 400;
      return { kind: unsupported ? "unsupported" : "failed", stock, requests };
    }
    const listing = extractWooVariations(decodeBody(response.body, response.contentType));
    if (!listing) return { kind: "failed", stock, requests };
    for (const variation of listing.variations) {
      if (wanted.has(variation.parent)) {
        stock.set(variation.id, {
          available: variation.available,
          ...(variation.priceCents === undefined ? {} : { priceCents: variation.priceCents }),
        });
      }
    }
    if (page === 1) totalPages = wooCount(response, "x-wp-totalpages");
    const last = totalPages !== null ? page >= totalPages : listing.count < WOO_PAGE_SIZE;
    if (last) return { kind: "ok", stock, requests };
  }
}

/**
 * One variation (`…/products/{id}`), for a shop that refuses the listing: its stock, sold out when gone (404/410),
 * null when it could not be read. A refusal throws.
 */
export async function readVariation(fetch: WooFetch, api: WooApi, id: string): Promise<WooVariationStock | null> {
  let response: SafeResponse;
  try {
    response = await fetch(wooRequest(api, `/${id}`));
  } catch (error) {
    const refused = refusal(error);
    if (refused) throw refused;
    if (!(error instanceof CaptureError)) throw error;
    if (error.code === "http_error" && WOO_GONE.has(error.httpStatus ?? 0)) return { available: false };
    return null;
  }
  const read = extractWooVariation(decodeBody(response.body, response.contentType));
  if (!read || read.id !== id) return null;
  return { available: read.available, ...(read.priceCents === undefined ? {} : { priceCents: read.priceCents }) };
}

/** Variations are read one by one for this shop: it refused the listing less than a week ago. */
export function readsVariationsOneByOne(hints: { wooSingleSince?: string | undefined }, now: Date): boolean {
  return hints.wooSingleSince !== undefined && now.getTime() - Date.parse(hints.wooSingleSince) < WOO_SINGLE_RETRY_MS;
}

/** Records that the shop refuses the listing of variations (best effort: a failed write costs a request next time). */
export async function rememberOneByOne(db: Database, shopId: string, at: Date): Promise<void> {
  try {
    await db
      .update(schema.shops)
      .set({
        importHints: sql`${schema.shops.importHints} || ${JSON.stringify({ wooSingleSince: at.toISOString() })}::jsonb`,
      })
      .where(eq(schema.shops.id, shopId));
  } catch (error) {
    console.error(`woocommerce ${shopId}: cannot remember that variations are read one by one`, error);
  }
}

/** Requests one capture of a WooCommerce product may make: the product, then its variations (one listing request). */
export const WOO_CAPTURE_MAX_REQUESTS = 2;
/** With a shop that refuses the listing: the product and 3 variations; the other sizes keep their last known stock. */
export const WOO_CAPTURE_MAX_REQUESTS_ONE_BY_ONE = 4;

export type WooStoreDeps = {
  db: Database;
  policy: AddressPolicy;
  robots: RobotsCache;
  throttle: Throttle;
  lookup?: Parameters<typeof safeFetch>[1]["lookup"];
  now: () => Date;
};

export type WooStoreRead = {
  product: ExtractedProduct;
  httpStatus: number;
  /** Every variation's stock was read: the product's `variants_checked_at` moves. */
  complete: boolean;
};

/**
 * « Stocks frais » for an imported WooCommerce product (known by its numeric WooCommerce id), for a sheet's refresh or
 * her capture: the product from the Store API (`…/products/{id}`), then its variations in one listing request, on the
 * shop's own spacing, robots.txt checked first. A shop that refuses the listing (400, remembered on the shop) has its
 * variations read one by one, 3 at most; the other sizes keep their last known stock. Null when the Store API cannot
 * say (off, unreadable, robots.txt, or a product at another address than this one): the capture then reads the page
 * as before. A refusal (401/403/429, a challenge) throws, without asking the page.
 */
export async function readWooStore(
  url: string,
  productId: string,
  shop: { id: string; importHints: unknown },
  deps: WooStoreDeps,
): Promise<WooStoreRead | null> {
  const [row] = await deps.db
    .select({ externalId: schema.products.externalId, canonicalUrl: schema.products.canonicalUrl })
    .from(schema.products)
    .where(eq(schema.products.id, productId));
  if (!row?.externalId || !/^\d{1,19}$/.test(row.externalId)) return null;
  const hints = readImportHints(shop.importHints);
  const api: WooApi = { origin: new URL(url).origin, plain: hints.wooRoute === "plain" };
  let requests = 0;
  const fetch: WooFetch = async (request, options) => {
    for (const target of new Set([request.robotsUrl, request.url])) {
      if (!(await deps.robots.allows(target))) throw new CaptureError("robots_disallowed");
    }
    await deps.throttle.wait(shopDomain(request.url));
    requests += 1;
    return safeFetch(request.url, {
      accept: "json",
      policy: deps.policy,
      ...(deps.lookup ? { lookup: deps.lookup } : {}),
      ...(options?.keepHeaders ? { keepHeaders: options.keepHeaders } : {}),
    });
  };

  let item: WooListedProduct | null;
  let httpStatus: number;
  try {
    const response = await fetch(wooRequest(api, `/${row.externalId}`));
    item = extractWooStoreProduct(decodeBody(response.body, response.contentType), api.origin);
    httpStatus = response.status;
  } catch (error) {
    if (error instanceof CaptureError && error.code === "blocked") throw error;
    return null;
  }
  // Another product under that id (the shop renumbered, or an id that is not WooCommerce's): the page decides.
  if (!item || canonicalizeUrl(item.url) !== row.canonicalUrl) return null;

  let stock = new Map<string, WooVariationStock>();
  let complete = false;
  if (item.variations.length > 0) {
    let oneByOne = readsVariationsOneByOne(hints, deps.now());
    if (!oneByOne) {
      const bulk = await readVariationsInBulk(fetch, api, [String(row.externalId)], 1);
      stock = bulk.stock;
      if (bulk.kind === "ok") {
        // A variation the listing does not hold is no longer on sale.
        for (const variation of item.variations)
          if (!stock.has(variation.id)) stock.set(variation.id, { available: false });
        complete = true;
      } else if (bulk.kind === "unsupported") {
        oneByOne = true;
        await rememberOneByOne(deps.db, shop.id, deps.now());
      }
    }
    if (oneByOne) {
      for (const variation of item.variations) {
        if (requests >= WOO_CAPTURE_MAX_REQUESTS_ONE_BY_ONE) break;
        const read = await readVariation(fetch, api, variation.id);
        if (!read) break;
        stock.set(variation.id, read);
      }
      complete = item.variations.every((v) => stock.has(v.id));
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
