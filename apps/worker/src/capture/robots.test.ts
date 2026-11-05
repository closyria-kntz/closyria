import { type FakeShop, startFakeShop } from "@closyria/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createRobotsCache, parseRobots, type RobotsFetch, safeRobotsFetcher } from "./robots";
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
        return { kind: "text", text: "User-agent: *\nDisallow: /checkout" };
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
      async () => ({ kind: "absent" }),
      () => 0,
    );
    expect(await cache.allows("https://a.fr/checkout")).toBe(true);
  });

  it("includes the query string in the tested path", async () => {
    const cache = createRobotsCache(
      async () => ({ kind: "text", text: "User-agent: *\nDisallow: /*?add=" }),
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
    expect(await safeRobotsFetcher(loopbackForTests)(`${shop.origin}/robots.txt`)).toEqual({
      kind: "text",
      text: "User-agent: *\nDisallow: /é",
    });
  });

  it("tells absent (404, 410) from failed (wrong type, server error, refused address)", async () => {
    shop = await startFakeShop({
      "/404/robots.txt": { status: 404 },
      "/410/robots.txt": { status: 410, headers: text, body: "gone" },
      "/html/robots.txt": { headers: { "content-type": "text/html" }, body: "<html>" },
      "/500/robots.txt": { status: 500 },
    });
    const fetcher = safeRobotsFetcher(loopbackForTests);
    const kinds: Record<string, string> = { "404": "absent", "410": "absent", html: "failed", "500": "failed" };
    for (const [p, kind] of Object.entries(kinds)) {
      expect(await fetcher(`${shop.origin}/${p}/robots.txt`)).toEqual({ kind });
    }
    expect(await safeRobotsFetcher()(`${shop.origin}/robots.txt`)).toEqual({ kind: "failed" });
  });
});

describe("parseRobots hardening", () => {
  it("matches a pathological pattern in linear time", () => {
    const allows = parseRobots(`User-agent: *\nDisallow: /${"a*".repeat(50)}b`, "ClosyriaBot");
    const started = performance.now();
    expect(allows(`/${"a".repeat(2000)}`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("matches wildcards and anchors exactly", () => {
    const allows = parseRobots("User-agent: *\nDisallow: /a*b*c$", "ClosyriaBot");
    expect(allows("/aXbYc")).toBe(false);
    expect(allows("/aXbYcZ")).toBe(true);
    expect(allows("/abc")).toBe(false);
    expect(allows("/acb")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /a$", "ClosyriaBot")("/a")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /a$", "ClosyriaBot")("/ab")).toBe(true);
    expect(parseRobots("User-agent: *\nDisallow: /a*", "ClosyriaBot")("/a")).toBe(false);
  });

  it("normalises percent-encoding on rules and paths", () => {
    expect(parseRobots("User-agent: *\nDisallow: /é", "ClosyriaBot")("/%C3%A9")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /%7Efoo", "ClosyriaBot")("/~foo")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /~foo", "ClosyriaBot")("/%7Efoo")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /%c3%a9", "ClosyriaBot")("/%C3%A9")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /%2Fx", "ClosyriaBot")("/%2fx")).toBe(false);
    expect(parseRobots("User-agent: *\nDisallow: /%2Fx", "ClosyriaBot")("//x")).toBe(true);
  });

  it("handles a BOM, CRLF and lone CR line endings", () => {
    expect(parseRobots("\uFEFFUser-agent: *\r\nDisallow: /a\r\n", "ClosyriaBot")("/a")).toBe(false);
    expect(parseRobots("User-agent: *\rDisallow: /a\rDisallow: /b", "ClosyriaBot")("/b")).toBe(false);
  });
});

describe("createRobotsCache robustness", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("shares one in-flight fetch between concurrent calls on a cold origin", async () => {
    let calls = 0;
    const cache = createRobotsCache(
      async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return { kind: "text", text: "User-agent: *\nDisallow: /x" };
      },
      () => 0,
    );
    const results = await Promise.all([cache.allows("https://a.fr/x"), cache.allows("https://a.fr/y")]);
    expect(results).toEqual([false, true]);
    expect(calls).toBe(1);
  });

  it("keeps a failure for 1 h only, and absent or real content for 24 h", async () => {
    let now = 0;
    const answers: RobotsFetch[] = [{ kind: "failed" }, { kind: "absent" }];
    let calls = 0;
    const cache = createRobotsCache(
      async () => answers[calls++] ?? { kind: "absent" },
      () => now,
    );
    await cache.allows("https://a.fr/");
    now = HOUR - 1;
    await cache.allows("https://a.fr/");
    expect(calls).toBe(1);
    now = HOUR;
    await cache.allows("https://a.fr/");
    expect(calls).toBe(2);
    now = HOUR + DAY - 1;
    await cache.allows("https://a.fr/");
    expect(calls).toBe(2);
  });

  it("treats a throwing fetcher as a one-hour failure", async () => {
    let now = 0;
    let calls = 0;
    const cache = createRobotsCache(
      async () => {
        calls++;
        throw new Error("boom");
      },
      () => now,
    );
    expect(await cache.allows("https://a.fr/x")).toBe(true);
    now = HOUR;
    await cache.allows("https://a.fr/x");
    expect(calls).toBe(2);
  });

  it("caps the number of origins kept, evicting the oldest", async () => {
    const calls: string[] = [];
    const cache = createRobotsCache(
      async (url) => {
        calls.push(url);
        return { kind: "absent" };
      },
      () => 0,
    );
    for (let i = 0; i <= 10_000; i++) await cache.allows(`https://d${i}.fr/`);
    calls.length = 0;
    await cache.allows("https://d0.fr/");
    await cache.allows("https://d10000.fr/");
    expect(calls).toEqual(["https://d0.fr/robots.txt"]);
  });

  it("prunes expired origins when a new one is fetched", async () => {
    let now = 0;
    const calls: string[] = [];
    const cache = createRobotsCache(
      async (url) => {
        calls.push(url);
        return { kind: "absent" };
      },
      () => now,
    );
    await cache.allows("https://old.fr/");
    now = DAY + 1;
    await cache.allows("https://new.fr/");
    await cache.allows("https://old.fr/");
    expect(calls).toEqual(["https://old.fr/robots.txt", "https://new.fr/robots.txt", "https://old.fr/robots.txt"]);
  });
});
