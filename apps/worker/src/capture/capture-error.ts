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
