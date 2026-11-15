import { describe, expect, it } from "vitest";
import { parseHeaderDate } from "./dates";
import { type DecodedEmail, decodeEmail } from "./decode";
import { originalHeader } from "./forwarded";
import { readShopify } from "./shopify";
import { readStructured } from "./structured";

const email = (text: string, html: string | null = null): DecodedEmail => ({
  subject: "",
  from: null,
  date: null,
  text,
  html,
  signers: [],
});
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("parseHeaderDate", () => {
  it("reads the forms mail programs write", () => {
    expect(parseHeaderDate("Mon, 9 Nov 2026 14:32:00 +0100")?.toISOString()).toBe("2026-11-09T13:32:00.000Z");
    expect(parseHeaderDate("Mon, 9 Nov 2026 at 14:32 GMT")?.toISOString()).toBe("2026-11-09T14:32:00.000Z");
    // Summer time: Paris is UTC+2.
    expect(parseHeaderDate("ven. 3 juil. 2026 à 09:05")?.toISOString()).toBe("2026-07-03T07:05:00.000Z");
    expect(parseHeaderDate("samedi 7 novembre 2026 16h20")?.toISOString()).toBe("2026-11-07T15:20:00.000Z");
    expect(parseHeaderDate("1 août 2026")?.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(parseHeaderDate("Thu, Dec 31, 2026 at 12:05 AM")?.toISOString()).toBe("2026-12-30T23:05:00.000Z");
    expect(parseHeaderDate("Thu, Dec 31, 2026 at 12:05 PM")?.toISOString()).toBe("2026-12-31T11:05:00.000Z");
    expect(parseHeaderDate("February 2, 2026")?.toISOString()).toBe("2026-02-01T23:00:00.000Z");
  });

  it("gives null for what is no date", () => {
    for (const v of [
      "",
      "hier",
      "32 nov. 2026",
      "9 brumaire 2026",
      "Smarch 9, 2026",
      "9 nov. 1999",
      "+0100 12:00 nope",
    ]) {
      expect(parseHeaderDate(v), v).toBeNull();
    }
  });
});

describe("originalHeader", () => {
  it("reads Apple Mail's forward, a quoted name and a header without date nor subject", () => {
    const h = originalHeader(
      email(
        'Regarde !\nDébut du message réexpédié :\nDe: "Oya" <Bonjour@Oya.example>\nObjet: \nÀ: moi@exemple.test\nTexte',
      ),
    );
    expect(h).toEqual({ fromName: "Oya", fromAddress: "bonjour@oya.example", date: null, subject: null });
    expect(originalHeader(email("Begin forwarded message:\nFrom: Oya\nDate: hier"))).toEqual({
      fromName: "Oya",
      fromAddress: null,
      date: null,
      subject: null,
    });
  });

  it("falls back to the e-mail's own header when it is no forward", () => {
    const own: DecodedEmail = { ...email("Bonjour"), subject: "", from: { name: "", address: "a@b.example" } };
    expect(originalHeader(own)).toEqual({ fromName: null, fromAddress: "a@b.example", date: null, subject: null });
    expect(originalHeader(email("Bonjour"))).toEqual({ fromName: null, fromAddress: null, date: null, subject: null });
  });
});

describe("readShopify", () => {
  const header = { fromName: "Oya", fromAddress: null, date: new Date("2026-11-09T10:00:00Z"), subject: null };

  it("is only for Shopify e-mails", () => {
    expect(readShopify(email("Robe × 1"), header)).toBeNull();
  });

  it("reads the order number from the text, an article with no variant before the totals, a price without decimals", () => {
    const draft = readShopify(
      email("shopifyemail.com\nMerci pour votre achat !\nOrder #55\nCeinture × 1\n15 €\nSous-total\nGilet x 2\nTotal"),
      header,
    );
    expect(draft).toMatchObject({
      externalRef: "55",
      orderedAt: header.date,
      lines: [
        { name: "Ceinture", quantity: 1, priceCents: 1500, currency: "EUR", sizeLabel: null },
        { name: "Gilet", quantity: 2, priceCents: null },
      ],
    });
  });

  it("reads several parts of a variant: a size and two other options give no colour", () => {
    const draft = readShopify(email("cdn.shopify.com\nJupe × 1\nNoir / 36 / Coton\n50,00 CHF"), header);
    expect(draft?.lines?.[0]).toMatchObject({ sizeLabel: "36", color: null, priceCents: 5000, currency: "CHF" });
    expect(draft?.externalRef).toBeNull();
  });
});

describe("readStructured", () => {
  it("is null without structured data, or without an order or a delivery in it", () => {
    expect(readStructured(null)).toBeNull();
    expect(readStructured("<p>x</p>")).toBeNull();
    expect(readStructured(ld({ "@type": "Product", name: "x" }))).toBeNull();
  });

  it("reads a delivery alone, its order and shipped items, with numbers written as numbers", () => {
    const draft = readStructured(
      ld({
        "@type": "ParcelDelivery",
        trackingNumber: "CB123456785FR",
        carrier: "Colissimo",
        itemShipped: [{ "@type": "Product", name: "Châle", offers: { lowPrice: 40, priceCurrency: "EUR" } }, "x"],
        partOfOrder: { "@type": "Order", orderNumber: 4412, seller: { name: "Oya", sameAs: ["https://oya.example"] } },
      }),
    );
    expect(draft).toMatchObject({
      shopName: "Oya",
      shopHost: "oya.example",
      externalRef: "4412",
      lines: [{ name: "Châle", priceCents: 4000, currency: "EUR", quantity: 1 }],
      trackingNumbers: [{ number: "CB123456785FR", carrierHint: "colissimo" }],
    });
  });

  it("keeps an unreadable merchant site, quantity or price as null", () => {
    const draft = readStructured(
      ld({
        "@type": "Order",
        merchant: { name: "Oya", url: "pas une adresse" },
        orderedItem: [{ "@type": "Product", name: "Bague" }],
        acceptedOffer: [{ itemOffered: { name: "Bracelet" }, eligibleQuantity: "beaucoup" }, { itemOffered: "x" }],
        orderDelivery: [{ "@type": "ParcelDelivery" }],
      }),
    );
    expect(draft).toMatchObject({
      shopHost: null,
      lines: [
        { name: "Bracelet", quantity: null, priceCents: null },
        { name: "Bague", quantity: 1 },
      ],
      trackingNumbers: [],
    });
  });
});

describe("decodeEmail", () => {
  it("copes with a message without subject, sender nor date", async () => {
    expect(await decodeEmail("Content-Type: text/plain\n\nBonjour")).toEqual({
      subject: "",
      from: null,
      date: null,
      text: "Bonjour",
      html: null,
      signers: [],
    });
  });
});
