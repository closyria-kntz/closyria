import { MAX_PRODUCT_IMAGES, type ShopData } from "@closyria/shared";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1]?.toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const NEGATIVE = /^\D*[-\u2212]/;

const stripMarkup = (value: string): string =>
  value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ").replace(/<\/?[a-zA-Z!][^<>]*>/g, " ");

/** Strips tags (script/style with their content), decodes entities, normalizes whitespace, caps length. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Strip tag-like markup, decode exactly once, then strip again (escaped markup such as "&lt;p&gt;").
  // Only "<" followed by a letter, "/" or "!" is a tag, so "&lt;40 cm" survives.
  const text = stripMarkup(decodeEntities(stripMarkup(value)))
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? undefined : text.slice(0, max);
}

/** Absolute http(s) URLs, without duplicates, at most MAX_PRODUCT_IMAGES. */
export function cleanImages(values: unknown[], baseUrl: string): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const raw = value.trim().startsWith("//") ? `https:${value.trim()}` : value.trim();
    let url: URL;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!out.includes(url.href)) out.push(url.href);
    if (out.length >= MAX_PRODUCT_IMAGES) break;
  }
  return out;
}

/** Parses "1.299,00 €", "29.99", 29.99 into cents. Null when no valid amount. */
export function parsePriceCents(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  if (NEGATIVE.test(value)) return null;
  const match = value.replace(/\s/g, "").match(/\d[\d.,]*/);
  if (!match) return null;
  const digits = match[0].replace(/[.,]+$/, "");
  const sep = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
  let normalized = digits;
  if (sep !== -1) {
    const tail = digits.slice(sep + 1);
    const sameSepOnce = digits.split(digits[sep] as string).length === 2;
    const mixed = /\./.test(digits) && /,/.test(digits);
    // "1.299" or "1,299" alone is a thousands group; otherwise the last separator is the decimal mark.
    const isDecimal = mixed || (sameSepOnce && tail.length !== 3);
    normalized = isDecimal ? `${digits.slice(0, sep).replace(/[.,]/g, "")}.${tail}` : digits.replace(/[.,]/g, "");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

/**
 * Machine-formatted amount (JSON-LD, product:price:amount): dot is the decimal mark, no locale heuristic.
 * Falls back to the locale-aware parser for text such as "89,90". Negative amounts give null.
 */
export function parseMachinePriceCents(value: string | number): number | null {
  if (typeof value === "number") return parsePriceCents(value);
  if (NEGATIVE.test(value)) return null;
  const single = value.match(/^\s*[^\d\s\-\u2212]*\s*(\d+(?:\.\d+)?)\s*[^\d\s]*\s*$/);
  if (single?.[1]) return Math.round(Number(single[1]) * 100);
  return parsePriceCents(value);
}

/** Digits only after removing spaces and hyphens; length 8, 12, 13 or 14, else undefined. */
export function cleanGtin(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const digits = String(value).replace(/[\s-]/g, "");
  return /^(\d{8}|\d{12,14})$/.test(digits) ? digits : undefined;
}

/** Any parseable date as a UTC ISO datetime; undefined otherwise. */
export function cleanDate(value: unknown): string | undefined {
  // Only ISO-like input: V8 would read "1" as a date in 2001.
  if (typeof value !== "string" || !/^\d{4}-\d{2}/.test(value.trim())) return undefined;
  const time = new Date(value.trim()).getTime();
  if (Number.isNaN(time)) return undefined;
  const iso = new Date(time).toISOString();
  const year = Number(iso.slice(0, 4));
  return /^\d{4}-/.test(iso) && year >= 1990 && year <= new Date().getUTCFullYear() + 1 ? iso : undefined;
}

/** Cleaned, non-empty, distinct strings (each ≤ 200), at most 20. */
export function cleanList(values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = cleanText(value, 200);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= 20) break;
  }
  return out;
}

/** Drops empty fields; undefined when nothing is left. */
export function buildShopData(data: ShopData): ShopData | undefined {
  const entries = Object.entries(data).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== undefined));
  return entries.length > 0 ? (Object.fromEntries(entries) as ShopData) : undefined;
}
