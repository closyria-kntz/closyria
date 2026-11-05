import { type FakeShop, startFakeShop } from "@closyria/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createRobotsCache, parseRobots, safeRobotsFetcher } from "./robots";
import { loopbackForTests } from "./testing";

describe("parseRobots", () => {
  it("applies Disallow by prefix", () => {
    const allows = parseRobots("User-agent: *\nDisallow: /checkout", "ClosyriaBot");
    expect(allows("/checkout/x")).toBe(false);
    expect(allows("/products/a")).toBe(true);
  });

  it("prefers the ClosyriaBot group over *", () => {
    const text = "User-agent: *\nDisallow: /\n\nUser-agent: ClosyriaBot\nDisallow: /private";
    const allows = parseRobots(text, "ClosyriaBot");
    expect(allows("/products/a")).toBe(true);
    expect(allows("/private/x")).toBe(false);
  });

  it("matches the product token case-insensitively", () => {
    const allows = parseRobots("User-agent: closyriabot\nDisallow: /a", "ClosyriaBot");
    expect(allows("/a")).toBe(false);
  });

  it("shares one group between consecutive User-agent lines", () => {
    const allows = parseRobots("User-agent: Other\nUser-agent: ClosyriaBot\nDisallow: /a", "ClosyriaBot");
    expect(allows("/a")).toBe(false);
  });

  it("uses the longest rule, Allow winning ties", () => {
    const text = "User-agent: *\nDisallow: /\nAllow: /products/";
    const allows = parseRobots(text, "ClosyriaBot");
    expect(allows("/products/a")).toBe(true);
    expect(allows("/other")).toBe(false);
    const tie = parseRobots("User-agent: *\nDisallow: /x\nAllow: /x", "ClosyriaBot");
    expect(tie("/x")).toBe(true);
  });

  it("handles * and $ wildcards", () => {
    const allows = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /s*/tmp", "ClosyriaBot");
    expect(allows("/a/b.pdf")).toBe(false);
    expect(allows("/a/b.pdf?x=1")).toBe(true);
    expect(allows("/shop/tmp")).toBe(false);
  });

  it("allows everything with no matching group, ignores comments and empty Disallow", () => {
    expect(parseRobots("User-agent: Other\nDisallow: /", "ClosyriaBot")("/a")).toBe(true);
    expect(parseRobots("User-agent: * # all\nDisallow:\n# c", "ClosyriaBot")("/a")).toBe(true);
    expect(parseRobots("", "ClosyriaBot")("/a")).toBe(true);
  });
});

describe("createRobotsCache", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("fetches once per origin for 24 h, then again", async () => {
    let now = 0;
    const calls: string[] = [];
    const cache = createRobotsCache(
      async (url) => {
        calls.push(url);
        return "User-agent: *\nDisallow: /checkout";
      },
      () => now,
    );
    expect(await cache.allows("https://a.fr/products/x")).toBe(true);
    expect(await cache.allows("https://a.fr/checkout/1")).toBe(false);
    now = DAY - 1;
    await cache.allows("https://a.fr/y");
    expect(calls).toEqual(["https://a.fr/robots.txt"]);
    now = DAY;
    await cache.allows("https://a.fr/y");
    expect(calls).toHaveLength(2);
    await cache.allows("https://a.fr:8443/y");
    await cache.allows("http://a.fr/y");
    expect(calls).toHaveLength(4);
  });

  it("allows everything when the file is missing", async () => {
    const cache = createRobotsCache(
      async () => null,
      () => 0,
    );
    expect(await cache.allows("https://a.fr/checkout")).toBe(true);
  });

  it("includes the query string in the tested path", async () => {
    const cache = createRobotsCache(
      async () => "User-agent: *\nDisallow: /*?add=",
      () => 0,
    );
    expect(await cache.allows("https://a.fr/p?add=1")).toBe(false);
    expect(await cache.allows("https://a.fr/p")).toBe(true);
  });
});

describe("safeRobotsFetcher", () => {
  let shop: FakeShop | undefined;
  afterEach(async () => {
    await shop?.close();
    shop = undefined;
  });
  const text = { "content-type": "text/plain; charset=utf-8" };

  it("returns the body on 200", async () => {
    shop = await startFakeShop({ "/robots.txt": { headers: text, body: "User-agent: *\nDisallow: /é" } });
    expect(await safeRobotsFetcher(loopbackForTests)(`${shop.origin}/robots.txt`)).toBe("User-agent: *\nDisallow: /é");
  });

  it("returns null on 404, 410, wrong type, server error and refused address", async () => {
    shop = await startFakeShop({
      "/404/robots.txt": { status: 404 },
      "/410/robots.txt": { status: 410, headers: text, body: "gone" },
      "/html/robots.txt": { headers: { "content-type": "text/html" }, body: "<html>" },
      "/500/robots.txt": { status: 500 },
    });
    const fetcher = safeRobotsFetcher(loopbackForTests);
    for (const p of ["404", "410", "html", "500"]) {
      expect(await fetcher(`${shop.origin}/${p}/robots.txt`)).toBeNull();
    }
    expect(await safeRobotsFetcher()(`${shop.origin}/robots.txt`)).toBeNull();
  });
});
