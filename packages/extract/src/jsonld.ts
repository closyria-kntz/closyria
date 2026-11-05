import {
  buildShopData,
  cleanDate,
  cleanGtin,
  cleanImages,
  cleanList,
  cleanText,
  parseMachinePriceCents,
} from "./clean";
import type { Candidate } from "./types";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function hasType(node: Json, type: string): boolean {
  return asArray(node["@type"]).some((t) => typeof t === "string" && t.endsWith(type));
}

function parseBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    try {
      blocks.push(JSON.parse((m[1] ?? "").trim()));
    } catch {
      // invalid block: try the next one
    }
  }
  return blocks;
}

function collectNodes(value: unknown, out: Json[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
  } else if (isObject(value)) {
    out.push(value);
    collectNodes(value["@graph"], out);
  }
}

function priceOf(offer: Json): number | null {
  for (const key of ["price", "lowPrice"]) {
    const raw = offer[key];
    if (typeof raw === "string" || typeof raw === "number") {
      const cents = parseMachinePriceCents(raw);
      if (cents !== null) return cents;
    }
  }
  const spec = asArray(offer.priceSpecification).find(isObject);
  return spec ? priceOf(spec) : null;
}

function flattenOffers(offers: unknown): Json[] {
  const out: Json[] = [];
  for (const o of asArray(offers)) {
    if (!isObject(o)) continue;
    const nested = asArray(o.offers).filter(isObject);
    if (nested.length > 0) out.push(...nested);
    out.push(o);
  }
  return out;
}

const inStock = (offer: Json) =>
  typeof offer.availability === "string" && /InStock|LimitedAvailability/i.test(offer.availability);

function sizeOf(node: Json): unknown {
  const item = isObject(node.itemOffered) ? node.itemOffered : {};
  return node.size ?? item.size;
}

function sizeLabel(raw: unknown): string | undefined {
  const value = isObject(raw) ? raw.name : raw;
  return cleanText(typeof value === "number" ? String(value) : value, 40);
}

const GTIN_KEYS = ["gtin13", "gtin8", "gtin", "gtin12", "gtin14"];

const nameOf = (raw: unknown): unknown => (isObject(raw) ? raw.name : raw);

/** Breadcrumb names in position order, without a last entry equal to the product name. */
function breadcrumbNames(lists: Json[], productName: string): string[] {
  const list = lists[0];
  if (!list) return [];
  const items = asArray(list.itemListElement)
    .filter(isObject)
    .map((item, index) => ({
      index,
      position: Number(item.position),
      name: cleanText(item.name ?? (isObject(item.item) ? item.item.name : undefined), 200),
    }))
    .sort((a, b) =>
      Number.isFinite(a.position) && Number.isFinite(b.position) ? a.position - b.position : a.index - b.index,
    );
  const names = items.map((i) => i.name).filter((n): n is string => n !== undefined);
  if (names.length > 0 && names[names.length - 1] === productName) names.pop();
  return names;
}

function productCandidate(node: Json, url: string, breadcrumbs: Json[]): Candidate | null {
  const variants = asArray(node.hasVariant).filter(isObject);
  const rootOffers = flattenOffers(node.offers);
  const offers = [...rootOffers, ...variants.flatMap((v) => flattenOffers(v.offers))];
  const prices = offers.map(priceOf).filter((p): p is number => p !== null);
  const name = cleanText(node.name, 300);
  const priceCents = prices.length > 0 ? Math.min(...prices) : null;
  if (!name || priceCents === null) return null;

  const currencyRaw = offers.map((o) => o.priceCurrency).find((c) => typeof c === "string");
  const sizes: Candidate["sizes"] = [];
  const addSize = (holder: Json, offer: Json | undefined) => {
    const label = sizeLabel(sizeOf(holder) ?? (offer ? sizeOf(offer) : undefined));
    if (!label || sizes.some((s) => s.label === label)) return;
    const price = offer ? priceOf(offer) : null;
    sizes.push({ label, available: offer ? inStock(offer) : true, ...(price !== null ? { priceCents: price } : {}) });
  };
  for (const v of variants) addSize(v, flattenOffers(v.offers)[0]);
  if (sizes.length === 0) for (const o of rootOffers) addSize(o, o);

  const brandRaw = isObject(node.brand) ? node.brand.name : node.brand;
  const images = asArray(node.image).map((i) => (isObject(i) ? (i.url ?? i.contentUrl) : i));
  const id = node.sku ?? node.productGroupID ?? node.productID;

  const gtin = GTIN_KEYS.map((k) => cleanGtin(node[k])).find((g) => g !== undefined);
  const sku = [node.sku, node.productGroupID, node.productID]
    .map((v) => cleanText(typeof v === "number" ? String(v) : v, 200))
    .find((v) => v !== undefined);
  const gtins = cleanList(variants.map((v) => GTIN_KEYS.map((k) => cleanGtin(v[k])).find((g) => g !== undefined)));

  return {
    name,
    publishedAt: cleanDate(node.releaseDate),
    gtin,
    sku,
    shopData: buildShopData({
      gtins,
      category: cleanText(nameOf(node.category), 200),
      breadcrumb: breadcrumbNames(breadcrumbs, name),
      colors: cleanList(asArray(node.color).map(nameOf)),
      material: cleanText(nameOf(node.material), 200),
    }),
    brand: cleanText(brandRaw, 120),
    description: cleanText(node.description, 5000),
    currency: typeof currencyRaw === "string" ? currencyRaw.toUpperCase() : undefined,
    priceCents,
    images: cleanImages(images, url),
    sizes,
    externalId: typeof id === "string" || typeof id === "number" ? String(id) : undefined,
  };
}

/** First Product/ProductGroup with a name and a price found in the page's JSON-LD blocks. */
export function extractJsonLd(html: string, url: string): Candidate | null {
  const nodes: Json[] = [];
  for (const block of parseBlocks(html)) collectNodes(block, nodes);
  const breadcrumbs = nodes.filter((n) => hasType(n, "BreadcrumbList"));
  for (const node of nodes) {
    if (!hasType(node, "Product") && !hasType(node, "ProductGroup")) continue;
    const candidate = productCandidate(node, url, breadcrumbs);
    if (candidate) return candidate;
  }
  return null;
}
