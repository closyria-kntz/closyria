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
  type SQL,
  schema,
  sql,
} from "@closyria/db";
import {
  CATALOGUE_IMPORT_HEARTBEAT_MS,
  canonicalizeUrl,
  type ExtractedProduct,
  type ImportPhase,
  shopDomain,
  undatedOnCreate,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { type AddressPolicy, strictPolicy } from "../capture/address-policy";
import { CaptureError } from "../capture/capture-error";
import { copyImages } from "../capture/copy-images";
import type { RobotsCache } from "../capture/robots";
import { type SafeFetchAccept, type SafeResponse, safeFetch } from "../capture/safe-fetch";
import { loadReferenceSet } from "../capture/seed-reference";
import type { Throttle, ThrottleOptions } from "../capture/throttle";
import { type Reference, writeProduct } from "../capture/write-product";

/**
 * What every catalogue import shares, whatever the platform (Shopify, WooCommerce): one import per shop at a time, its
 * state and heartbeat for the admin, the page loop with its pause, the content-hash skip, the writing of products like
 * a captured link, and the end (shrink guard, removals, « Terminé »). A `CatalogSource` reads the platform's listing.
 */

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
  /** Listed products the parser rejected (WooCommerce: logged and counted); absent when none or not counted. */
  skipped?: number;
};

export const IMPORT_PAUSE_MS = 1000;
const PAGE_MAX_BYTES = 20 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 30_000;
/** Codes worth one more try after a pause; a refusal (robots, 401/403/429, challenge) stops at once. */
export const RETRIED = new Set(["http_error", "timeout"]);
const REMOVE_CHUNK = 1000;
/** Below this share of the products on sale at the last import, the listing is not trusted to remove anything. */
const SHRINK_RATIO = 0.5;
/** A product with the same content is still written in full once this old (new classification rules reach it). */
const RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

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

export class ImportStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export type Shop = typeof schema.shops.$inferSelect;

/** A listed product, as a capture of its page would give it. */
export type Listed = { url: string; product: ExtractedProduct };

export type ListingPage<T extends Listed> = {
  /** Products listed on the page, valid or not. */
  count: number;
  /** Platform id of every listed product, valid or not: a product skipped by the parser is still on sale. */
  listedIds: string[];
  products: T[];
  /** No page after this one. */
  last: boolean;
  /** The shop's own count of its products, when the listing gives it: the progress bar's scale. */
  total?: number | null;
};

/** A request's own caps: its size (20 MB by default) and the answer's headers to give back. */
export type FetchOptions = { maxBytes?: number; keepHeaders?: readonly string[] };

/** What a source sees of the import under way. */
export type ImportContext = {
  deps: ImportDeps;
  shop: Shop;
  origin: string;
  signal: AbortSignal;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  reference: Reference;
  /** One request at a time to the shop, 1 s apart (the first one goes at once); throws when interrupted. */
  spacing: () => Promise<void>;
  /** Proof of life for the admin, at most every 30 s. */
  beat: () => Promise<void>;
  /** Throws `interrupted` when the import was asked to stop. */
  interrupted: () => void;
  /** « Import en cours : lecture des tailles… » in the admin, after the pages. */
  setPhase: (phase: ImportPhase | null) => Promise<void>;
  /** One request to the shop through the guard rails (robots.txt, throttle, address policy, caps). */
  fetch: (url: string, accept: SafeFetchAccept, options?: FetchOptions) => Promise<SafeResponse>;
};

/** What a page brought: the rows left as they were (same content), and the listed products written. */
export type PageOutcome<T extends Listed> = { unchanged: Map<T, string[]>; written: T[] };

