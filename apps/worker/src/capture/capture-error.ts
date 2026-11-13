import type { CaptureErrorCode } from "@closyria/shared";

/** A capture failure with the code stored on the product and shown to the user. */
export class CaptureError extends Error {
  constructor(
    readonly code: CaptureErrorCode,
    readonly httpStatus?: number,
    options?: { cause?: unknown },
  ) {
    super(httpStatus === undefined ? code : `${code} (HTTP ${httpStatus})`, options);
    this.name = "CaptureError";
  }
}

/** What Shopify answers when it wants us to slow down: 429 (too many requests) and 430 (security rejection). */
const SHOPIFY_REJECTIONS = new Set([429, 430]);

/** Whether a failure is a Shopify « slow down » (429/430): the shop's work stops and every Shopify import slows down. */
export function isShopifyRejection(error: unknown): boolean {
  return error instanceof CaptureError && error.httpStatus !== undefined && SHOPIFY_REJECTIONS.has(error.httpStatus);
}
