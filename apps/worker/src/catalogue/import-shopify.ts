import { createHash } from "node:crypto";
import type dns from "node:dns";
import {
  and,
  asc,
  count,
  type Database,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  recordShopifyRejection,
  schema,
} from "@closyria/db";
import { extractShopifyCatalogPage, extractSitemap, type ShopifyCatalogPage } from "@closyria/extract";
import { CATALOGUE_IMPORT_HEARTBEAT_MS, canonicalizeUrl, shopDomain } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { type AddressPolicy, strictPolicy } from "../capture/address-policy";
import { CaptureError, isShopifyRejection } from "../capture/capture-error";
import { copyImages } from "../capture/copy-images";
import { decodeBody } from "../capture/decode";
import type { RobotsCache } from "../capture/robots";
import { type SafeFetchAccept, safeFetch } from "../capture/safe-fetch";
import { loadReferenceSet } from "../capture/seed-reference";
import type { Throttle } from "../capture/throttle";
import { type Reference, writeProduct } from "../capture/write-product";

export type ImportDeps = {
  db: Database;
  store: ObjectStore;
  /** Strict by default; tests inject a policy that reaches the fake shop. */
  policy?: AddressPolicy;
  lookup?: typeof dns.lookup;
  robots: RobotsCache;
  /** Shared with the captures: the shop's pages are spaced whoever asks for them. */
  throttle: Throttle;
  now?: () => Date;
  /** The pause between two pages (injected in tests). */
  sleep?: (ms: number) => Promise<void>;
};

export type ImportOptions = {
  /**
   * Aborted when the worker stops (pg-boss's job signal, or `abortRunningImports`): the import stops before its next
   * request or product, records `interrupted` and removes nothing.
   */
  signal?: AbortSignal;
};

/** `unchanged`: listed products not written again (same content, checked within 7 days). */
export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  error: string | null;
};

export const IMPORT_PAGE_SIZE = 250;
export const IMPORT_PAUSE_MS = 1000;
/** 100 000 products: past that, something is wrong with the shop's paging. */
const MAX_PAGES = 400;
const PAGE_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;
/** Codes worth one more try after a pause; a refusal (robots, 401/403/429, challenge) stops at once. */
const RETRIED = new Set(["http_error", "timeout"]);
const REMOVE_CHUNK = 1000;
/** Below this share of the products on sale at the last import, the listing is not trusted to remove anything. */
const SHRINK_RATIO = 0.5;
/** A product with the same content is still written in full once this old (new classification rules reach it). */
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap on one sitemap: Shopify's hold 5 000 products each, far below; the parse is synchronous, so it stays small. */
const SITEMAP_MAX_BYTES = 8 * 1024 * 1024;
/** Products sitemaps read for the estimate: Shopify lists up to 5 000 products in each. */
const MAX_PRODUCT_SITEMAPS = 50;
/** `sitemap_products_1.xml`, possibly under a market prefix (`/en/…`), with Shopify's `?from=…&to=…`. */
const PRODUCT_SITEMAP = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?sitemap_products_\d+\.xml$/i;
/** A product page, under a market prefix or not: its handle (`/en/products/robe` and `/products/robe` are one). */
const PRODUCT_PAGE = /\/products\/([^/]+)\/?$/;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shops being imported by this process: a shop never has two imports at once (the queue also forbids it). The lock
 * lives as long as the import itself, not the pg-boss job: if a very long import outlives the job's expiry (6 h), a
 * new job for the same shop in this process finds the lock and stops with `already_running`. One worker process only.
 * Each holds what stops it (`abortRunningImports`) and its end (`settleRunningImports`).
 */
const running = new Map<string, { stop: AbortController; done: Promise<unknown> }>();

/** The worker is stopping: every import of this process stops before its next request or product. */
export function abortRunningImports(): void {
  for (const entry of running.values()) entry.stop.abort();
}

/** Waits until the imports of this process are over (their state cleared), at most `timeoutMs`; false on timeout. */
export async function settleRunningImports(timeoutMs: number): Promise<boolean> {
  const all = Promise.allSettled([...running.values()].map((entry) => entry.done)).then(() => true);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([all, late]);
  } finally {
    clearTimeout(timer);
  }
}

class ImportStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Imports the public catalogue of a Shopify shop (`/products.json?limit=250&page=n`), one page at a time with a 1 s
 * pause, through the same guard rails as a capture (robots.txt, address policy, size and time caps, and the one
 * Shopify line: a request every 2 s across every Shopify shop). A 429/430 stops it and slows every Shopify import.
 * Products are written exactly like a captured link (sizes, history, photos, classification). Once every page is
 * read, products of the shop that are no longer listed get `removed_at` (cleared when they come back); the wishes
 * (`items`) are never touched. At the first refusal the import stops, records `last_import_error` and removes nothing.
 * A product whose listing has the same content as at its last write (`source_hash`), that is not removed and was
 * checked less than 7 days ago is not written again: its check date moves (one update per page) and it counts as read
 * and listed. Shopify's `updated_at` is not trusted for this: a stock change may not move it.
 */
export async function importShopifyCatalog(
  deps: ImportDeps,
  shopId: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, removed: 0, error: null };
  if (running.has(shopId)) return { ...result, error: "already_running" };
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const done = (async () => {
    try {
      return await run(deps, shopId, result, signal);
    } finally {
      // Over, whatever the outcome: no « Import en cours » left behind. A killed process leaves it: its heartbeat
      // then stops (shown as dead after 10 min), and the next worker start clears it and queues the import again.
      await deps.db
        .update(schema.shops)
        .set({ importState: null })
        .where(eq(schema.shops.id, shopId))
        .catch((error) => console.error(`catalogue import ${shopId}: cannot clear its state`, error));
    }
  })();
  running.set(shopId, { stop, done });
  try {
    return await done;
  } finally {
    running.delete(shopId);
  }
}