/** How one platform's public catalogue is read; everything else is the import's. */
export type CatalogSource<T extends Listed> = {
  /** The shop's slot on a shared line (Shopify), on top of its own spacing. */
  line?: ThrottleOptions;
  maxPages: number;
  /** The progress bar's scale before the first complete import (null: none). */
  estimate?: (ctx: ImportContext) => Promise<number | null>;
  fetchPage: (ctx: ImportContext, page: number) => Promise<ListingPage<T>>;
  /** A stable hash of everything written from a listed product (the content-hash skip). */
  hash: (item: T, listingKind: string) => string;
  /** The products of a page about to be written, as they are to be written (WooCommerce: last known stock). */
  prepare?: (ctx: ImportContext, items: T[]) => Promise<Map<T, Listed>>;
  /** After each page is written. */
  pageDone?: (ctx: ImportContext, outcome: PageOutcome<T>) => Promise<void>;
  /** Once every page is read, before the removals (WooCommerce: the per-size stock). */
  afterListing?: (ctx: ImportContext) => Promise<void>;
  /** The import stopped on this error (Shopify: its « slow down » slows every Shopify import). */
  stopped?: (ctx: ImportContext, error: unknown) => Promise<void>;
  /** Which of the shop's products the import may judge gone (on top of: known by an id, not removed). */
  judged?: SQL;
  /** Counts (and logs) the listed products the parser rejected: `skipped` in the result. */
  countsSkipped?: boolean;
};

export type ImportPlan<T extends Listed> = {
  /** The source for this shop's platform; null stops with `unsupported`. */
  source: (platform: string) => CatalogSource<T> | null;
  unsupported: string;
  /** The stop for an unsupported platform is also the shop's `last_import_error` (shown in the admin). */
  recordUnsupported?: boolean;
};

/**
 * Imports the public catalogue of a shop through its platform's source, one page at a time with a 1 s pause, through
 * the same guard rails as a capture (robots.txt, address policy, size and time caps, the shop's spacing). Products are
 * written exactly like a captured link (sizes, history, photos, classification). Once every page is read, products of
 * the shop that are no longer listed get `removed_at` (cleared when they come back); the wishes (`items`) are never
 * touched. At the first refusal the import stops, records `last_import_error` and removes nothing.
 * A product whose listing has the same content as at its last write (`source_hash`), that is not removed and was
 * checked less than 7 days ago is not written again: its check date moves (one update per page) and it counts as read
 * and listed.
 */
