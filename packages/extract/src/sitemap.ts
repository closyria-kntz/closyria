import { z } from "zod";

/** A sitemap index (`<sitemapindex>`: the sitemaps it lists) or a sitemap (`<urlset>`: the pages it lists). */
export type Sitemap = { kind: "index" | "urlset"; locs: string[] };

const locSchema = z.url({ protocol: /^https?$/ }).max(2000);
const sitemapSchema = z.object({ kind: z.enum(["index", "urlset"]), locs: z.array(z.string()) });

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  if (cdata) return (cdata[1] ?? "").trim();
  return raw.trim().replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? "");
}

/**
 * Reads a sitemap (sitemaps.org): the `<loc>` of each `<sitemap>` of an index, or of each `<url>` of a urlset (not the
 * nested image or video addresses). An entry whose address is not an http(s) URL is skipped. Null when the text is
 * neither (an HTML page, JSON, a truncated document).
 */
export function extractSitemap(xml: string): Sitemap | null {
  const root = /<(sitemapindex|urlset)\b[^>]*>([\s\S]*)<\/\1\s*>/i.exec(xml);
  if (!root) return null;
  const kind = root[1]?.toLowerCase() === "sitemapindex" ? "index" : "urlset";
  const entry = kind === "index" ? "sitemap" : "url";
  const locs: string[] = [];
  const entries = new RegExp(`<${entry}\\b[^>]*>([\\s\\S]*?)</${entry}\\s*>`, "gi");
  for (const match of (root[2] ?? "").matchAll(entries)) {
    // The entry's own <loc>: a direct child, so the first one not inside a namespaced element (image:loc…).
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(match[1] ?? "");
    if (!loc) continue;
    const parsed = locSchema.safeParse(decodeText(loc[1] ?? ""));
    if (parsed.success) locs.push(parsed.data);
  }
  const result = sitemapSchema.safeParse({ kind, locs });
  return result.success ? result.data : null;
}
