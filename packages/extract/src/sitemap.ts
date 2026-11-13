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

/** Where the tag `<name` starts at or after `from`, as a whole name (`<url` is not `<urlset`); -1 when none. */
function openTag(lower: string, name: string, from: number): number {
  for (let at = lower.indexOf(`<${name}`, from); at !== -1; at = lower.indexOf(`<${name}`, at + 1)) {
    const next = lower.charAt(at + name.length + 1);
    if (next === ">" || next === "/" || /\s/.test(next)) return at;
  }
  return -1;
}

/** The text of the first `<name>…</name>` of one entry (searched in that entry only), or null. */
function childText(entry: string, lowerEntry: string, name: string): string | null {
  const open = openTag(lowerEntry, name, 0);
  if (open === -1) return null;
  const start = lowerEntry.indexOf(">", open);
  const end = start === -1 ? -1 : lowerEntry.indexOf(`</${name}`, start);
  return end === -1 ? null : entry.slice(start + 1, end);
}

/**
 * Reads a sitemap (sitemaps.org): the `<loc>` of each `<sitemap>` of an index, or of each `<url>` of a urlset (not the
 * nested image or video addresses: `image:loc` is another name). One pass from start to end (indexOf only), so a
 * hostile or truncated document costs its length, never more: reading stops at the first entry left unclosed. An
 * entry whose address is not an http(s) URL is skipped. Null when the text is neither (an HTML page, JSON, a document
 * without its closing root).
 */
export function extractSitemap(xml: string): Sitemap | null {
  const lower = xml.toLowerCase();
  const index = openTag(lower, "sitemapindex", 0);
  const urlset = openTag(lower, "urlset", 0);
  if (index === -1 && urlset === -1) return null;
  const kind = index !== -1 && (urlset === -1 || index < urlset) ? "index" : "urlset";
  const root = kind === "index" ? "sitemapindex" : "urlset";
  const rootStart = kind === "index" ? index : urlset;
  const bodyStart = lower.indexOf(">", rootStart);
  const bodyEnd = lower.lastIndexOf(`</${root}`);
  if (bodyStart === -1 || bodyEnd <= bodyStart) return null;

  const entry = kind === "index" ? "sitemap" : "url";
  const locs: string[] = [];
  for (let at = bodyStart + 1; ; ) {
    const open = openTag(lower, entry, at);
    if (open === -1 || open >= bodyEnd) break;
    const close = lower.indexOf(`</${entry}`, open);
    // An entry without its end (none, or another entry opens first): the rest is not trusted, and no later search
    // may scan the document again.
    if (close === -1 || close > bodyEnd) break;
    const next = openTag(lower, entry, open + 1);
    if (next !== -1 && next < close) break;
    // Searched within the entry only: a missing </loc> costs the entry's length, not the document's.
    const text = childText(xml.slice(open, close), lower.slice(open, close), "loc");
    if (text !== null) {
      const parsed = locSchema.safeParse(decodeText(text));
      if (parsed.success) locs.push(parsed.data);
    }
    at = close + entry.length + 2;
  }
  const result = sitemapSchema.safeParse({ kind, locs });
  return result.success ? result.data : null;
}