async function run(deps: ImportDeps, shopId: string, result: ImportResult, signal: AbortSignal): Promise<ImportResult> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const interrupted = () => {
    if (signal.aborted) throw new ImportStop("interrupted");
  };
  // One request at a time to the shop, 1 s apart (the first one goes at once).
  let requested = false;
  const spacing = async () => {
    if (requested) await sleep(IMPORT_PAUSE_MS);
    requested = true;
    interrupted();
  };

  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId));
  if (!shop) return { ...result, error: "shop_not_found" };
  // A merged shop lives on in the one it was merged into; a refused one stays out of the catalogue. Nothing is written.
  const stop = shop.mergedIntoId ? "merged" : shop.status === "refused" ? "refused" : null;
  if (stop) {
    console.info(`catalogue import ${shopId} skipped: ${stop}`);
    return { ...result, error: stop };
  }
  if (shop.platform !== "shopify") return { ...result, error: "not_shopify" };
  const origin = await shopOrigin(db, shop);
  if (!origin) {
    await db
      .update(schema.shops)
      .set({ lastImportError: "no_address", updatedAt: now() })
      .where(eq(schema.shops.id, shopId));
    return { ...result, error: "no_address" };
  }

  // « Import en cours » from now on; a state left by a dead job (« En attente », a crashed run) is replaced.
  const startedAt = now();
  await db
    .update(schema.shops)
    .set({
      importState: "running",
      importStartedAt: startedAt,
      importHeartbeatAt: startedAt,
      importPages: 0,
      importSeen: 0,
      importExpected: null,
    })
    .where(eq(schema.shops.id, shopId));
  // Proof of life for the admin, within a page too: at most every 30 s.
  let lastBeat = startedAt.getTime();
  const beat = async () => {
    const at = now();
    if (at.getTime() - lastBeat < CATALOGUE_IMPORT_HEARTBEAT_MS) return;
    lastBeat = at.getTime();
    await db.update(schema.shops).set({ importHeartbeatAt: at }).where(eq(schema.shops.id, shopId));
  };
  const reference = await loadReferenceSet(db);
  const activeBefore = await activeImported(db, shopId);
  const seen = new Set<string>();
  const listedIds = new Set<string>();
  let read = 0;
  try {
    // The bar's scale before the first complete import (after it, its count is the scale): the products the shop's
    // sitemap lists. Any failure: no estimate.
    const expected = shop.lastImportSeen === null ? await estimateProducts(deps, origin, spacing, beat, signal) : null;
    if (expected !== null) {
      await db.update(schema.shops).set({ importExpected: expected }).where(eq(schema.shops.id, shopId));
    }
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new ImportStop("too_many_pages");
      await spacing();
      await beat();
      const listing = await fetchPage(deps, origin, page, sleep, signal);
      for (const id of listing.listedIds) listedIds.add(id);
      const hashes = new Map(listing.products.map((item) => [item, contentHash(item, shop.listingKind)]));
      const unchanged = await unchangedOf(db, shopId, hashes, new Date(now().getTime() - RECHECK_MS));
      const checked: string[] = [];
      for (const item of listing.products) {
        interrupted();
        await beat();
        const ids = unchanged.get(item);
        if (ids) {
          for (const id of ids) seen.add(id);
          checked.push(...ids);
          result.unchanged += 1;
          continue;
        }
        await writeImported(deps, shop, item, hashes.get(item) ?? null, reference, seen, result, now());
      }
      // Checked today, unchanged: the sheet's « Mis à jour le » and the capture's freshness stay current.
      if (checked.length > 0) {
        await db.update(schema.products).set({ lastCapturedAt: now() }).where(inArray(schema.products.id, checked));
      }
      // « Import en cours : page n, x articles lus » in the admin, after each page.
      read += listing.count;
      lastBeat = now().getTime();
      await db
        .update(schema.shops)
        .set({ importPages: page, importSeen: read, importHeartbeatAt: new Date(lastBeat) })
        .where(eq(schema.shops.id, shopId));
      if (listing.count < IMPORT_PAGE_SIZE) break;
    }
  } catch (error) {
    // A request cut short by the worker stopping is an interruption, not the shop's failure.
    const reason = signal.aborted
      ? "interrupted"
      : error instanceof ImportStop
        ? error.reason
        : error instanceof CaptureError
          ? error.message
          : "unexpected_error";
    if (!(signal.aborted || error instanceof ImportStop || error instanceof CaptureError)) {
      console.error(`catalogue import ${shopId} failed`, error);
    }
    result.error = reason;
    await db.update(schema.shops).set({ lastImportError: reason, updatedAt: now() }).where(eq(schema.shops.id, shopId));
    // Shopify asks us to slow down (429/430): this import stops (« blocked ») and every Shopify import slows down.
    if (!signal.aborted && isShopifyRejection(error)) await noteShopifyRejection(db, shopId, now());
    return result;
  }

  // An empty or much shorter listing is more likely a broken shop than a closing-down sale: remove nothing.
  if (listedIds.size === 0 || listedIds.size < activeBefore * SHRINK_RATIO) {
    result.error = "suspicious_shrink";
    await db
      .update(schema.shops)
      .set({ lastImportError: result.error, updatedAt: now() })
      .where(eq(schema.shops.id, shopId));
    return result;
  }
  result.removed = await markRemoved(db, shopId, seen, listedIds, now());
  const at = now();
  await db
    .update(schema.shops)
    .set({
      lastImportAt: at,
      lastImportError: null,
      lastImportSeen: read,
      lastImportCreated: result.created,
      lastImportRemoved: result.removed,
      updatedAt: at,
    })
    .where(eq(schema.shops.id, shopId));
  return result;
}

/** Records « Shopify ralenti » (never fails the caller: the import already stopped). */
async function noteShopifyRejection(db: Database, shopId: string, at: Date): Promise<void> {
  try {
    const state = await recordShopifyRejection(db, at);
    console.warn(
      `catalogue import ${shopId}: Shopify asks to slow down, imports ${state.level} until ${state.until.toISOString()}`,
    );
  } catch (error) {
    console.error(`catalogue import ${shopId}: cannot record the Shopify slow-down`, error);
  }
}

/** The origin of the shop's reference page, else of its first domain. */
async function shopOrigin(db: Database, shop: typeof schema.shops.$inferSelect): Promise<string | null> {
  if (shop.testUrl) {
    try {
      return new URL(shop.testUrl).origin;
    } catch {
      // Fall back to the domains.
    }
  }
  const [domain] = await db
    .select({ domain: schema.shopDomains.domain })
    .from(schema.shopDomains)
    .where(eq(schema.shopDomains.shopId, shop.id))
    .orderBy(asc(schema.shopDomains.domain))
    .limit(1);
  return domain ? `https://${domain.domain}` : null;
}