export async function runImport<T extends Listed>(
  deps: ImportDeps,
  shopId: string,
  plan: ImportPlan<T>,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, removed: 0, error: null };
  if (running.has(shopId)) return { ...result, error: "already_running" };
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  const done = (async () => {
    try {
      return await run(deps, shopId, plan, result, signal);
    } finally {
      // Over, whatever the outcome: no « Import en cours » left behind. A killed process leaves it: its heartbeat
      // then stops (shown as dead after 10 min), and the next worker start clears it and queues the import again.
      await deps.db
        .update(schema.shops)
        .set({ importState: null, importPhase: null })
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

async function run<T extends Listed>(
  deps: ImportDeps,
  shopId: string,
  plan: ImportPlan<T>,
  result: ImportResult,
  signal: AbortSignal,
): Promise<ImportResult> {
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
  const stopped = shop.mergedIntoId ? "merged" : shop.status === "refused" ? "refused" : null;
  if (stopped) {
    console.info(`catalogue import ${shopId} skipped: ${stopped}`);
    return { ...result, error: stopped };
  }
  const source = plan.source(shop.platform);
  if (!source) {
    if (plan.recordUnsupported) {
      await db
        .update(schema.shops)
        .set({ lastImportError: plan.unsupported, updatedAt: now() })
        .where(eq(schema.shops.id, shopId));
    }
    return { ...result, error: plan.unsupported };
  }
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
      importPhase: null,
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
  const ctx: ImportContext = {
    deps,
    shop,
    origin,
    signal,
    now,
    sleep,
    reference,
    spacing,
    beat,
    interrupted,
    setPhase: async (phase) => {
      await db.update(schema.shops).set({ importPhase: phase }).where(eq(schema.shops.id, shopId));
    },
    fetch: (url, accept, fetchOptions) => fetchShop(deps, url, accept, signal, source.line, fetchOptions),
  };
  const activeBefore = await activeImported(db, shopId, source.judged);
  const seen = new Set<string>();
  const listedIds = new Set<string>();
  let read = 0;
  let skipped = 0;
  const noteSkipped = () => {
    if (skipped === 0) return;
    result.skipped = skipped;
    console.warn(`catalogue import ${shopId}: ${skipped} listed product(s) skipped (unreadable or invalid)`);
  };
  try {
    // The bar's scale before the first complete import (after it, its count is the scale). Any failure: no estimate.
    const expected = shop.lastImportSeen === null && source.estimate ? await source.estimate(ctx) : null;
    if (expected !== null) {
      await db.update(schema.shops).set({ importExpected: expected }).where(eq(schema.shops.id, shopId));
    }
    for (let page = 1; ; page++) {
      if (page > source.maxPages) throw new ImportStop("too_many_pages");
      await spacing();
      await beat();
      const listing = await source.fetchPage(ctx, page);
      for (const id of listing.listedIds) listedIds.add(id);
      if (source.countsSkipped) skipped += listing.count - listing.products.length;
      // The shop's own count, when its listing gives one: the bar's scale from the first page.
      if (page === 1 && listing.total !== undefined && listing.total !== null) {
        await db.update(schema.shops).set({ importExpected: listing.total }).where(eq(schema.shops.id, shopId));
      }
      const hashes = new Map(listing.products.map((item) => [item, source.hash(item, shop.listingKind)]));
      const unchanged = await unchangedOf(db, shopId, hashes, new Date(now().getTime() - RECHECK_MS));
      const toWrite = listing.products.filter((item) => !unchanged.has(item));
      const prepared = source.prepare && toWrite.length > 0 ? await source.prepare(ctx, toWrite) : null;
      const checked: { id: string; rank: number }[] = [];
      for (const [index, item] of listing.products.entries()) {
        interrupted();
        await beat();
        // Its place in the shop's own listing: the order of the undated products in « Nouveautés ».
        const rank = read + index;
        const ids = unchanged.get(item);
        if (ids) {
          for (const id of ids) seen.add(id);
          checked.push(...ids.map((id) => ({ id, rank })));
          result.unchanged += 1;
          continue;
        }
        await writeImported(
          deps,
          shop,
          prepared?.get(item) ?? item,
          hashes.get(item) ?? null,
          rank,
          reference,
          seen,
          result,
          now(),
        );
      }
      // Checked today, unchanged: the sheet's « Mis à jour le » and the capture's freshness stay current, and its
      // place in the listing moves with the shop's new products (one update per page).
      if (checked.length > 0) await markChecked(db, checked, now());
      await source.pageDone?.(ctx, { unchanged, written: toWrite });
      // « Import en cours : page n, x articles lus » in the admin, after each page.
      read += listing.count;
      lastBeat = now().getTime();
      await db
        .update(schema.shops)
        .set({ importPages: page, importSeen: read, importHeartbeatAt: new Date(lastBeat) })
        .where(eq(schema.shops.id, shopId));
      if (listing.last) break;
    }
    await source.afterListing?.(ctx);
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
    noteSkipped();
    await db.update(schema.shops).set({ lastImportError: reason, updatedAt: now() }).where(eq(schema.shops.id, shopId));
    if (!signal.aborted) await source.stopped?.(ctx, error);
    return result;
  }

  noteSkipped();
  // An empty or much shorter listing is more likely a broken shop than a closing-down sale: remove nothing.
  if (listedIds.size === 0 || listedIds.size < activeBefore * SHRINK_RATIO) {
    result.error = "suspicious_shrink";
    await db
      .update(schema.shops)
      .set({ lastImportError: result.error, updatedAt: now() })
      .where(eq(schema.shops.id, shopId));
    return result;
  }
  result.removed = await markRemoved(db, shopId, seen, listedIds, now(), source.judged);
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

/** The origin of the shop's reference page, else of its first domain. */
async function shopOrigin(db: Database, shop: Shop): Promise<string | null> {
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
 * domain's throttle (and the Shopify line for a Shopify shop: `line`), the address policy, the size and time caps;
 * cut short when `signal` is aborted.
 */
async function fetchShop(
  deps: ImportDeps,
  url: string,
  accept: SafeFetchAccept,
  signal: AbortSignal,
  line: ThrottleOptions | undefined,
  { maxBytes = PAGE_MAX_BYTES, keepHeaders }: FetchOptions = {},
) {
  // robots.txt first (cached per origin): its own request never shares the slot of the page.
  if (!(await deps.robots.allows(url))) throw new ImportStop("robots_disallowed");
  await deps.throttle.wait(shopDomain(url), line);
  return safeFetch(url, {
    accept,
    policy: deps.policy ?? strictPolicy,
    maxBytes,
    timeoutMs: PAGE_TIMEOUT_MS,
    signal,
    ...(deps.lookup ? { lookup: deps.lookup } : {}),
    ...(keepHeaders ? { keepHeaders } : {}),
  });
}

/** A page request with one more try after a pause for a server error or a timeout (`retried`). */
export async function withRetry<R>(
  ctx: ImportContext,
  attemptOnce: () => Promise<R>,
  retried: (error: CaptureError) => boolean = (error) => RETRIED.has(error.code),
): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptOnce();
    } catch (error) {
      if (attempt === 1 && !ctx.signal.aborted && error instanceof CaptureError && retried(error)) {
        await ctx.sleep(IMPORT_PAUSE_MS);
        continue;
      }
      throw error;
    }
  }
}

/**
 * A stable hash of `value` (a listed product with what else its source writes from the listing), plus the shop's
 * listing kind (second-hand shops keep no sizes).
 */
export function hashOf(value: Record<string, unknown>, listingKind: string): string {
  return createHash("sha256")
    .update(stableJson({ ...value, listingKind }))
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
 * The products of a page that need no write, with the ids of their rows: every row of the shop under that platform
 * id holds the same `source_hash`, is not removed and was checked since `checkedSince`. One query per page.
 */
async function unchangedOf<T extends Listed>(
  db: Database,
  shopId: string,
  hashes: Map<T, string>,
  checkedSince: Date,
): Promise<Map<T, string[]>> {
  const out = new Map<T, string[]>();
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
  shop: Shop,
  item: Listed,
  sourceHash: string | null,
  shopRank: number,
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

  // Same product pasted by link under another address (collection path, variant): the same rows.
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
        extra: { removedAt: null, sourceHash, shopRank },
      });
    });
    ids.push(match.id);
    result.updated += 1;
  }
  if (matches.length === 0) {
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.products)
        .values({
          shopId: shop.id,
          canonicalUrl,
          name: product.name,
          source: "captured",
          // On sale before the shop's first completed import: no date (`unknown`); after it, first seen now.
          ...undatedOnCreate(shop.lastImportAt, at),
        })
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
        extra: { sourceHash, shopRank },
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

