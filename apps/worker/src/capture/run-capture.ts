import type dns from "node:dns";
import { and, type Database, eq, isNotNull, isNull, ne, recordShopifyRejection, schema } from "@closyria/db";
import { extract, isShopifyPage, shopifyJsUrl } from "@closyria/extract";
import {
  CATALOGUE_SHEET_REFRESH_MAX_WAIT_MS,
  type CaptureErrorCode,
  type CaptureMethod,
  type CaptureTrigger,
  type ExtractedProduct,
  shopDomain,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { type AddressPolicy, strictPolicy } from "./address-policy";
import { CaptureError, isShopifyRejection } from "./capture-error";
import { copyImages } from "./copy-images";
import { decodeBody } from "./decode";
import type { RobotsCache } from "./robots";
import { type SafeFetchAccept, safeFetch } from "./safe-fetch";
import { loadReferenceSet } from "./seed-reference";
import type { LinePriority, Throttle, ThrottleOptions } from "./throttle";
import { writeProduct } from "./write-product";

export type CaptureDeps = {
  db: Database;
  store: ObjectStore;
  /** Strict by default; tests inject a policy that reaches the fake shop. */
  policy?: AddressPolicy;
  robots: RobotsCache;
  throttle: Throttle;
  now?: () => Date;
  /** Injectable DNS resolver (tests). */
  lookup?: typeof dns.lookup;
};

type Outcome = { method: CaptureMethod; product: ExtractedProduct; httpStatus: number };

/** HTTP answers that say the product page is gone for good (not a block, a timeout or a server hiccup). */
const GONE_STATUSES = new Set([404, 410]);

/** Whether a capture failure is a definitive « the shop removed this page ». */
function isGone(error: unknown): boolean {
  return (
    error instanceof CaptureError &&
    error.code === "http_error" &&
    error.httpStatus !== undefined &&
    GONE_STATUSES.has(error.httpStatus)
  );
}

/**
 * The product a capture speaks for: the user's (or a sheet refresh's) product, or for a monitor the product known at
 * its test address (`canonical_url` is unique). An admin test speaks for none.
 */
async function productOf(db: Database, capture: typeof schema.captures.$inferSelect): Promise<string | null> {
  if (capture.trigger === "user" || capture.trigger === "refresh") return capture.productId;
  if (capture.trigger !== "monitor") return null;
  if (capture.productId) return capture.productId;
  const [product] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.canonicalUrl, capture.url));
  return product?.id ?? null;
}

/**
 * Its place on the Shopify line: a link someone pasted (or an admin test) first, then a sheet's refresh, then the
 * monitors (with the catalogue pages).
 */
const LINE_PRIORITY: Record<CaptureTrigger, LinePriority> = {
  user: "high",
  admin_test: "high",
  refresh: "medium",
  monitor: "low",
};

/** `extract` wants an HTML document; with a Shopify `.js` alone there is no page, so it gets an empty one. */
const EMPTY_PAGE = "<html></html>";

/**
 * Runs one queued capture. Never throws: a failure is recorded on the capture (and on the product for a
 * user capture), so pg-boss does not retry. A capture that is not `queued` is ignored (re-delivery).
 */