/**
 * One request to the shop through the capture's guard rails: robots.txt (a refusal throws `robots_disallowed`), its
 * domain's throttle and the Shopify line, the address policy, the size and time caps; cut short when `signal` is
 * aborted.
 */
async function fetchShop(
  deps: ImportDeps,
  url: string,
  accept: SafeFetchAccept,
  signal: AbortSignal,
  maxBytes = PAGE_MAX_BYTES,
) {
  // robots.txt first (cached per origin): its own request never shares the slot of the page.
  if (!(await deps.robots.allows(url))) throw new ImportStop("robots_disallowed");
  // A Shopify shop: also one request every 2 s across every Shopify shop, after the links and sheets' refreshes.
  await deps.throttle.wait(shopDomain(url), { shopify: "low" });
  return safeFetch(url, {
    accept,
    policy: deps.policy ?? strictPolicy,
    maxBytes,
    timeoutMs: PAGE_TIMEOUT_MS,
    signal,
    ...(deps.lookup ? { lookup: deps.lookup } : {}),
  });
}

async function fetchPage(
  deps: ImportDeps,
  origin: string,
  page: number,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal,
): Promise<ShopifyCatalogPage> {
  const url = `${origin}/products.json?limit=${IMPORT_PAGE_SIZE}&page=${page}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchShop(deps, url, "json", signal);
      const listing = extractShopifyCatalogPage(decodeBody(response.body, response.contentType), origin);
      if (!listing) throw new ImportStop("invalid_data");
      return listing;
    } catch (error) {
      if (attempt === 1 && !signal.aborted && error instanceof CaptureError && RETRIED.has(error.code)) {
        await sleep(IMPORT_PAUSE_MS);
        continue;
      }
      throw error;
    }
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
async function estimateProducts(
  deps: ImportDeps,
  origin: string,
  spacing: () => Promise<void>,
  beat: () => Promise<void>,
  signal: AbortSignal,
): Promise<number | null> {
  const read = async (url: string) => {
    // robots.txt first: a forbidden sitemap is not requested, and costs no pause.
    if (!(await deps.robots.allows(url))) return null;
    await spacing();
    await beat();
    const response = await fetchShop(deps, url, "xml", signal, SITEMAP_MAX_BYTES);
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

type Listed = ShopifyCatalogPage["products"][number];

/**
 * A stable hash of everything the import writes from a listed product (the parsed product: name, brand, description,
 * prices, currency, sizes with their stock, photos in order, tags, type, colours, ids, put-online date; and its
 * address), plus the shop's listing kind (second-hand shops keep no sizes).
 */
export function contentHash(item: Listed, listingKind: string): string {
  return createHash("sha256")
    .update(stableJson({ url: item.url, product: item.product, listingKind }))
    .digest("hex");
}

/** JSON with object keys sorted (arrays keep their order), so the same content always gives the same text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The products of a page that need no write, with the ids of their rows: every row of the shop under that Shopify id
 * holds the same `source_hash`, is not removed and was checked since `checkedSince`. One query per page.
 */
async function unchangedOf(
  db: Database,
  shopId: string,
  hashes: Map<Listed, string>,
  checkedSince: Date,
): Promise<Map<Listed, string[]>> {
  const out = new Map<Listed, string[]>();
  const externalIds = [
    ...new Set([...hashes.keys()].flatMap((i) => (i.product.externalId ? [i.product.externalId] : []))),
  ];
  if (externalIds.length === 0) return out;
  const rows = await db
    .select({
      id: schema.products.id,
      externalId: schema.products.externalId,
      sourceHash: schema.products.sourceHash,
      removedAt: schema.products.removedAt,
      lastCapturedAt: schema.products.lastCapturedAt,
    })
    .from(schema.products)
    .where(and(eq(schema.products.shopId, shopId), inArray(schema.products.externalId, externalIds)));
  const byExternalId = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.externalId ?? "";
    byExternalId.set(key, [...(byExternalId.get(key) ?? []), row]);
  }
  for (const [item, hash] of hashes) {
    const known = byExternalId.get(item.product.externalId ?? "");
    const fresh = (row: (typeof rows)[number]) =>
      row.removedAt === null &&
      row.sourceHash === hash &&
      row.lastCapturedAt !== null &&
      row.lastCapturedAt.getTime() >= checkedSince.getTime();
    if (known?.length && known.every(fresh)) {
      out.set(
        item,
        known.map((row) => row.id),
      );
    }
  }
  return out;
}

/**
 * Creates or updates the rows of one listed product, then copies its photos. The hash of its content is stored with
 * it, unless a photo could not be copied: the next import then writes it again and retries the photo.
 */
async function writeImported(
  deps: ImportDeps,
  shop: typeof schema.shops.$inferSelect,
  item: Listed,
  sourceHash: string | null,
  reference: Reference,
  seen: Set<string>,
  result: ImportResult,
  at: Date,
): Promise<void> {
  const { db } = deps;
  const { product } = item;
  const canonicalUrl = canonicalizeUrl(item.url);
  if (!canonicalUrl) return;
  const externalId = product.externalId;

  // Same Shopify product pasted by link under another address (collection path, variant): the same rows.
  const matches = await db
    .select({ id: schema.products.id, shopId: schema.products.shopId })
    .from(schema.products)
    .where(
      or(
        eq(schema.products.canonicalUrl, canonicalUrl),
        externalId ? and(eq(schema.products.shopId, shop.id), eq(schema.products.externalId, externalId)) : undefined,
      ),
    );
  // An address already owned by another shop is left alone.
  if (matches.some((m) => m.shopId !== shop.id)) return;

  const ids: string[] = [];
  for (const match of matches) {
    if (seen.has(match.id)) continue;
    await db.transaction(async (tx) => {
      await writeProduct(tx, {
        productId: match.id,
        product,
        url: item.url,
        listingKind: shop.listingKind,
        reference,
        at,
        history: "on_change",
        extra: { removedAt: null, sourceHash },
      });
    });
    ids.push(match.id);
    result.updated += 1;
  }
  if (matches.length === 0) {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({ shopId: shop.id, canonicalUrl, name: product.name, source: "captured" })
        .onConflictDoNothing()
        .returning({ id: schema.products.id });
      if (!row) return null;
      await writeProduct(tx, {
        productId: row.id,
        product,
        url: item.url,
        listingKind: shop.listingKind,
        reference,
        at,
        history: "on_change",
        extra: { sourceHash },
      });
      return row.id;
    });
    if (!created) return;
    ids.push(created);
    result.created += 1;
  }

  for (const id of ids) {
    seen.add(id);
    let complete = false;
    try {
      const failed = await copyImages(id, product.images, {
        db,
        store: deps.store,
        ...(deps.policy ? { policy: deps.policy } : {}),
        ...(deps.lookup ? { lookup: deps.lookup } : {}),
      });
      complete = failed === 0;
    } catch (error) {
      // The data is committed: a photo failure does not stop the import.
      console.error(`catalogue import: photo step failed for product ${id}`, error);
    }
    if (!complete && sourceHash) {
      await db.update(schema.products).set({ sourceHash: null }).where(eq(schema.products.id, id));
    }
  }
}

const importedOnSale = (shopId: string) =>
  and(eq(schema.products.shopId, shopId), isNull(schema.products.removedAt), isNotNull(schema.products.externalId));

/** Products of the shop known by a Shopify id and not removed. */
async function activeImported(db: Database, shopId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.products).where(importedOnSale(shopId));
  return row?.n ?? 0;
}

/**
 * Products of the shop known by a Shopify id that the complete listing no longer has: neither written by this import
 * nor listed under their id (a listed product the parser rejected is still on sale). Products without an id (a page
 * that is not a product, a manual entry) are not the import's to judge.
 */
async function markRemoved(
  db: Database,
  shopId: string,
  seen: Set<string>,
  listedIds: Set<string>,
  at: Date,
): Promise<number> {
  const listed = await db
    .select({ id: schema.products.id, externalId: schema.products.externalId })
    .from(schema.products)
    .where(importedOnSale(shopId));
  const gone = listed.filter((p) => !seen.has(p.id) && !listedIds.has(p.externalId ?? "")).map((p) => p.id);
  for (let i = 0; i < gone.length; i += REMOVE_CHUNK) {
    await db
      .update(schema.products)
      .set({ removedAt: at, updatedAt: at })
      .where(and(inArray(schema.products.id, gone.slice(i, i + REMOVE_CHUNK)), isNull(schema.products.removedAt)));
  }
  return gone.length;
}
