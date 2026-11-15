import { describe, expect, it } from "vitest";
import {
  carrierFromName,
  carrierSchema,
  cleanParsedOrder,
  detectCarrier,
  inboundEmailPurge,
  isOrderInboxCode,
  MAX_ORDER_LINE_NAME,
  MAX_ORDER_LINES,
  MAX_PARSED_TRACKING_NUMBERS,
  manualOrderInputSchema,
  nextParcelCheck,
  nextParcelCheckClamped,
  normalizeTrackingNumber,
  ORDER_INBOX_CODE_ALPHABET,
  orderEmailParseJobSchema,
  orderInboxDomain,
  orderInboxLocalPart,
  orderInboxSlug,
  orderInboxViewSchema,
  orderLineInputSchema,
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

  it("reads digits-only shapes only with a matching carrier hint (Mondial Relay 8, GLS 11 or 12, DPD 14)", () => {
    // Bare digits carry no signature: without her choice of carrier, no guess.
    expect(detectCarrier("48210937")).toBeNull();
    expect(detectCarrier("50938172041")).toBeNull();
    expect(detectCarrier("25012345678901")).toBeNull();
    expect(detectCarrier("48210937", "mondial_relay")).toBe("mondial_relay");
    expect(detectCarrier("50938172041", "gls")).toBe("gls");
    expect(detectCarrier("509381720412", "gls")).toBe("gls");
    expect(detectCarrier("25012345678901", "dpd")).toBe("dpd");
    // A hint whose shape does not fit.
    expect(detectCarrier("48210937", "dpd")).toBeNull();
    expect(detectCarrier("25012345678901", "mondial_relay")).toBeNull();
    expect(detectCarrier("48210937", "colis_prive")).toBeNull();
    expect(detectCarrier("48210937", null)).toBeNull();
  });

  it("keeps self-checking formats whatever the hint", () => {
    expect(detectCarrier("6A18537412398", "dpd")).toBe("colissimo");
    expect(detectCarrier("1Z999AA10123456784", "gls")).toBe("ups");
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
    for (const n of ["6A18537412398", "1K36275770836", "EE730192643FR", "1Z999AA10123456784"]) {
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

  it("never schedules past the end of the tracking", () => {
    const until = new Date("2026-11-14T13:00:00Z");
    expect(nextParcelCheckClamped("out_for_delivery", now, until)?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    // 6 h later would be past `until`: one last check at `until`.
    expect(nextParcelCheckClamped("in_transit", now, until)?.toISOString()).toBe(until.toISOString());
    // Already over, or delivered: no more checks.
    expect(nextParcelCheckClamped("in_transit", now, now)).toBeNull();
    expect(nextParcelCheckClamped("in_transit", now, new Date("2026-11-14T09:00:00Z"))).toBeNull();
    expect(nextParcelCheckClamped("delivered", now, until)).toBeNull();
  });

  it("stops after 30 days", () => {
    expect(PARCEL_CHECK_DAYS).toBe(30);
    expect(parcelCheckUntil(now).toISOString()).toBe("2026-12-14T10:00:00.000Z");
  });
});

describe("inboundEmailPurge", () => {
  it("deletes ignored e-mails and failed ones no order points to, clears the raw message of the others", () => {
    expect(inboundEmailPurge("ignored", false)).toBe("delete");
    expect(inboundEmailPurge("failed", false)).toBe("delete");
    expect(inboundEmailPurge("failed", true)).toBe("clear_raw");
    expect(inboundEmailPurge("parsed", false)).toBe("clear_raw");
    expect(inboundEmailPurge("parsed", true)).toBe("clear_raw");
    // Still waiting for its reading: the raw message goes, the row tells the admin it was never read.
    expect(inboundEmailPurge("queued", false)).toBe("clear_raw");
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

  it("asks for a tracking number with a carrier", () => {
    const lines = [{ name: "Robe", quantity: 1 }];
    expect(manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines, carrier: "dpd" }).success).toBe(
      false,
    );
    const both = { profileId: id, shopName: "S", lines, carrier: "dpd", trackingNumber: "25012345678901" };
    expect(manualOrderInputSchema.safeParse(both).success).toBe(true);
  });

  it("keeps the order date between 2000 and tomorrow", () => {
    const lines = [{ name: "Robe", quantity: 1 }];
    const at = (orderedAt: string) =>
      manualOrderInputSchema.safeParse({ profileId: id, shopName: "S", lines, orderedAt });
    expect(at("2026-11-02T10:00:00Z").success).toBe(true);
    expect(at("1999-12-31T23:00:00Z").success).toBe(false);
    expect(at(new Date(Date.now() + 2 * 86_400_000).toISOString()).success).toBe(false);
    expect(orderPatchSchema.safeParse({ orderedAt: "1990-01-01T00:00:00Z" }).success).toBe(false);
    expect(orderPatchSchema.parse({ orderedAt: null }).orderedAt).toBeNull();
  });

  it("reads an emptied text field as null", () => {
    expect(orderPatchSchema.parse({ externalRef: "" }).externalRef).toBeNull();
    expect(orderPatchSchema.parse({ externalRef: "   " }).externalRef).toBeNull();
    const line = orderLineInputSchema.parse({ name: "Robe", quantity: 1, sizeLabel: "", color: " " });
    expect(line).toMatchObject({ sizeLabel: null, color: null });
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
      shopName: "Maison Lumière",
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

  it("refuses a returns page that is not a web address", () => {
    const shop = (returnsUrl: string | null) =>
      orderViewSchema.shape.shop.safeParse({ id, name: "S", returnsUrl }).success;
    expect(shop("https://maison-lumiere.test/retours")).toBe(true);
    expect(shop(null)).toBe(true);
    expect(shop("javascript:alert(1)")).toBe(false);
    expect(shop("retours")).toBe(false);
  });

  it("describes her order address", () => {
    const view = { address: "marie-k7f2@commandes.closyria.com", pendingGmailCode: "185412963" };
    expect(orderInboxViewSchema.parse(view)).toEqual(view);
    expect(orderInboxViewSchema.parse({ address: null, pendingGmailCode: null }).address).toBeNull();
    expect(orderInboxViewSchema.safeParse({ ...view, pendingGmailCode: "12ab" }).success).toBe(false);
  });
});

describe("order addresses", () => {
  it("uses an alphabet without look-alike characters", () => {
    for (const c of "ilo01") expect(ORDER_INBOX_CODE_ALPHABET).not.toContain(c);
    expect(new Set(ORDER_INBOX_CODE_ALPHABET).size).toBe(ORDER_INBOX_CODE_ALPHABET.length);
    expect(isOrderInboxCode("k7f2")).toBe(true);
    for (const bad of ["k7f", "k7f22", "K7F2", "l0o1", "k7-2"]) expect(isOrderInboxCode(bad), bad).toBe(false);
  });

  it("slugs her first name, « commande » when there is none", () => {
    expect(orderInboxSlug("Marie Dupont")).toBe("marie");
    expect(orderInboxSlug("Hélène")).toBe("helene");
    expect(orderInboxSlug("Marie-Claire")).toBe("marie-claire");
    expect(orderInboxSlug("Chloé ")).toBe("chloe");
    expect(orderInboxSlug("Œnone")).toBe("oenone");
    expect(orderInboxSlug("Zoë_2")).toBe("zoe-2");
    expect(orderInboxSlug("--Ana--")).toBe("ana");
    expect(orderInboxSlug("Maximilienne-Alexandrine")).toBe("maximilienne-alexand");
    expect(orderInboxSlug("Abcdefghijklmnopqrs-tu")).toBe("abcdefghijklmnopqrs");
    for (const none of [null, "", "  ", "李", "🙂"]) expect(orderInboxSlug(none)).toBe("commande");
  });

  it("builds `{slug}-{code}`, matching the table's check", () => {
    const check = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const name of ["Marie", "Hélène Martin", null, "Marie-Claire", "Abcdefghijklmnopqrs-tu"]) {
      const local = orderInboxLocalPart(name, "k7f2");
      expect(local, String(name)).toMatch(check);
      expect(local.endsWith("-k7f2")).toBe(true);
    }
    expect(orderInboxLocalPart("Marie", "k7f2")).toBe("marie-k7f2");
    expect(orderInboxLocalPart(null, "x9ab")).toBe("commande-x9ab");
    expect(() => orderInboxLocalPart("Marie", "l0o1")).toThrow();
  });

  it("has a domain per environment", () => {
    expect(orderInboxDomain("prod")).toBe("commandes.closyria.com");
    expect(orderInboxDomain("dev")).toBe("commandes.dev.closyria.com");
    expect(orderInboxDomain("test")).toBe("commandes.dev.closyria.com");
  });

  it("reads the parse job, nothing more", () => {
    const id = "6f1c1f0e-3c1a-4a35-9b0e-2b8f6f1d7a10";
    expect(orderEmailParseJobSchema.parse({ inboundEmailId: id })).toEqual({ inboundEmailId: id });
    expect(orderEmailParseJobSchema.safeParse({ inboundEmailId: "x" }).success).toBe(false);
    expect(orderEmailParseJobSchema.safeParse({ inboundEmailId: id, raw: "…" }).success).toBe(false);
  });
});

describe("cleanParsedOrder", () => {
  const now = new Date("2026-11-14T10:00:00Z");

  it("keeps only what is usable, never filling a field in", () => {
    expect(
      cleanParsedOrder(
        {
          shopName: "  Maison   Lune ",
          shopHost: "WWW.Maison-Lune.example.",
          externalRef: "#1042",
          orderedAt: "2026-11-09T13:32:00Z",
          lines: [
            { name: " Robe  Lina ", sizeLabel: " M ", color: "", quantity: 0, priceCents: 8900, currency: "EUR" },
            { name: "Pull", quantity: 2, priceCents: 6000, currency: null },
            { name: "   " },
          ],
          trackingNumbers: [
            { number: "6a 1234-5678 901" },
            { number: "6A12345678901" },
            { number: "12345678", carrierHint: "mondial_relay" },
            { number: "abc" },
          ],
        },
        now,
      ),
    ).toEqual({
      shopName: "Maison Lune",
      shopHost: "maison-lune.example",
      externalRef: "1042",
      orderedAt: "2026-11-09T13:32:00.000Z",
      lines: [
        { name: "Robe Lina", sizeLabel: "M", color: null, quantity: 1, priceCents: 8900, currency: "EUR" },
        // A price without its currency is dropped.
        { name: "Pull", sizeLabel: null, color: null, quantity: 2, priceCents: null, currency: null },
      ],
      trackings: [
        { trackingNumber: "6A12345678901", carrier: "colissimo" },
        { trackingNumber: "12345678", carrier: "mondial_relay" },
      ],
    });
  });

  it("drops a bad host, reference or date, and gives null when nothing is left", () => {
    expect(
      cleanParsedOrder(
        {
          shopHost: "localhost",
          externalRef: "commande 12",
          orderedAt: "2031-01-01T00:00:00Z",
          lines: [{ name: "A" }],
        },
        now,
      ),
    ).toMatchObject({ shopHost: null, externalRef: null, orderedAt: null });
    expect(
      cleanParsedOrder({ orderedAt: new Date("1999-12-31T00:00:00Z"), lines: [{ name: "A" }] }, now)?.orderedAt,
    ).toBeNull();
    expect(cleanParsedOrder({ shopName: "Oya", orderedAt: "pas une date" }, now)).toBeNull();
    expect(cleanParsedOrder({ externalRef: "N°55" }, now)?.externalRef).toBe("55");
  });

  it("keeps at most 30 articles and 10 tracking numbers, cuts long texts", () => {
    const parsed = cleanParsedOrder(
      {
        lines: Array.from({ length: 40 }, (_, i) => ({ name: `${"x".repeat(250)}${i}` })),
        trackingNumbers: Array.from({ length: 12 }, (_, i) => ({ number: `AB${String(i).padStart(8, "0")}` })),
      },
      now,
    );
    expect(parsed?.lines).toHaveLength(MAX_ORDER_LINES);
    expect(parsed?.lines[0]?.name).toHaveLength(MAX_ORDER_LINE_NAME);
    expect(parsed?.trackings).toHaveLength(MAX_PARSED_TRACKING_NUMBERS);
  });
});

describe("carrierFromName", () => {
  it("finds the carrier a text names", () => {
    expect(carrierFromName("Numéro de suivi Colissimo :")).toBe("colissimo");
    expect(carrierFromName("Chronopost (La Poste)")).toBe("chronopost");
    expect(carrierFromName("Mondial Relay")).toBe("mondial_relay");
    expect(carrierFromName("Colis Privé")).toBe("colis_prive");
    expect(carrierFromName("UPS tracking number")).toBe("ups");
    expect(carrierFromName("Lettre suivie")).toBe("lettre_suivie");
    expect(carrierFromName("groups")).toBeNull();
    expect(carrierFromName(null)).toBeNull();
  });
});