export async function runCapture(captureId: string, deps: CaptureDeps): Promise<void> {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();

  let capture: typeof schema.captures.$inferSelect | undefined;
  try {
    [capture] = await db
      .update(schema.captures)
      .set({ status: "running" })
      .where(and(eq(schema.captures.id, captureId), eq(schema.captures.status, "queued")))
      .returning();
  } catch (error) {
    console.error(`capture ${captureId}: cannot start`, error);
    return;
  }
  if (!capture) return;

  // A sheet's refresh that waited too long: the person has moved on, it does not take a slot (nothing is fetched).
  if (
    capture.trigger === "refresh" &&
    startedAt.getTime() - capture.createdAt.getTime() > CATALOGUE_SHEET_REFRESH_MAX_WAIT_MS
  ) {
    await db
      .update(schema.captures)
      .set({ status: "failed", errorCode: "timeout", durationMs: 0, finishedAt: startedAt })
      .where(and(eq(schema.captures.id, captureId), eq(schema.captures.status, "running")))
      .catch((error) => console.error(`capture ${captureId}: cannot drop a stale refresh`, error));
    return;
  }

  let platform: string | undefined;
  try {
    const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, capture.shopId));
    if (!shop) throw new Error("shop not found");
    platform = shop.platform;
    const shopId = shop.id;
    // A shop of unknown platform whose page turns out to be Shopify is one from now on: the Shopify line and the
    // slow-down apply to it, this capture included.
    const foundShopify = async () => {
      platform = "shopify";
      if (shop.platform !== "unknown") return;
      await db
        .update(schema.shops)
        .set({ platform: "shopify", updatedAt: now() })
        .where(and(eq(schema.shops.id, shopId), eq(schema.shops.platform, "unknown")));
    };
    const outcome = await fetchAndExtract(
      capture.url,
      shop.platform,
      LINE_PRIORITY[capture.trigger as CaptureTrigger],
      deps,
      foundShopify,
    );
    const { product } = outcome;

    // A sheet's refresh (« stocks frais ») writes like her capture, but the history only on a change: it may run
    // every 15 minutes.
    if (capture.trigger === "user" || capture.trigger === "refresh") {
      if (!capture.productId) throw new Error(`${capture.trigger} capture without a product`);
      const productId = capture.productId;
      const at = now();
      // Small tables, read once per capture and only for a product the rules may still touch.
      const [before] = await db
        .select({ classifiedBy: schema.products.classifiedBy })
        .from(schema.products)
        .where(eq(schema.products.id, productId));
      const reference = before?.classifiedBy === "admin" ? undefined : await loadReferenceSet(db);
      await db.transaction(async (tx) => {
        await writeProduct(tx, {
          productId,
          product,
          url: capture.url,
          listingKind: shop.listingKind,
          reference,
          at,
          history: capture.trigger === "user" ? "always" : "on_change",
          // The page answers again: a product marked gone comes back to the catalogue.
          extra: { removedAt: null },
        });
        await tx.update(schema.captures).set({ dataReady: true }).where(eq(schema.captures.id, captureId));
      });
      try {
        await copyImages(productId, product.images, {
          db,
          store: deps.store,
          ...(deps.policy ? { policy: deps.policy } : {}),
          ...(deps.lookup ? { lookup: deps.lookup } : {}),
        });
      } catch (error) {
        // The data is committed: a photo-step failure must not fail the capture.
        console.error(`capture ${captureId}: photo step failed`, error);
      }
    }

    if (capture.trigger === "monitor") {
      const productId = await productOf(db, capture);
      if (productId) {
        await db
          .update(schema.products)
          .set({ removedAt: null, updatedAt: now() })
          .where(and(eq(schema.products.id, productId), isNotNull(schema.products.removedAt)));
      }
    }

    // Any successful capture (user, admin test, monitor) pre-fills the platform of a shop still `unknown`.
    if (shop.platform === "unknown") {
      const at = now();
      await db
        .update(schema.shops)
        .set({ platform: product.platform, updatedAt: at })
        .where(and(eq(schema.shops.id, shop.id), eq(schema.shops.platform, "unknown")));
    }

    const finishedAt = now();
    await db
      .update(schema.captures)
      .set({
        status: "succeeded",
        method: outcome.method,
        httpStatus: outcome.httpStatus,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        finishedAt,
        ...(capture.trigger === "user" || capture.trigger === "refresh" ? {} : { result: product }),
      })
      // Not when the sweep already failed it (timeout): a late success must not undo that.
      .where(and(eq(schema.captures.id, captureId), eq(schema.captures.status, "running")));
  } catch (error) {
    await recordFailure(capture, error, startedAt, deps);
    // A Shopify shop asks us to slow down (429/430): every Shopify import slows down.
    if (platform === "shopify" && isShopifyRejection(error)) {
      try {
        const state = await recordShopifyRejection(db, now());
        console.warn(
          `capture ${captureId}: Shopify asks to slow down, imports ${state.level} until ${state.until.toISOString()}`,
        );
      } catch (writeError) {
        console.error(`capture ${captureId}: cannot record the Shopify slow-down`, writeError);
      }
    }
  }
}

