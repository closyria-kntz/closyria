import type dns from "node:dns";
import { and, type Database, eq, isNotNull, isNull, ne, schema } from "@closyria/db";
import { extract, isShopifyPage, shopifyJsUrl } from "@closyria/extract";
import { type CaptureErrorCode, type CaptureMethod, type ExtractedProduct, shopDomain } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { type AddressPolicy, strictPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";
import { copyImages } from "./copy-images";
import { decodeBody } from "./decode";
import type { RobotsCache } from "./robots";
import { type SafeFetchAccept, safeFetch } from "./safe-fetch";
import { loadReferenceSet } from "./seed-reference";
import type { Throttle } from "./throttle";
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
 * The product a capture speaks for: the user's product, or for a monitor the product known at its test address
 * (`canonical_url` is unique). An admin test speaks for none.
 */
async function productOf(db: Database, capture: typeof schema.captures.$inferSelect): Promise<string | null> {
  if (capture.trigger === "user") return capture.productId;
  if (capture.trigger !== "monitor") return null;
  if (capture.productId) return capture.productId;
  const [product] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.canonicalUrl, capture.url));
  return product?.id ?? null;
}

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

  try {
    const [shop] = await db.select().from(schema.shops).where(eq(schema.shops.id, capture.shopId));
    if (!shop) throw new Error("shop not found");
    const outcome = await fetchAndExtract(capture.url, shop.platform, deps);
    const { product } = outcome;

    if (capture.trigger === "user") {
      if (!capture.productId) throw new Error("user capture without a product");
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
          history: "always",
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
        ...(capture.trigger === "user" ? {} : { result: product }),
      })
      // Not when the sweep already failed it (timeout): a late success must not undo that.
      .where(and(eq(schema.captures.id, captureId), eq(schema.captures.status, "running")));
  } catch (error) {
    await recordFailure(capture, error, startedAt, deps);
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
      if (capture.trigger === "user" && capture.productId) {
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

async function fetchAndExtract(url: string, platform: string, deps: CaptureDeps): Promise<Outcome> {
  const policy = deps.policy ?? strictPolicy;
  const domain = shopDomain(url);

  /** Paced and robots-checked fetch: the page and its `.js` only (photos go through `copyImages`). */
  async function fetchPaced(target: string, accept: SafeFetchAccept) {
    await deps.throttle.wait(domain);
    if (!(await deps.robots.allows(target))) throw new CaptureError("robots_disallowed");
    return safeFetch(target, { accept, policy, ...(deps.lookup ? { lookup: deps.lookup } : {}) });
  }

  async function fromShopifyJs(jsUrl: string, page?: { finalUrl: string; contentType: string; html: string }) {
    const js = await fetchPaced(jsUrl, "json");
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
    try {
      const withJs = await fromShopifyJs(jsUrl, pageInfo);
      if (withJs.result.ok) {
        result = withJs.result;
        status = withJs.status;
      }
    } catch {
      // Keep what the page alone gives.
    }
  }
  if (!result.ok) {
    logJsFailure();
    throw new CaptureError(result.error, page.status);
  }
  return { method: result.method, product: result.product, httpStatus: status };
}
