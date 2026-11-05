import { describe, expect, it } from "vitest";
import { formatOptionalPrice, formatPrice, parsePriceCents, parseSizes } from "./price";

describe("parsePriceCents", () => {
  it.each([
    ["29,99", 2999],
    ["29.99", 2999],
    ["29", 2900],
    [" 1 299,5 € ", 129950],
    ["0", 0],
  ])("%s -> %s", (input, cents) => {
    expect(parsePriceCents(input)).toEqual({ ok: true, cents });
  });

  it("treats an empty field as no price", () => {
    expect(parsePriceCents("  ")).toEqual({ ok: true, cents: undefined });
  });

  it.each(["abc", "-3", "1,234", "1,2,3", "12e3"])("rejects %s", (input) => {
    expect(parsePriceCents(input)).toEqual({ ok: false });
  });
});

describe("parseSizes", () => {
  it("splits on commas, trims and drops empty labels", () => {
    expect(parseSizes(" S, M ,, 38 ,")).toEqual(["S", "M", "38"]);
    expect(parseSizes("")).toEqual([]);
  });
});

describe("formatPrice", () => {
  it("formats cents as a currency amount in the locale", () => {
    expect(formatPrice("fr", 2999, "EUR").replace(/\s/g, " ")).toBe("29,99 €");
    expect(formatPrice("en", 2999, "EUR")).toBe("€29.99");
  });
});

describe("formatOptionalPrice", () => {
  it("shows the fallback, never NaN, when there is no price", () => {
    expect(formatOptionalPrice("fr", null, "EUR", "Prix non renseigné")).toBe("Prix non renseigné");
    expect(formatOptionalPrice("fr", Number.NaN, "EUR", "Prix non renseigné")).toBe("Prix non renseigné");
    expect(formatOptionalPrice("fr", 2999, "EUR", "x")).toMatch(/^29,99\s€$/);
  });
});
