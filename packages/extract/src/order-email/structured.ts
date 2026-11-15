import { carrierFromName, type ParsedOrderDraft } from "@closyria/shared";
import { parseMachinePriceCents } from "../clean";
import { collectNodes, hasType, parseBlocks } from "../jsonld";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);
const nameOf = (v: unknown): string | null => (isObject(v) ? str(v.name) : str(v));
const num = (v: unknown): number | null => {
  const raw = isObject(v) ? v.value : v;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

type Line = NonNullable<ParsedOrderDraft["lines"]>[number];

function line(product: unknown, offer: Json | null, quantity: unknown, fallbackCurrency: string | null): Line | null {
  if (!isObject(product)) return null;
  const offers = offer ?? asArray(product.offers).find(isObject) ?? null;
  const priceRaw = offers ? (str(offers.price) ?? str(offers.lowPrice)) : null;
  return {
    name: str(product.name),
    sizeLabel: str(product.size),
    color: str(product.color),
    quantity: num(quantity),
    priceCents: priceRaw === null ? null : parseMachinePriceCents(priceRaw),
    currency: (offers ? str(offers.priceCurrency) : null) ?? fallbackCurrency,
  };
}

/**
 * schema.org markup of an order e-mail (the one Gmail reads): `Order` (number, date, merchant or seller, accepted
 * offers or ordered items) and `ParcelDelivery` (tracking number, carrier or provider, its order). Null without one.
 */
export function readStructured(html: string | null): ParsedOrderDraft | null {
  if (!html) return null;
  const nodes: Json[] = [];
  for (const block of parseBlocks(html)) collectNodes(block, nodes);
  const orders = nodes.filter((n) => hasType(n, "Order"));
  const deliveries = nodes.filter((n) => hasType(n, "ParcelDelivery"));
  for (const order of orders) for (const d of asArray(order.orderDelivery)) if (isObject(d)) deliveries.push(d);
  if (orders.length === 0 && deliveries.length === 0) return null;

  const order = orders[0] ?? (deliveries.map((d) => d.partOfOrder).find(isObject) as Json | undefined) ?? ({} as Json);
  const merchant = order.merchant ?? order.seller;
  const currency = str(order.priceCurrency);
  const lines: Line[] = [];
  for (const offer of asArray(order.acceptedOffer).filter(isObject)) {
    const l = line(offer.itemOffered, offer, offer.eligibleQuantity, currency);
    if (l) lines.push(l);
  }
  for (const item of asArray(order.orderedItem).filter(isObject)) {
    const l = hasType(item, "OrderItem")
      ? line(item.orderedItem, null, item.orderQuantity, currency)
      : line(item, null, 1, currency);
    if (l) lines.push(l);
  }
  if (lines.length === 0) {
    for (const d of deliveries)
      for (const p of asArray(d.itemShipped)) {
        const l = line(p, null, 1, currency);
        if (l) lines.push(l);
      }
  }
  const merchantUrl = isObject(merchant) ? (str(merchant.url) ?? str(asArray(merchant.sameAs)[0])) : null;
  let shopHost: string | null = null;
  try {
    shopHost = merchantUrl ? new URL(merchantUrl).hostname : null;
  } catch {
    shopHost = null;
  }
  return {
    shopName: nameOf(merchant),
    shopHost,
    externalRef: str(order.orderNumber),
    orderedAt: str(order.orderDate),
    lines,
    trackingNumbers: deliveries.flatMap((d) => {
      const number = str(d.trackingNumber);
      return number ? [{ number, carrierHint: carrierFromName(nameOf(d.carrier) ?? nameOf(d.provider)) }] : [];
    }),
  };
}
