import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeEmail, parseOrderEmail, shopHostOf } from "./index";

/**
 * Invented e-mails in the shapes shops really send (Shopify's default notifications in French and English, forwarded
 * from Gmail; schema.org markup received through Gmail's automatic forward; a hand-made e-mail forwarded from
 * Outlook). Names, addresses and numbers are made up.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.eml`, import.meta.url));
const now = new Date("2026-11-14T10:00:00Z");
const own = "camille.martin@exemple.test";
const read = async (name: string) => parseOrderEmail(await decodeEmail(fixture(name)), { now, ownAddress: own });

describe("parseOrderEmail — Shopify", () => {
  it("reads a French order confirmation", async () => {
    expect(await read("shopify-fr-confirmation")).toEqual({
      shopName: "Maison Lune",
      shopHost: "maison-lune.example",
      externalRef: "1042",
      // « lun. 9 nov. 2026 à 14:32 », Paris time.
      orderedAt: "2026-11-09T13:32:00.000Z",
      lines: [
        { name: "Robe Lina", sizeLabel: "M", color: "Écru", quantity: 1, priceCents: 8900, currency: "EUR" },
        // 120,00 € for two (140,00 € struck through): 60,00 € each.
        { name: "Pull Côme", sizeLabel: "S", color: null, quantity: 2, priceCents: 6000, currency: "EUR" },
      ],
      trackings: [],
    });
  });

  it("reads a French shipping update: the tracking number and its carrier, no order date", async () => {
    expect(await read("shopify-fr-shipping")).toEqual({
      shopName: "Maison Lune",
      shopHost: "maison-lune.example",
      externalRef: "1042",
      orderedAt: null,
      lines: [
        { name: "Robe Lina", sizeLabel: "M", color: "Écru", quantity: 1, priceCents: null, currency: null },
        { name: "Pull Côme", sizeLabel: "S", color: null, quantity: 2, priceCents: null, currency: null },
      ],
      trackings: [{ trackingNumber: "6A12345678901", carrier: "colissimo" }],
    });
  });

  it("reads an English order confirmation", async () => {
    expect(await read("shopify-en-confirmation")).toEqual({
      shopName: "North & Fern",
      shopHost: "northandfern.example",
      externalRef: "NF-20931",
      // « Tue, Nov 10, 2026 at 6:15 PM », Paris time.
      orderedAt: "2026-11-10T17:15:00.000Z",
      lines: [
        { name: "Linen Shirt Ines", sizeLabel: "38", color: "Sage", quantity: 1, priceCents: 7200, currency: "EUR" },
        { name: "Canvas Tote", sizeLabel: null, color: null, quantity: 1, priceCents: 7000, currency: "EUR" },
      ],
      trackings: [],
    });
  });

  it("reads an English shipping update", async () => {
    expect(await read("shopify-en-shipping")).toEqual({
      shopName: "North & Fern",
      shopHost: "northandfern.example",
      externalRef: "NF-20931",
      orderedAt: null,
      lines: [
        { name: "Linen Shirt Ines", sizeLabel: "38", color: "Sage", quantity: 1, priceCents: null, currency: null },
      ],
      trackings: [{ trackingNumber: "1Z999AA10123456784", carrier: "ups" }],
    });
  });
});

describe("parseOrderEmail — structured data", () => {
  it("reads schema.org Order and ParcelDelivery", async () => {
    expect(await read("structured-order-parcel")).toEqual({
      shopName: "Atelier Pivoine",
      shopHost: "atelier-pivoine.example",
      externalRef: "AP-558812",
      orderedAt: "2026-11-08T20:47:00.000Z",
      lines: [
        { name: "Pantalon Arlo", sizeLabel: "38", color: "Sauge", quantity: 2, priceCents: 7900, currency: "EUR" },
      ],
      trackings: [{ trackingNumber: "EE123456785FR", carrier: "chronopost" }],
    });
  });
});

describe("parseOrderEmail — unknown format", () => {
  it("gives null: the AI's case", async () => {
    expect(await read("unknown-handmade")).toBeNull();
  });

  it("still finds the shop's site from the original sender", async () => {
    expect(shopHostOf(await decodeEmail(fixture("unknown-handmade")))).toBe("petites-mailles.example");
  });
});

const mime = (html: string | null, text = "", subject = "Fwd: test", extra = "") =>
  [
    "From: Camille <camille@exemple.test>",
    "To: camille-k7f2@commandes.dev.closyria.com",
    `Subject: ${subject}`,
    "Date: Mon, 09 Nov 2026 15:01:12 +0100",
    "MIME-Version: 1.0",
    extra,
    html === null
      ? `Content-Type: text/plain; charset=utf-8\n\n${text}`
      : `Content-Type: multipart/mixed; boundary="b"\n\n--b\nContent-Type: text/html; charset=utf-8\n\n${html}\n--b\nContent-Type: application/pdf; name="facture.pdf"\nContent-Disposition: attachment; filename="facture.pdf"\nContent-Transfer-Encoding: base64\n\nJVBERi0xLjQK\n--b--`,
  ]
    .filter((l) => l !== "")
    .join("\n");

describe("decodeEmail", () => {
  it("turns the HTML into lines of text, ignores attachments and keeps the subject", async () => {
    const email = await decodeEmail(
      mime(
        "<style>p{}</style><p>Un&nbsp;<b>deux</b> &amp; trois &#233;t&eacute; &#x263A;</p><table><tr><td>A</td><td>B</td></tr></table><!-- x --><script>alert(1)</script>",
      ),
    );
    expect(email.subject).toBe("Fwd: test");
    expect(email.text.split("\n")).toEqual(["Un deux & trois été ☺", "A", "B"]);
    expect(email.text).not.toContain("JVBER");
    expect(email.from).toEqual({ name: "Camille", address: "camille@exemple.test" });
  });

  it("uses the text part when there is no HTML", async () => {
    const email = await decodeEmail(mime(null, "Bonjour\r\n\r\n  Commande  #12 \r\n"));
    expect(email.html).toBeNull();
    expect(email.text).toBe("Bonjour\nCommande #12");
  });
});

describe("parseOrderEmail — edges", () => {
  const shopifyText = (body: string, subject = "Fwd: Commande #77 confirmée") =>
    mime(null, `https://cdn.shopify.com/x.jpg\n${body}`, subject);

  it("reads a Shopify e-mail in plain text, with the order number from the subject", async () => {
    const email = await decodeEmail(shopifyText("Bob Rayé × 3\nTaille unique\n$30.00\nSubtotal $30.00"));
    expect(parseOrderEmail(email, { now })).toMatchObject({
      externalRef: "77",
      lines: [{ name: "Bob Rayé", sizeLabel: "Taille unique", quantity: 3, priceCents: 1000, currency: "USD" }],
    });
  });

  it("reads a tracking number written on the next line, a pound price, and an unknown carrier", async () => {
    const email = await decodeEmail(
      shopifyText("Tracking number:\nAB12345678\nScarf × 1\n£12.50", "Fwd: A shipment from order #A-9 is on the way"),
    );
    expect(parseOrderEmail(email, { now })).toMatchObject({
      externalRef: "A-9",
      lines: [{ name: "Scarf", priceCents: 1250, currency: "GBP" }],
      trackings: [{ trackingNumber: "AB12345678", carrier: null }],
    });
  });

  it("gives null for a Shopify e-mail with nothing of an order, and for a newsletter", async () => {
    expect(
      parseOrderEmail(await decodeEmail(shopifyText("Nos nouveautés", "Fwd: Nos nouveautés")), { now }),
    ).toBeNull();
    expect(parseOrderEmail(await decodeEmail(mime("<p>Les soldes commencent !</p>")), { now })).toBeNull();
  });

  it("reads an Order in a @graph, its items as OrderItem, without merchant site nor date", async () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Order","seller":{"name":"Bleu Cobalt"},"orderNumber":"#B-1","orderedItem":[{"@type":"OrderItem","orderQuantity":1,"orderedItem":{"@type":"Product","name":"Veste Iris","offers":{"price":"120","priceCurrency":"EUR"}}}],"orderDelivery":{"@type":"ParcelDelivery","provider":{"name":"Mondial Relay"},"trackingNumber":"12345678"}}]}</script><script type="application/ld+json">{broken</script>`;
    expect(parseOrderEmail(await decodeEmail(mime(html)), { now, ownAddress: "Camille@exemple.test" })).toEqual({
      shopName: "Bleu Cobalt",
      shopHost: null,
      externalRef: "B-1",
      orderedAt: null,
      lines: [{ name: "Veste Iris", sizeLabel: null, color: null, quantity: 1, priceCents: 12000, currency: "EUR" }],
      trackings: [{ trackingNumber: "12345678", carrier: "mondial_relay" }],
    });
  });
});

describe("shopHostOf", () => {
  it("skips mail, carrier and Shopify hosts, and falls back to the sender's domain", async () => {
    const links =
      '<a href="https://www.laposte.fr/x">a</a><a href="mailto:a@b.example">m</a><a href="https://cdn.shopify.com/y">c</a><a href="https://www.instagram.com/z">i</a><a href="http://www.boutique-oya.example/c">o</a>';
    expect(shopHostOf(await decodeEmail(mime(links)))).toBe("boutique-oya.example");
    // Not forwarded: the outer sender is the shop (an automatic forward keeps it), unless it is a mailbox.
    expect(shopHostOf(await decodeEmail(mime("<p>rien</p>")))).toBe("exemple.test");
    expect(shopHostOf(await decodeEmail(mime("<p>rien</p>")), "camille@exemple.test")).toBeNull();
    expect(
      shopHostOf({ subject: "", from: { name: "", address: "x@gmail.com" }, date: null, text: "", html: null }),
    ).toBeNull();
  });
});
