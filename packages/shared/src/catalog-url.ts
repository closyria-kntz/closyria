const MAX_URL_LENGTH = 2048;
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid", "_ga", "ref"]);

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || TRACKING_PARAMS.has(k);
}

/**
 * Canonical form of a product address, used to deduplicate pasted links.
 * Returns null for non-http(s) addresses, addresses over 2048 characters or addresses with credentials.
 * `?variant=` is kept on purpose: two variants of an item are two different pages.
 */
export function canonicalizeUrl(input: string): string | null {
  if (input.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => !isTracking(key));
  kept.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const result = url.toString();
  return result.length > MAX_URL_LENGTH ? null : result;
}

/** Host of an address, without `www.`. Expects a canonicalised URL (throws on an invalid one). */
export function shopDomain(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
}

/** The host without `www.`, then each parent domain down to two labels. */
export function domainCandidates(host: string): string[] {
  const lower = host.toLowerCase();
  // IP literals have no parent domains.
  if (lower.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) return [lower];
  const labels = lower.replace(/^www\./, "").split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out.length > 0 ? out : [labels.join(".")];
}

/** Readable name guessed from the last path segment (`robe-camelia-rose` -> `Robe camelia rose`). */
export function nameFromUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const segment = pathname.split("/").filter(Boolean).pop();
  if (!segment) return null;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  const words = decoded
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/-p?\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
