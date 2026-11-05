import { describe, expect, it } from "vitest";
import { extract } from "./index";

const html = "<html><head><title>x</title></head></html>";
const base = {
  id: 123,
  title: "Robe",
  vendor: "Maison",
  description: "<p>Jolie</p>",
  images: ["//cdn.shopify.com/a.jpg", "//cdn.shopify.com/b.jpg"],
  price: 4990,
  compare_at_price: 5990,
};
const run = (json: unknown) =>
  extract({
    url: "https://shop.example.com/products/robe",
    contentType: "text/html",
    body: html,
    shopifyJson: typeof json === "string" ? json : JSON.stringify(json),
  });

describe("extract shopify", () => {
  it("reads sizes from the Taille option", () => {
    const r = run({
      ...base,
      options: [{ name: "Taille", position: 1, values: ["S", "M", "L"] }],
      variants: [
        { id: 1, available: true, price: 4990, option1: "S" },
        { id: 2, available: false, price: 4990, option1: "M" },
        { id: 3, available: true, price: 4990, option1: "L" },
      ],
    });
    if (!r.ok) throw new Error("not ok");
    expect(r.method).toBe("shopify");
    expect(r.product).toMatchObject({
      name: "Robe",
      brand: "Maison",
      description: "Jolie",
      priceCents: 4990,
      compareAtCents: 5990,
      currency: "EUR",
      externalId: "123",
      platform: "shopify",
      images: ["https://cdn.shopify.com/a.jpg", "https://cdn.shopify.com/b.jpg"],
    });
    expect(r.product.sizes).toEqual([
      { label: "S", available: true },
      { label: "M", available: false },
      { label: "L", available: true },
    ]);
  });

  it("falls back to the first option and handles string options and per-size prices", () => {
    const r = run({
      ...base,
      compare_at_price: null,
      options: ["Color"],
      variants: [
        { id: 1, available: false, price: 4990, option1: "Rouge" },
        { id: 2, available: true, price: 5500, option1: "Rouge", option2: "x" },
        { id: 3, available: true, price: 4990, option1: "Bleu" },
      ],
    });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.compareAtCents).toBeUndefined();
    expect(r.product.sizes).toEqual([
      { label: "Rouge", available: true, priceCents: 5500 },
      { label: "Bleu", available: true },
    ]);
  });

  it("finds a size option in a later position", () => {
    const r = run({
      ...base,
      options: [
        { name: "Color", values: ["a"] },
        { name: "Pointure", values: ["38"] },
      ],
      variants: [{ id: 1, available: true, price: 4990, option1: "a", option2: "38" }],
    });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.sizes).toEqual([{ label: "38", available: true }]);
  });

  it("gives no sizes without options or variants, and tolerates a missing price in variants", () => {
    const r = run({ ...base, options: [], variants: [{ id: 1, available: true, option1: "Default Title" }] });
    if (!r.ok) throw new Error("not ok");
    expect(r.product.sizes).toEqual([]);
    const r2 = run({ ...base });
    if (!r2.ok) throw new Error("not ok");
    expect(r2.product.sizes).toEqual([]);
  });

  it("falls back to other methods on invalid JSON or wrong shape", () => {
    expect(run("{nope")).toEqual({ ok: false, error: "not_a_product" });
    expect(run({ foo: 1 })).toEqual({ ok: false, error: "not_a_product" });
    expect(run({ ...base, title: "", price: 1 })).toEqual({ ok: false, error: "not_a_product" });
  });

  it("rejects invalid data", () => {
    expect(run({ ...base, price: -1 }).ok).toBe(false);
  });
});
