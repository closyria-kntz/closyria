import { describe, expect, it } from "vitest";
import {
  MAX_PARSED_SHOP_NAME,
  nextParcelCheckWaiting,
  orderShopDisplayName,
  PARCEL_CHECK_NEW_HOURS,
  PARCEL_CHECK_NEW_MINUTES,
  parcelCheckUntil,
  parcelPatchInputSchema,
  parsedShopName,
} from "./orders";

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

describe("nextParcelCheckWaiting", () => {
  const until = parcelCheckUntil(new Date("2026-11-15T10:00:00Z"));
  const minutesLater = (now: Date, d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);

  it("asks again after 15 minutes during the first 2 hours of the tracking", () => {
    expect(PARCEL_CHECK_NEW_MINUTES).toBe(15);
    expect(PARCEL_CHECK_NEW_HOURS).toBe(2);
    const now = new Date("2026-11-15T10:20:00Z");
    expect(minutesLater(now, nextParcelCheckWaiting("pending", now, until))).toBe(15);
    const late = new Date("2026-11-15T11:59:00Z");
    expect(minutesLater(late, nextParcelCheckWaiting("pending", late, until))).toBe(15);
  });

  it("then goes back to the usual rhythm", () => {
    const now = new Date("2026-11-15T12:00:00Z");
    expect(minutesLater(now, nextParcelCheckWaiting("pending", now, until))).toBe(6 * 60);
    expect(minutesLater(now, nextParcelCheckWaiting("pickup_ready", now, until))).toBe(2 * 60);
  });

  it("never asks past the end of the tracking, nor a delivered parcel", () => {
    const now = new Date("2026-11-15T10:20:00Z");
    expect(nextParcelCheckWaiting("pending", now, new Date("2026-11-15T10:25:00Z"))?.toISOString()).toBe(
      "2026-11-15T10:25:00.000Z",
    );
    expect(nextParcelCheckWaiting("delivered", now, until)).toBeNull();
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
