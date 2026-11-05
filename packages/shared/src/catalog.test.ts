import { describe, expect, it } from "vitest";
import {
  CAPTURE_QUEUES,
  captureErrorCodeSchema,
  extractedProductSchema,
  manualEntrySchema,
  productSourceSchema,
  productViewSchema,
} from "./catalog";

const product = {
  name: "Robe",
  currency: "EUR",
  priceCents: 2999,
  images: [],
  sizes: [{ label: "M", available: true }],
  platform: "other",
} as const;

describe("extractedProductSchema", () => {
  it("accepts a minimal product", () => {
    expect(extractedProductSchema.safeParse(product).success).toBe(true);
  });
  it("accepts 8 photos and refuses 9", () => {
    const img = (n: number) => Array.from({ length: n }, (_, i) => `https://x.fr/${i}.jpg`);
    expect(extractedProductSchema.safeParse({ ...product, images: img(8) }).success).toBe(true);
    expect(extractedProductSchema.safeParse({ ...product, images: img(9) }).success).toBe(false);
  });
  it("refuses a non-integer price", () => {
    expect(extractedProductSchema.safeParse({ ...product, priceCents: 29.99 }).success).toBe(false);
  });
});

describe("manualEntrySchema", () => {
  it("validates bounds", () => {
    expect(manualEntrySchema.safeParse({ name: "A", sizes: [] }).success).toBe(true);
    expect(manualEntrySchema.safeParse({ name: "", sizes: [] }).success).toBe(false);
    expect(manualEntrySchema.safeParse({ name: "A", priceCents: -1, sizes: [] }).success).toBe(false);
    expect(manualEntrySchema.safeParse({ name: "A", sizes: Array(31).fill("M") }).success).toBe(false);
  });
});

describe("constants", () => {
  it("exposes queues and error codes", () => {
    expect(CAPTURE_QUEUES.admin).toBe("capture-admin");
    expect(captureErrorCodeSchema.safeParse("blocked").success).toBe(true);
    expect(captureErrorCodeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("productViewSchema source", () => {
  it("is captured or manual", () => {
    expect(productSourceSchema.safeParse("captured").success).toBe(true);
    expect(productSourceSchema.safeParse("manual").success).toBe(true);
    expect(productSourceSchema.safeParse("jsonld").success).toBe(false);
    expect(productViewSchema.shape.source).toBe(productSourceSchema);
  });
});
