import { describe, expect, it } from "vitest";
import {
  carrierSchema,
  detectCarrier,
  manualOrderInputSchema,
  nextParcelCheck,
  normalizeTrackingNumber,
  orderInboxViewSchema,
  orderPatchSchema,
  orderViewSchema,
  PARCEL_CHECK_DAYS,
  parcelCheckUntil,
  parcelStatusSchema,
  returnDeadline,
  trackingInputSchema,
} from "./orders";

// Every number below is made up: right shape (and right check digit where the format has one), never a real parcel.
describe("detectCarrier", () => {
  it("reads a domestic Colissimo number (digit, letter, 11 digits)", () => {
    expect(detectCarrier("6A18537412398")).toBe("colissimo");
    expect(detectCarrier("8R04217735096")).toBe("colissimo");
    expect(detectCarrier("9V20193847561")).toBe("colissimo");
  });

  it("reads a Lettre suivie number (1K or 1L, then 11 digits)", () => {
    expect(detectCarrier("1K36275770836")).toBe("lettre_suivie");
    expect(detectCarrier("1L01928374650")).toBe("lettre_suivie");
  });

  it("reads international La Poste numbers (UPU S10, FR, valid check digit) by their service letter", () => {
    expect(detectCarrier("CB123456785FR")).toBe("colissimo");
    expect(detectCarrier("LA482109379FR")).toBe("lettre_suivie");
    expect(detectCarrier("EE730192643FR")).toBe("chronopost");
  });

  it("refuses an S10 number with a wrong check digit, from another country, or with an unknown service letter", () => {
    expect(detectCarrier("CB123456784FR")).toBeNull();
    expect(detectCarrier("CB123456785DE")).toBeNull();
    expect(detectCarrier("RR123456785FR")).toBeNull();
  });

  it("reads Mondial Relay (8 digits), GLS (11 digits) and DPD (14 digits)", () => {
    expect(detectCarrier("48210937")).toBe("mondial_relay");
    expect(detectCarrier("50938172041")).toBe("gls");
    expect(detectCarrier("25012345678901")).toBe("dpd");
  });

  it("reads UPS (1Z + 16 characters, valid check digit)", () => {
    expect(detectCarrier("1Z999AA10123456784")).toBe("ups");
    expect(detectCarrier("1z 999 aa1 012 345 678 4")).toBe("ups");
    expect(detectCarrier("1Z4V82E16804521733")).toBe("ups");
    expect(detectCarrier("1Z999AA10123456785")).toBeNull();
  });

  it("reads DHL eCommerce (JJD + 18 digits, JVGL + 16 to 20 digits)", () => {
    expect(detectCarrier("JJD000390007327383538")).toBe("dhl");
    expect(detectCarrier("JVGL0612345678901234")).toBe("dhl");
  });

  it("ignores spaces, dashes and case", () => {
    expect(detectCarrier(" 6a 1853 7412 398 ")).toBe("colissimo");
    expect(detectCarrier("cb-123-456-785-fr")).toBe("colissimo");
    expect(normalizeTrackingNumber(" 6a-1853 7412398 ")).toBe("6A18537412398");
  });

  it("returns null for formats shared by several carriers or unknown, rather than guess", () => {
    // 10 digits: a DHL Express waybill as much as anything else; 12 digits: GLS with its check digit, Colis Privé…
    expect(detectCarrier("1234567890")).toBeNull();
    expect(detectCarrier("123456789012")).toBeNull();
    // Domestic La Poste shape with a prefix we do not know.
    expect(detectCarrier("2C12345678901")).toBeNull();
    expect(detectCarrier("")).toBeNull();
    expect(detectCarrier("   ")).toBeNull();
    expect(detectCarrier("abc")).toBeNull();
    expect(detectCarrier("6A1853741239/8")).toBeNull();
    expect(detectCarrier("x".repeat(500))).toBeNull();
  });

  it("only returns known carriers", () => {
    for (const n of ["6A18537412398", "1K36275770836", "EE730192643FR", "48210937", "1Z999AA10123456784"]) {
      expect(carrierSchema.options).toContain(detectCarrier(n));
    }
  });
});

describe("returnDeadline", () => {
  it("counts calendar days from the Paris day of the delivery", () => {
    expect(returnDeadline(new Date("2026-11-02T10:00:00Z"), 14)).toBe("2026-11-16");
  });

  it("uses the Paris day, not the UTC one, for a delivery just after midnight in Paris", () => {
    // 00:30 in Paris on 3 November is still 2 November in UTC.
    expect(returnDeadline(new Date("2026-11-02T23:30:00Z"), 14)).toBe("2026-11-17");
  });

  it("keeps whole days across the end of summer time (25 October 2026)", () => {
    // 00:30 summer time on 12 October; 14 × 24 h later is 23:30 winter time on the 25th, one day short.
    expect(returnDeadline(new Date("2026-10-11T22:30:00Z"), 14)).toBe("2026-10-26");
  });

  it("keeps whole days across the start of summer time (29 March 2026)", () => {
    expect(returnDeadline(new Date("2026-03-28T23:30:00Z"), 1)).toBe("2026-03-30");
    expect(returnDeadline(new Date("2026-03-20T12:00:00Z"), 14)).toBe("2026-04-03");
  });

  it("crosses months and years, and accepts 0 days (same day)", () => {
    expect(returnDeadline(new Date("2026-12-25T09:00:00Z"), 14)).toBe("2027-01-08");
    expect(returnDeadline(new Date("2026-11-02T10:00:00Z"), 0)).toBe("2026-11-02");
  });

  it("refuses a negative or fractional delay", () => {
    expect(() => returnDeadline(new Date(), -1)).toThrow();
    expect(() => returnDeadline(new Date(), 1.5)).toThrow();
  });
});

