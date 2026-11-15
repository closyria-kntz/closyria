import { describe, expect, it } from "vitest";
import {
  adminAiCapInputSchema,
  adminOrderEmailsSchema,
  adminShopPatchSchema,
  aiMonth,
  NANO_USD_PER_EURO_CENT,
} from "./index";

// « Après la commande » Task 8: the admin's shop return settings, the AI cap and the « E-mails de commande » page.

describe("adminShopPatchSchema (délai de retour, page retours)", () => {
  const ok = (body: unknown) => adminShopPatchSchema.safeParse(body).success;

  it("takes a whole number of days from 0 to 365", () => {
    expect(ok({ returnDays: 0 })).toBe(true);
    expect(ok({ returnDays: 30 })).toBe(true);
    expect(ok({ returnDays: 365 })).toBe(true);
    expect(ok({ returnDays: 366 })).toBe(false);
    expect(ok({ returnDays: -1 })).toBe(false);
    expect(ok({ returnDays: 14.5 })).toBe(false);
    expect(ok({ returnDays: "14" })).toBe(false);
  });

  it("takes an https returns page or null, never another scheme", () => {
    expect(adminShopPatchSchema.parse({ returnsUrl: " https://lila.fr/retours " }).returnsUrl).toBe(
      "https://lila.fr/retours",
    );
    expect(ok({ returnsUrl: null })).toBe(true);
    expect(ok({ returnsUrl: "http://lila.fr/retours" })).toBe(false);
    expect(ok({ returnsUrl: "javascript:alert(1)" })).toBe(false);
    expect(ok({ returnsUrl: "lila.fr/retours" })).toBe(false);
    expect(ok({ returnsUrl: `https://lila.fr/${"a".repeat(2048)}` })).toBe(false);
  });
});

describe("adminAiCapInputSchema (plafond IA du mois)", () => {
  it("takes euro cents from 0 to 1 000 €", () => {
    expect(adminAiCapInputSchema.safeParse({ capCents: 1000 }).success).toBe(true);
    expect(adminAiCapInputSchema.safeParse({ capCents: 0 }).success).toBe(true);
    expect(adminAiCapInputSchema.safeParse({ capCents: 100_001 }).success).toBe(false);
    expect(adminAiCapInputSchema.safeParse({ capCents: 9.5 }).success).toBe(false);
  });
});

describe("AI month and cost units", () => {
  it("counts a month in Paris (the 1st at midnight Paris starts the next)", () => {
    expect(aiMonth(new Date("2026-11-30T22:59:00Z"))).toBe("2026-11");
    expect(aiMonth(new Date("2026-11-30T23:00:00Z"))).toBe("2026-12");
  });

  it("counts a dollar for a euro", () => {
    expect(NANO_USD_PER_EURO_CENT).toBe(10_000_000);
  });
});

describe("adminOrderEmailsSchema", () => {
  it("carries counts, per-shop rates and the AI month, nothing personal", () => {
    const keys = Object.keys(adminOrderEmailsSchema.shape).sort();
    expect(keys).toEqual(["ai", "byMethod", "counts", "days", "shops"]);
    const shopKeys = Object.keys(adminOrderEmailsSchema.shape.shops.element.shape).sort();
    expect(shopKeys).toEqual(["dismissed", "failed", "name", "parsed", "readRate", "shopId"]);
  });
});
