import { MAX_PRODUCT_IMAGES } from "@closyria/shared";

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

/** Strips tags (script/style with their content), decodes entities, normalizes whitespace, caps length. */
export function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  // Decode exactly once, then strip: escaped markup ("&lt;p&gt;") is removed as well.
  const decoded = decodeEntities(value);
  const withoutBlocks = decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const text = withoutBlocks
    .replace(/<[^>]*>/g, " ")
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
  if (/^\s*-/.test(value)) return null;
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
  const plain = value.trim();
  if (/^\d+(\.\d+)?$/.test(plain)) return Math.round(Number(plain) * 100);
  return parsePriceCents(plain);
}
