/** Remounts the product view on any change of product or followed capture, so no state leaks across them. */
export const viewKey = (productId: string, captureId: string | null): string => `${productId}:${captureId ?? ""}`;