/** Rows left as they were: checked now, at their new place in the listing. */
async function markChecked(db: Database, checked: { id: string; rank: number }[], at: Date): Promise<void> {
  const rows = sql.join(
    checked.map((c) => sql`(${c.id}::uuid, ${c.rank}::int)`),
    sql`, `,
  );
  await db.execute(sql`
    update products p set last_captured_at = ${at.toISOString()}::timestamptz, shop_rank = v.rank
    from (values ${rows}) as v(id, rank)
    where p.id = v.id`);
}

const importedOnSale = (shopId: string, judged: SQL | undefined) =>
  and(
    eq(schema.products.shopId, shopId),
    isNull(schema.products.removedAt),
    isNotNull(schema.products.externalId),
    judged,
  );

/** Products of the shop known by a platform id and not removed. */
async function activeImported(db: Database, shopId: string, judged: SQL | undefined): Promise<number> {
  const [row] = await db.select({ n: count() }).from(schema.products).where(importedOnSale(shopId, judged));
  return row?.n ?? 0;
}

/**
 * Products of the shop known by a platform id that the complete listing no longer has: neither written by this
 * import nor listed under their id (a listed product the parser rejected is still on sale). Products without an id (a
 * page that is not a product, a manual entry) are not the import's to judge.
 */
async function markRemoved(
  db: Database,
  shopId: string,
  seen: Set<string>,
  listedIds: Set<string>,
  at: Date,
  judged: SQL | undefined,
): Promise<number> {
  const listed = await db
    .select({ id: schema.products.id, externalId: schema.products.externalId })
    .from(schema.products)
    .where(importedOnSale(shopId, judged));
  const gone = listed.filter((p) => !seen.has(p.id) && !listedIds.has(p.externalId ?? "")).map((p) => p.id);
  for (let i = 0; i < gone.length; i += REMOVE_CHUNK) {
    await db
      .update(schema.products)
      .set({ removedAt: at, updatedAt: at })
      .where(and(inArray(schema.products.id, gone.slice(i, i + REMOVE_CHUNK)), isNull(schema.products.removedAt)));
  }
  return gone.length;
}
