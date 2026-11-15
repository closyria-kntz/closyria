import { describe, expect, it } from "vitest";
import { MAX_PARSED_SHOP_NAME, orderShopDisplayName, parcelPatchInputSchema, parsedShopName } from "./orders";

describe("parsedShopName", () => {
  it("keeps the name the e-mail gives, trimmed and on one line", () => {
    expect(parsedShopName("  Lola   &\n Co ")).toBe("Lola & Co");
  });

  it("drops a blank name", () => {
    expect(parsedShopName("   ")).toBeNull();
    expect(parsedShopName(null)).toBeNull();
    expect(parsedShopName(undefined)).toBeNull();
  });

  it("cuts a long name to 80 characters", () => {
    expect(MAX_PARSED_SHOP_NAME).toBe(80);
    const name = parsedShopName(`${"a".repeat(79)} bcd`);
    expect(name).toBe("a".repeat(79));
    expect(parsedShopName("x".repeat(200))?.length).toBe(80);
  });
});

describe("orderShopDisplayName", () => {
  it("shows the name read in the e-mail while the shop is still pending (named after its domain)", () => {
    expect(orderShopDisplayName({ name: "lolaandco.com", status: "pending" }, "Lola & Co")).toBe("Lola & Co");
  });

  it("keeps the catalogue's name once the admin has looked at the shop", () => {
    for (const status of ["draft", "published", "refused"]) {
      expect(orderShopDisplayName({ name: "Lola & Co Paris", status }, "Lola & Co")).toBe("Lola & Co Paris");
    }
  });

  it("falls back on the shop's name, then on the order's own name", () => {
    expect(orderShopDisplayName({ name: "lolaandco.com", status: "pending" }, null)).toBe("lolaandco.com");
    expect(orderShopDisplayName(null, "Ma boutique")).toBe("Ma boutique");
    expect(orderShopDisplayName(undefined, null)).toBeNull();
  });
});

describe("parcelPatchInputSchema", () => {
  it("accepts a new number, cleaned of spaces (and dashes), in capitals", () => {
    expect(parcelPatchInputSchema.parse({ trackingNumber: " 6a 1853-7412398 " })).toEqual({
      trackingNumber: "6A18537412398",
    });
  });

  it("accepts a carrier alone, or both", () => {
    expect(parcelPatchInputSchema.parse({ carrier: "gls" })).toEqual({ carrier: "gls" });
    expect(parcelPatchInputSchema.parse({ trackingNumber: "12345678901", carrier: "gls" })).toEqual({
      trackingNumber: "12345678901",
      carrier: "gls",
    });
  });

  it("refuses a number too short, too long or with other characters, and an empty change", () => {
    expect(parcelPatchInputSchema.safeParse({ trackingNumber: "12345" }).success).toBe(false);
    expect(parcelPatchInputSchema.safeParse({ trackingNumber: "1".repeat(41) }).success).toBe(false);
    expect(parcelPatchInputSchema.safeParse({ trackingNumber: "ABC_123456" }).success).toBe(false);
    expect(parcelPatchInputSchema.safeParse({}).success).toBe(false);
  });
});