describe("nextParcelCheck", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  const hoursLater = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 3_600_000 : null);

  it("checks every 2 hours while out for delivery or waiting at a pickup point", () => {
    expect(hoursLater(nextParcelCheck("out_for_delivery", now))).toBe(2);
    expect(hoursLater(nextParcelCheck("pickup_ready", now))).toBe(2);
  });

  it("checks every 6 hours otherwise", () => {
    for (const status of ["pending", "in_transit", "exception", "unknown"] as const) {
      expect(hoursLater(nextParcelCheck(status, now))).toBe(6);
    }
  });

  it("stops once delivered", () => {
    expect(nextParcelCheck("delivered", now)).toBeNull();
  });

  it("covers every status", () => {
    for (const status of parcelStatusSchema.options) expect(() => nextParcelCheck(status, now)).not.toThrow();
  });

  it("stops after 30 days", () => {
    expect(PARCEL_CHECK_DAYS).toBe(30);
    expect(parcelCheckUntil(now).toISOString()).toBe("2026-12-14T10:00:00.000Z");
  });
});

describe("order schemas", () => {
  const id = "0b7e7f8e-9a43-4c7b-9a66-1f1d6c7a2b10";

  it("accepts a manual order and trims its fields", () => {
    const input = manualOrderInputSchema.parse({
      profileId: id,
      shopName: "  Maison Lumière ",
      lines: [{ name: " Robe Léa ", sizeLabel: "38", quantity: 1, priceCents: 8900, currency: "EUR" }],
      trackingNumber: "6A18537412398",
    });
    expect(input.shopName).toBe("Maison Lumière");
    expect(input.lines[0]?.name).toBe("Robe Léa");
  });

  it("refuses an order without lines, or with a zero quantity or a negative price", () => {
    expect(manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines: [] }).success).toBe(false);
    const line = { name: "Robe", quantity: 0 };
    expect(manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines: [line] }).success).toBe(false);
    const priced = { name: "Robe", quantity: 1, priceCents: -1, currency: "EUR" };
    expect(manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines: [priced] }).success).toBe(false);
  });

  it("asks for a currency with a price", () => {
    const line = { name: "Robe", quantity: 1, priceCents: 100 };
    expect(manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines: [line] }).success).toBe(false);
  });

  it("accepts a pasted tracking number, the carrier optional", () => {
    expect(trackingInputSchema.parse({ trackingNumber: " 6a1853741 2398 " })).toEqual({
      trackingNumber: "6A18537412398",
    });
    expect(trackingInputSchema.parse({ trackingNumber: "48210937", carrier: "mondial_relay" }).carrier).toBe(
      "mondial_relay",
    );
    expect(trackingInputSchema.safeParse({ trackingNumber: "ab" }).success).toBe(false);
    expect(trackingInputSchema.safeParse({ trackingNumber: "6A18537412398", carrier: "fedex" }).success).toBe(false);
  });

  it("patches only what is given", () => {
    expect(orderPatchSchema.parse({})).toEqual({});
    expect(orderPatchSchema.parse({ externalRef: null }).externalRef).toBeNull();
  });

  it("describes an order with its lines and parcels", () => {
    const view = orderViewSchema.parse({
      id,
      profileId: id,
      shop: { id, name: "Maison Lumière", returnsUrl: null },
      externalRef: "#1042",
      orderedAt: "2026-11-02T10:00:00.000Z",
      status: "draft",
      source: "email",
      parseMethod: "known",
      lines: [
        {
          id,
          itemId: null,
          productId: null,
          name: "Robe Léa",
          sizeLabel: "38",
          color: "Écru",
          quantity: 1,
          priceCents: 8900,
          currency: "EUR",
        },
      ],
      parcels: [
        {
          id,
          carrier: "colissimo",
          trackingNumber: "6A18537412398",
          status: "in_transit",
          lastEventAt: "2026-11-03T08:00:00.000Z",
          lastEventLabel: "Pris en charge",
          estimatedAt: null,
          deliveredAt: null,
        },
      ],
      createdAt: "2026-11-02T10:05:00.000Z",
    });
    expect(view.parcels[0]?.carrier).toBe("colissimo");
  });

  it("describes her order address", () => {
    expect(orderInboxViewSchema.parse({ address: "marie-k7f2@commandes.closyria.com" }).address).toContain("@");
    expect(orderInboxViewSchema.parse({ address: null }).address).toBeNull();
  });
});
