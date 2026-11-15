import { type Carrier, carrierFromName, type ParsedOrderDraft } from "@closyria/shared";
import { parsePriceCents } from "../clean";
import type { DecodedEmail } from "./decode";
import type { OriginalHeader } from "./forwarded";
import { htmlToText } from "./html-text";

/** A Shopify notification: its images and links come from Shopify's hosts. */
export const isShopifyEmail = (email: DecodedEmail) =>
  /\b(?:cdn\.shopify\.com|shopifycdn\.com|shopifyemail\.com|myshopify\.com)\b/i.test(
    `${email.html ?? ""}\n${email.text}`,
  );

/** « Robe Lina × 1 », « Robe Lina x 1 ». */
const ITEM = /^(.+?)\s+[×x]\s*(\d{1,3})$/u;
/** « 89,00 € », « €72.00 », « 213,90 € EUR », « $30.00 », « £12.50 », « 72.00 EUR »; « Gratuit » is no price. */
const PRICE = /^(?:([€$£])\s?(\d[\d\s.,]*)|(\d[\d\s.,]*)\s?(€|EUR|USD|GBP|CHF|\$|£))(?:\s+(?:EUR|USD|GBP|CHF))?$/u;
const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
/** Lines that end the articles. */
const STOP =
  /^(?:sous-total|subtotal|total|expédition|shipping|livraison|réductions?|discounts?|taxes|informations client|customer information)\b/i;
/** « Numéro de suivi Colissimo : 6A… », « UPS tracking number: 1Z… », the number on the same line or the next. */
const TRACKING = /(?:num[ée]ro de suivi|n° de suivi|tracking number)[^:\n]{0,40}:\s*([A-Z0-9][A-Z0-9 -]{4,48})?\s*$/i;
/** « Commande #1042 », « Order #NF-20931 », « commande #1042 est en route ». */
const ORDER_REF = /\b(?:commande|order)\s*#\s?([0-9A-Za-z][0-9A-Za-z_-]{0,40})/i;
/** Sizes as shops write them in a variant: letters, numbers, « 38 FR », « T2 », « Taille unique », « 6 ans ». */
const SIZE =
  /^(?:(?:\d?X{0,3}S|M|\d?X{0,3}L|XXS|XXXL)|\d{1,3}(?:[.,]5)?(?:\s?(?:FR|EU|UK|US|IT))?|T\d|W\d{2}(?:\s?L\d{2})?|\d{1,2}\s?(?:ans?|mois|years?|months?)|taille unique|tu|one size|os)$/i;

function price(line: string): { cents: number; currency: string } | null {
  const match = PRICE.exec(line);
  if (!match) return null;
  const symbol = match[1] ?? match[4] ?? "";
  const cents = parsePriceCents(match[2] ?? match[3] ?? "");
  const currency = SYMBOLS[symbol] ?? symbol;
  return cents === null ? null : { cents, currency };
}

/** « M / Écru » → size M, colour Écru; the parts that are no size make the colour when there is exactly one. */
function variant(line: string): { sizeLabel: string | null; color: string | null } {
  const parts = line.split(" / ").map((p) => p.trim());
  const size = parts.find((p) => SIZE.test(p)) ?? null;
  const others = parts.filter((p) => p !== size);
  return { sizeLabel: size, color: others.length === 1 ? (others[0] as string) : null };
}

type Line = NonNullable<ParsedOrderDraft["lines"]>[number];

/** A link to a product page of a shop (`…/products/<handle>`, Shopify's address of a product). */
const PRODUCT_PATH = /\/products\/[^/?#]+\/?$/;
const HREF = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi;

function productHref(raw: string): string | null {
  const href = raw.replace(/&amp;/gi, "&").trim();
  try {
    const url = new URL(href);
    return (url.protocol === "https:" || url.protocol === "http:") && PRODUCT_PATH.test(url.pathname) ? href : null;
  } catch {
    return null;
  }
}

/**
 * The product page each article links to, by article name: read row by row (Shopify puts an article's photo, title
 * and price in one table row), kept only when a row holds exactly one article and one product address. A name met
 * with two addresses keeps none. Links are only read, never followed.
 */
function productLinks(html: string | null): Map<string, string | null> {
  const links = new Map<string, string | null>();
  if (!html) return links;
  for (const row of html.split(/<tr\b/i)) {
    const urls = new Set<string>();
    for (const match of row.matchAll(HREF)) {
      const url = productHref(match[2] ?? match[3] ?? "");
      if (url) urls.add(url);
    }
    if (urls.size !== 1) continue;
    const names = htmlToText(`<tr${row}`)
      .split("\n")
      .flatMap((line) => {
        const item = ITEM.exec(line);
        return item?.[1] ? [item[1]] : [];
      });
    if (names.length !== 1) continue;
    const [name] = names as [string];
    const [url] = [...urls] as [string];
    links.set(name, links.has(name) && links.get(name) !== url ? null : url);
  }
  return links;
}

function articles(lines: string[], links: Map<string, string | null>): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    const item = ITEM.exec(lines[i] ?? "");
    if (!item) continue;
    const quantity = Number(item[2]);
    const productUrl = links.get(item[1] ?? "");
    const line: Line = {
      name: item[1] ?? null,
      quantity,
      sizeLabel: null,
      color: null,
      priceCents: null,
      currency: null,
      ...(productUrl ? { productUrl } : {}),
    };
    let j = i + 1;
    const next = lines[j] ?? "";
    if (next && !ITEM.test(next) && !price(next) && !STOP.test(next)) {
      Object.assign(line, variant(next));
      j += 1;
    }
    // A discounted line shows the old price first: the last price before the next article counts.
    for (; j < lines.length; j++) {
      const p = price(lines[j] ?? "");
      if (!p) break;
      // The price of the line (all the pieces): one piece's price is kept.
      line.priceCents = Math.round(p.cents / Math.max(1, quantity));
      line.currency = p.currency;
    }
    out.push(line);
    i = j - 1;
  }
  return out;
}

function trackingNumbers(lines: string[]): { number: string; carrierHint: Carrier | null }[] {
  const out: { number: string; carrierHint: Carrier | null }[] = [];
  lines.forEach((line, i) => {
    const match = TRACKING.exec(line);
    if (!match) return;
    const number = (match[1] ?? lines[i + 1] ?? "").trim();
    if (number) out.push({ number, carrierHint: carrierFromName(line) });
  });
  return out;
}

/**
 * Shopify's default notifications (confirmation « Commande #1042 confirmée » / « Order #1042 confirmed », shipping
 * « Une expédition de la commande #1042 est en route » / « A shipment from order #1042 is on the way »), in French
 * or English. The order date is the original e-mail's date for a confirmation (it is sent when she orders), else
 * unknown.
 */
export function readShopify(email: DecodedEmail, header: OriginalHeader): ParsedOrderDraft | null {
  if (!isShopifyEmail(email)) return null;
  const lines = email.text.split("\n");
  const subject = header.subject ?? email.subject;
  const ref = ORDER_REF.exec(subject)?.[1] ?? lines.map((l) => ORDER_REF.exec(l)?.[1]).find(Boolean) ?? null;
  const trackings = trackingNumbers(lines);
  const confirmation =
    trackings.length === 0 &&
    /confirm|merci pour votre achat|thank you for your purchase/i.test(`${subject}\n${email.text}`);
  return {
    shopName: header.fromName,
    externalRef: ref,
    orderedAt: confirmation ? header.date : null,
    lines: articles(lines, productLinks(email.html)),
    trackingNumbers: trackings,
  };
}
