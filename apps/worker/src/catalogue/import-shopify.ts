import { recordShopifyRejection } from "@closyria/db";
import { extractShopifyCatalogPage, extractSitemap, type ShopifyCatalogPage } from "@closyria/extract";
import { shopDomain } from "@closyria/shared";
import { isShopifyRejection } from "../capture/capture-error";
import { decodeBody } from "../capture/decode";
import {
  type CatalogSource,
  hashOf,
  type ImportContext,
  type ImportDeps,
  type ImportOptions,
  type ImportResult,
  ImportStop,
  runImport,
  withRetry,
} from "./import-core";

export {
  abortRunningImports,
  IMPORT_PAUSE_MS,
  type ImportDeps,
  type ImportOptions,
  type ImportResult,
  settleRunningImports,
} from "./import-core";

export const IMPORT_PAGE_SIZE = 250;
/** 100 000 products: past that, something is wrong with the shop's paging. */
const MAX_PAGES = 400;
/** Cap on one sitemap: Shopify's hold 5 000 products each, far below; the parse is synchronous, so it stays small. */
const SITEMAP_MAX_BYTES = 8 * 1024 * 1024;
/** Products sitemaps read for the estimate: Shopify lists up to 5 000 products in each. */
const MAX_PRODUCT_SITEMAPS = 50;
/** `sitemap_products_1.xml`, possibly under a market prefix (`/en/…`), with Shopify's `?from=…&to=…`. */
const PRODUCT_SITEMAP = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?sitemap_products_\d+\.xml$/i;
/** A product page, under a market prefix or not: its handle (`/en/products/robe` and `/products/robe` are one). */
const PRODUCT_PAGE = /\/products\/([^/]+)\/?$/;

type Listed = ShopifyCatalogPage["products"][number];

/**
 * A Shopify shop's public catalogue (`/products.json?limit=250&page=n`). Every request also takes a low-priority slot
 * on the one Shopify line (a request every 2 s across every Shopify shop). A 429/430 stops the import and slows every
 * Shopify import. Shopify's `updated_at` is not trusted for the skip: a stock change may not move it.
 */
export const shopifySource: CatalogSource<Listed> = {
  line: { shopify: "low" },
  maxPages: MAX_PAGES,
  estimate: estimateProducts,
  fetchPage: async (ctx, page) => {
    const url = `${ctx.origin}/products.json?limit=${IMPORT_PAGE_SIZE}&page=${page}`;
    const listing = await withRetry(ctx, async () => {
      const response = await ctx.fetch(url, "json");
      const parsed = extractShopifyCatalogPage(decodeBody(response.body, response.contentType), ctx.origin);
      if (!parsed) throw new ImportStop("invalid_data");
      return parsed;
    });
    return { ...listing, last: listing.count < IMPORT_PAGE_SIZE };
  },
  hash: contentHash,
  stopped: async (ctx, error) => {
    // Shopify asks us to slow down (429/430): this import stops (« blocked ») and every Shopify import slows down.
    if (isShopifyRejection(error)) await noteShopifyRejection(ctx);
  },
};

/** Imports a Shopify shop's catalogue (`not_shopify` for a shop on another platform). */
export function importShopifyCatalog(
  deps: ImportDeps,
  shopId: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  return runImport(
    deps,
    shopId,
    { source: (platform) => (platform === "shopify" ? shopifySource : null), unsupported: "not_shopify" },
    options,
  );
}

/** Records « Shopify ralenti » (never fails the caller: the import already stopped). */
async function noteShopifyRejection(ctx: ImportContext): Promise<void> {
  const shopId = ctx.shop.id;
  try {
    const state = await recordShopifyRejection(ctx.deps.db, ctx.now());
    console.warn(
      `catalogue import ${shopId}: Shopify asks to slow down, imports ${state.level} until ${state.until.toISOString()}`,
    );
  } catch (error) {
    console.error(`catalogue import ${shopId}: cannot record the Shopify slow-down`, error);
  }
}

/**
 * How many products the shop's public sitemap lists: `/sitemap.xml` (an index), then each of its products sitemaps
 * on the same site (at most 50), counting distinct product handles (`/products/<handle>`, whatever the market prefix;
 * Shopify also lists the home page). Every request goes like a page's (`spacing`: 1 s apart; same guard rails, 8 MB
 * per sitemap). An estimate only: any failure (missing, forbidden by robots.txt, blocked, too big, unreadable, no
 * product) gives null and is not an import error. Only an interruption of the import and a Shopify « slow down »
 * (429/430, which stops the import) go through.
 */
async function estimateProducts(ctx: ImportContext): Promise<number | null> {
  const { deps, origin, signal } = ctx;
  const read = async (url: string) => {
    // robots.txt first: a forbidden sitemap is not requested, and costs no pause.
    if (!(await deps.robots.allows(url))) return null;
    await ctx.spacing();
    await ctx.beat();
    const response = await ctx.fetch(url, "xml", { maxBytes: SITEMAP_MAX_BYTES });
    return extractSitemap(decodeBody(response.body, response.contentType));
  };
  try {
    const index = await read(`${origin}/sitemap.xml`);
    if (index?.kind !== "index") return null;
    const site = shopDomain(origin);
    const sitemaps = index.locs
      .filter((loc) => {
        const url = new URL(loc);
        return shopDomain(loc) === site && PRODUCT_SITEMAP.test(url.pathname);
      })
      .slice(0, MAX_PRODUCT_SITEMAPS);
    if (sitemaps.length === 0) return null;
    // Each product once, though every market sitemap (`/en/…`) lists it again.
    const handles = new Set<string>();
    for (const loc of sitemaps) {
      const sitemap = await read(loc);
      if (sitemap?.kind !== "urlset") return null;
      for (const page of sitemap.locs) {
        const handle = PRODUCT_PAGE.exec(new URL(page).pathname)?.[1];
        if (handle) handles.add(handle.toLowerCase());
      }
    }
    return handles.size > 0 ? handles.size : null;
  } catch (error) {
    if (signal.aborted || (error instanceof ImportStop && error.reason === "interrupted")) {
      throw new ImportStop("interrupted");
    }
    if (isShopifyRejection(error)) throw error;
    return null;
  }
}

/**
 * A stable hash of everything the import writes from a listed product (the parsed product: name, brand, description,
 * prices, currency, sizes with their stock, photos in order, tags, type, colours, ids, put-online date; and its
 * address), plus the shop's listing kind (second-hand shops keep no sizes).
 */
export function contentHash(item: Listed, listingKind: string): string {
  return hashOf({ url: item.url, product: item.product }, listingKind);
}