async function recordFailure(
  capture: typeof schema.captures.$inferSelect,
  error: unknown,
  startedAt: Date,
  deps: CaptureDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const code: CaptureErrorCode = error instanceof CaptureError ? error.code : "http_error";
  const httpStatus = error instanceof CaptureError ? (error.httpStatus ?? null) : null;
  if (!(error instanceof CaptureError)) console.error(`capture ${capture.id} failed`, error);
  const finishedAt = now();
  try {
    const goneProductId = isGone(error) ? await productOf(deps.db, capture) : null;
    await deps.db.transaction(async (tx) => {
      await tx
        .update(schema.captures)
        .set({
          status: "failed",
          errorCode: code,
          httpStatus,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          finishedAt,
        })
        // Only while running: a capture already swept to failed/timeout keeps its error code.
        .where(and(eq(schema.captures.id, capture.id), eq(schema.captures.status, "running")));
      if ((capture.trigger === "user" || capture.trigger === "refresh") && capture.productId) {
        await tx
          .update(schema.products)
          .set({ captureStatus: "failed", updatedAt: finishedAt })
          .where(
            and(
              eq(schema.products.id, capture.productId),
              ne(schema.products.captureStatus, "ok"),
              ne(schema.products.captureStatus, "manual"),
            ),
          );
      }
      // The shop says the page is gone (404/410): the product leaves « Découvrir ». Her items and wishlists keep it.
      if (goneProductId) {
        await tx
          .update(schema.products)
          .set({ removedAt: finishedAt, updatedAt: finishedAt })
          .where(and(eq(schema.products.id, goneProductId), isNull(schema.products.removedAt)));
      }
    });
  } catch (writeError) {
    // Nothing more can be done (database down); pg-boss must still not retry.
    console.error(`capture ${capture.id}: cannot record the failure`, writeError);
  }
}

async function fetchAndExtract(
  url: string,
  platform: string,
  priority: LinePriority,
  deps: CaptureDeps,
  foundShopify: () => Promise<void>,
): Promise<Outcome> {
  const policy = deps.policy ?? strictPolicy;
  const domain = shopDomain(url);

  /**
   * Robots-checked and paced fetch: the page and its `.js` only (photos go through `copyImages`). A Shopify shop's
   * (known, or found by its page) also takes a slot on the Shopify line. robots.txt is checked first (cached per
   * origin), so its own request never shares the slot of the page.
   */
  async function fetchPaced(target: string, accept: SafeFetchAccept, shopify = platform === "shopify") {
    if (!(await deps.robots.allows(target))) throw new CaptureError("robots_disallowed");
    const options: ThrottleOptions | undefined = shopify ? { shopify: priority } : undefined;
    await deps.throttle.wait(domain, options);
    return safeFetch(target, { accept, policy, ...(deps.lookup ? { lookup: deps.lookup } : {}) });
  }

  async function fromShopifyJs(jsUrl: string, page?: { finalUrl: string; contentType: string; html: string }) {
    const js = await fetchPaced(jsUrl, "json", true);
    const result = extract({
      url: page?.finalUrl ?? url,
      contentType: page?.contentType ?? "text/html",
      body: page?.html ?? EMPTY_PAGE,
      shopifyJson: decodeBody(js.body, js.contentType),
    });
    return { result, status: js.status };
  }

  const jsUrl = shopifyJsUrl(url);
  let jsFailure: string | undefined;
  if (platform === "shopify" && jsUrl) {
    try {
      const { result, status } = await fromShopifyJs(jsUrl);
      if (result.ok) return { method: result.method, product: result.product, httpStatus: status };
      jsFailure = result.error;
    } catch (error) {
      // Shopify asks us to slow down: never ask its page as well.
      if (isShopifyRejection(error)) throw error;
      // Fall back to the HTML page below.
      jsFailure = error instanceof CaptureError ? error.message : "unexpected error";
    }
  }
  // One line, no address and no personal data: only the reason the `.js` was not usable.
  const logJsFailure = () => {
    if (jsFailure) console.debug(`shopify .js unusable (${jsFailure}), HTML fallback failed too`);
  };

  let page: Awaited<ReturnType<typeof fetchPaced>>;
  try {
    page = await fetchPaced(url, "page");
  } catch (error) {
    logJsFailure();
    throw error;
  }
  const html = decodeBody(page.body, page.contentType);
  const pageInfo = { finalUrl: page.finalUrl, contentType: page.contentType, html };
  let result = extract({ url: page.finalUrl, contentType: page.contentType, body: html });
  let status = page.status;
  if (platform !== "shopify" && jsUrl && isShopifyPage(html)) {
    await foundShopify();
    try {
      const withJs = await fromShopifyJs(jsUrl, pageInfo);
      if (withJs.result.ok) {
        result = withJs.result;
        status = withJs.status;
      }
    } catch (error) {
      // Shopify asks us to slow down: it counts like any Shopify shop's.
      if (isShopifyRejection(error)) throw error;
      // Keep what the page alone gives.
    }
  }
  if (!result.ok) {
    logJsFailure();
    throw new CaptureError(result.error, page.status);
  }
  return { method: result.method, product: result.product, httpStatus: status };
}
