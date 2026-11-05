import type { AddressPolicy } from "./address-policy";
import { CaptureError } from "./capture-error";
import { safeFetch } from "./safe-fetch";

const PRODUCT_TOKEN = "closyriabot";
const CACHE_MS = 24 * 60 * 60 * 1000;

type Rule = { allow: boolean; length: number; pattern: RegExp };
type Group = { agents: string[]; rules: Rule[] };

function compile(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | undefined;
  let collectingAgents = false;
  for (const raw of text.split(/\r?\n/)) {
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
      if (current && value !== "")
        current.rules.push({ allow: field === "allow", length: value.length, pattern: compile(value) });
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
  return (path) => {
    let best: Rule | undefined;
    for (const rule of rules) {
      if (!rule.pattern.test(path)) continue;
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow && !best.allow)) best = rule;
    }
    return best ? best.allow : true;
  };
}

export type RobotsCache = { allows(url: string): Promise<boolean> };

/** 24 h cache per origin. A missing file or a failed fetch (`null`) allows everything. */
export function createRobotsCache(fetchText: (url: string) => Promise<string | null>, now: () => number): RobotsCache {
  const entries = new Map<string, { expires: number; allows: (path: string) => boolean }>();
  return {
    async allows(rawUrl) {
      const url = new URL(rawUrl);
      const origin = url.origin;
      let entry = entries.get(origin);
      if (!entry || entry.expires <= now()) {
        let text: string | null;
        try {
          text = await fetchText(`${origin}/robots.txt`);
        } catch {
          text = null;
        }
        entry = { expires: now() + CACHE_MS, allows: text === null ? () => true : parseRobots(text, "ClosyriaBot") };
        entries.set(origin, entry);
      }
      return entry.allows(`${url.pathname}${url.search}`);
    },
  };
}

/** robots.txt through `safeFetch`; any problem (404, 410, network, wrong type) yields `null`: allowed. */
export function safeRobotsFetcher(policy?: AddressPolicy): (url: string) => Promise<string | null> {
  return async (url) => {
    try {
      const response = await safeFetch(url, { accept: "text", ...(policy ? { policy } : {}) });
      return response.body.toString("utf8");
    } catch (error) {
      if (error instanceof CaptureError) return null;
      throw error;
    }
  };
}
