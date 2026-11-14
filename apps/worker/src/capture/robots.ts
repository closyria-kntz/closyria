import type dns from "node:dns";
import type { AddressPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";
import { safeFetch } from "./safe-fetch";

const PRODUCT_TOKEN = "closyriabot";
const CACHE_MS = 24 * 60 * 60 * 1000;

type Rule = { allow: boolean; length: number; matches: (path: string) => boolean };
type Group = { agents: string[]; rules: Rule[] };

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * RFC 9309 comparison form: non-ASCII as UTF-8 percent-escapes, escape hex digits in upper case,
 * escapes of unreserved characters decoded.
 */
function normalise(value: string): string {
  let encoded = "";
  for (const char of value) encoded += (char.codePointAt(0) ?? 0) > 0x7f ? encodeURIComponent(char) : char;
  return encoded.replace(/%([0-9a-fA-F]{2})/g, (_match, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}

/**
 * Linear wildcard matcher (no regex, no backtracking): `*` matches any run, a trailing `$`
 * anchors the end, otherwise the rule is a prefix. Literal pieces are matched greedily left to right.
 */
function compile(rule: string): (path: string) => boolean {
  const anchored = rule.endsWith("$");
  const pieces = (anchored ? rule.slice(0, -1) : rule).split("*");
  const first = pieces[0] ?? "";
  if (pieces.length === 1) return (path) => (anchored ? path === first : path.startsWith(first));
  const last = pieces[pieces.length - 1] ?? "";
  const middle = pieces.slice(1, -1);
  return (path) => {
    if (!path.startsWith(first)) return false;
    let position = first.length;
    for (const piece of middle) {
      const found = path.indexOf(piece, position);
      if (found < 0) return false;
      position = found + piece.length;
    }
    if (anchored) return path.length - last.length >= position && path.endsWith(last);
    return path.indexOf(last, position) >= 0;
  };
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let collectingAgents = false;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    const line = raw.replace(/#.*/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!collectingAgents || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
    } else if (field === "allow" || field === "disallow") {
      collectingAgents = false;
      // An empty value (`Disallow:`) allows everything: no rule.
      if (current && value !== "") {
        const rule = normalise(value);
        current.rules.push({ allow: field === "allow", length: rule.length, matches: compile(rule) });
      }
    } else {
      collectingAgents = false;
    }
  }
  return groups;
}

/** Group of the product token if there is one, otherwise `*`; longest rule wins, Allow on a tie. */
export function parseRobots(text: string, _agent: "ClosyriaBot"): (path: string) => boolean {
  const groups = parseGroups(text);
  const own = groups.filter((group) => group.agents.includes(PRODUCT_TOKEN));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
  const rules = chosen.flatMap((group) => group.rules);
  return (rawPath) => {
    const path = normalise(rawPath);
    let best: Rule | undefined;
    for (const rule of rules) {
      if (!rule.matches(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) best = rule;
    }
    return best ? best.allow : true;
  };
}

export type RobotsCache = { allows(url: string): Promise<boolean> };

/** `absent`: 404/410, a definitive "no robots.txt". `failed`: anything else that went wrong. */
export type RobotsFetch = { kind: "text"; text: string } | { kind: "absent" } | { kind: "failed" };

const FAILURE_CACHE_MS = 60 * 60 * 1000;
export const MAX_CACHED_ORIGINS = 10_000;
/** The sweep of expired origins walks the whole cache: at most once a minute, not on every new origin. */
const PRUNE_INTERVAL_MS = 60 * 1000;

type Entry = { expires: number; allows: Promise<(path: string) => boolean> };

/**
 * Cache per origin: 24 h for content or a 404/410, 1 h after a failure (allow-all meanwhile).
 * Concurrent calls on a cold origin share one fetch. Bounded: expired entries are pruned when a
 * new origin is fetched (at most once a minute, so a burst of new origins stays linear), and the
 * oldest are evicted beyond 10 000.
 */
export function createRobotsCache(fetchText: (url: string) => Promise<RobotsFetch>, now: () => number): RobotsCache {
  const entries = new Map<string, Entry>();
  let nextPrune = Number.NEGATIVE_INFINITY;

  function pruneExpired(time: number) {
    if (time < nextPrune) return;
    nextPrune = time + PRUNE_INTERVAL_MS;
    for (const [key, other] of entries) if (other.expires <= time) entries.delete(key);
  }

  async function load(origin: string, entry: Entry, resolve: (allows: (path: string) => boolean) => void) {
    let result: RobotsFetch;
    try {
      result = await fetchText(`${origin}/robots.txt`);
    } catch {
      result = { kind: "failed" };
    }
    entry.expires = now() + (result.kind === "failed" ? FAILURE_CACHE_MS : CACHE_MS);
    resolve(result.kind === "text" ? parseRobots(result.text, "ClosyriaBot") : () => true);
  }

  return {
    async allows(rawUrl) {
      const url = new URL(rawUrl);
      const origin = url.origin;
      let entry = entries.get(origin);
      const time = now();
      if (!entry || entry.expires <= time) {
        pruneExpired(time);
        let resolve: (allows: (path: string) => boolean) => void = () => {};
        const allows = new Promise<(path: string) => boolean>((done) => {
          resolve = done;
        });
        // Pending until the fetch settles, so concurrent callers wait on the same promise.
        entry = { expires: Number.POSITIVE_INFINITY, allows };
        entries.set(origin, entry);
        while (entries.size > MAX_CACHED_ORIGINS) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
        void load(origin, entry, resolve);
      }
      return (await entry.allows)(`${url.pathname}${url.search}`);
    },
  };
}

/** robots.txt through `safeFetch`: text on 2xx, `absent` on 404/410, `failed` on any other problem. */
export function safeRobotsFetcher(
  policy?: AddressPolicy,
  lookup?: typeof dns.lookup,
): (url: string) => Promise<RobotsFetch> {
  return async (url) => {
    try {
      const response = await safeFetch(url, {
        accept: "text",
        ...(policy ? { policy } : {}),
        ...(lookup ? { lookup } : {}),
      });
      return { kind: "text", text: response.body.toString("utf8") };
    } catch (error) {
      if (!(error instanceof CaptureError)) throw error;
      return error.httpStatus === 404 || error.httpStatus === 410 ? { kind: "absent" } : { kind: "failed" };
    }
  };
}
