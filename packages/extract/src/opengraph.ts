import { cleanImages, cleanText, decodeEntities, parseMachinePriceCents } from "./clean";
import type { Candidate } from "./types";

function metaTags(html: string): [string, string][] {
  const tags: [string, string][] = [];
  for (const m of html.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = new Map<string, string>();
    for (const a of (m[1] ?? "").matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs.set((a[1] ?? "").toLowerCase(), a[2] ?? a[3] ?? "");
    }
    const key = attrs.get("property") ?? attrs.get("name");
    const content = attrs.get("content");
    if (key !== undefined && content !== undefined) tags.push([key.toLowerCase(), content]);
  }
  return tags;
}

/** Open Graph product data; null without a title and a price. */
export function extractOpenGraph(html: string, url: string): Candidate | null {
  const tags = metaTags(html);
  const first = (...keys: string[]) => tags.find(([k]) => keys.includes(k))?.[1];
  const name = cleanText(first("og:title"), 300);
  const amount = first("product:price:amount", "og:price:amount");
  const priceCents = amount === undefined ? null : parseMachinePriceCents(amount);
  if (!name || priceCents === null) return null;
  const currency = first("product:price:currency", "og:price:currency")?.trim().toUpperCase();
  return {
    name,
    description: cleanText(first("og:description"), 5000),
    currency: currency || undefined,
    priceCents,
    images: cleanImages(
      tags.filter(([k]) => k === "og:image" || k === "og:image:url").map(([, v]) => decodeEntities(v)),
      url,
    ),
    sizes: [],
    siteName: cleanText(first("og:site_name"), 120),
  };
}
