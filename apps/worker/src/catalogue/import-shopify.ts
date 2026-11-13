import type dns from "node:dns";
import { and, asc, count, type Database, eq, inArray, isNotNull, isNull, or, schema } from "@closyria/db";
import { extractShopifyCatalogPage, type ShopifyCatalogPage } from "@closyria/extract";
import { canonicalizeUrl, shopDomain } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { type AddressPolicy, strictPolicy } from "../capture/address-policy";
import { CaptureError } from "../capture/capture-error";
import { copyImages } from "../capture/copy-images";
import { decodeBody } from "../capture/decode";
import type { RobotsCache } from "../capture/robots";
import { safeFetch } from "../capture/safe-fetch";
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

export type ImportResult = { created: number; updated: number; removed: number; error: string | null };

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

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shops being imported by this process: a shop never has two imports at once (the queue also forbids it). The lock
 * lives as long as the import itself, not the pg-boss job: if a very long import outlives the job's expiry (6 h), a
 * new job for the same shop in this process finds the lock and stops with `already_running`. One worker process only.
 */
const running = new Set<string>();

class ImportStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Imports the public catalogue of a Shopify shop (`/products.json?limit=250&page=n`), one page at a time with a 1 s
 * pause, through the same guard rails as a capture (robots.txt, address policy, size and time caps). Products are
 * written exactly like a captured link (sizes, history, photos, classification). Once every page is read, products
 * of the shop that are no longer listed get `removed_at` (cleared when they come back); the wishes (`items`) are
 * never touched. At the first refusal the import stops, records `last_import_error` and removes nothing.
 */
export async function importShopifyCatalog(deps: ImportDeps, shopId: string): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, removed: 0, error: null };
  if (running.has(shopId)) return { ...result, error: "already_running" };
  running.add(shopId);
  try {
    return await run(deps, shopId, result);
  } finally {
    running.delete(shopId);
  }
}

async function run(deps: ImportDeps, shopId: string, result: ImportResult): Promise<ImportResult> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;

  const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, shopId));
  if (!shop) return { ...result, error: "shop_not_found" };
  if (shop.platform !== "shopify") return { ...result, error: "not_shopify" };
  const origin = await shopOrigin(db, shop);
  if (!origin) {
    await db
      .update(schema.shops)
      .set({ lastImportError: "no_address", updatedAt: now() })
      .where(eq(schema.shops.id, shopId));
    return { ...result, error: "no_address" };
  }

  const reference = await loadReferenceSet(db);
  const activeBefore = await activeImported(db, shopId);
  const seen = new Set<string>();
  const listedIds = new Set<string>();
  try {
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new ImportStop("too_many_pages");
      if (page > 1) await sleep(IMPORT_PAUSE_MS);
      const listing = await fetchPage(deps, origin, page, sleep);
      for (const id of listing.listedIds) listedIds.add(id);
      for (const item of listing.products) {
        await writeImported(deps, shop, item, reference, seen, result, now());
      }
      if (listing.count < IMPORT_PAGE_SIZE) break;
    }
  } catch (error) {
    const reason =
      error instanceof ImportStop ? error.reason : error instanceof CaptureError ? error.message : "unexpected_error";
    if (!(error instanceof ImportStop || error instanceof CaptureError)) {
      console.error(`catalogue import ${shopId} failed`, error);
    }
    result.error = reason;
    await db.update(schema.shops).set({ lastImportError: reason, updatedAt: now() }).where(eq(schema.shops.id, shopId));
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
    .set({ lastImportAt: at, lastImportError: null, updatedAt: at })
    .where(eq(schema.shops.id, shopId));
  return result;
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

async function fetchPage(
  deps: ImportDeps,
  origin: string,
  page: number,
  sleep: (ms: number) => Promise<void>,
): Promise<ShopifyCatalogPage> {
  const url = `${origin}/products.json?limit=${IMPORT_PAGE_SIZE}&page=${page}`;
  for (let attempt = 1; ; attempt++) {
    await deps.throttle.wait(shopDomain(url));
    if (!(await deps.robots.allows(url))) throw new ImportStop("robots_disallowed");
    try {
      const response = await safeFetch(url, {
        accept: "json",
        policy: deps.policy ?? strictPolicy,
        maxBytes: PAGE_MAX_BYTES,
        timeoutMs: PAGE_TIMEOUT_MS,
        ...(deps.lookup ? { lookup: deps.lookup } : {}),
      });
      const listing = extractShopifyCatalogPage(decodeBody(response.body, response.contentType), origin);
      if (!listing) throw new ImportStop("invalid_data");
      return listing;
    } catch (error) {
      if (attempt === 1 && error instanceof CaptureError && RETRIED.has(error.code)) {
        await sleep(IMPORT_PAUSE_MS);
        continue;
      }
      throw error;
    }
  }
}

/** Creates or updates the rows of one listed product, then copies its photos. */
async function writeImported(
  deps: ImportDeps,
  shop: typeof schema.shops.$inferSelect,
  item: ShopifyCatalogPage["products"][number],
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
        extra: { removedAt: null },
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
      });
      return row.id;
    });
    if (!created) return;
    ids.push(created);
    result.created += 1;
  }

  for (const id of ids) {
    seen.add(id);
    try {
      await copyImages(id, product.images, {
        db,
        store: deps.store,
        ...(deps.policy ? { policy: deps.policy } : {}),
        ...(deps.lookup ? { lookup: deps.lookup } : {}),
      });
    } catch (error) {
      // The data is committed: a photo failure does not stop the import.
      console.error(`catalogue import: photo step failed for product ${id}`, error);
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
