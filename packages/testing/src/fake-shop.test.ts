import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { startFakeShop } from "./fake-shop";

const FIXTURES = resolve(import.meta.dirname, "../../extract/fixtures");

describe("startFakeShop", () => {
  it("serves a fixture file, records hits with query, and answers 404", async () => {
    const shop = await startFakeShop({
      "/p": { file: "synthetic/jsonld-simple.html", headers: { "content-type": "text/html" } },
    });
    try {
      const res = await fetch(`${shop.origin}/p?a=1`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(readFileSync(resolve(FIXTURES, "synthetic/jsonld-simple.html"), "utf8"));
      expect((await fetch(`${shop.origin}/nope`)).status).toBe(404);
      expect(shop.hits).toEqual(["/p?a=1", "/nope"]);
      const port = Number(new URL(shop.origin).port);
      expect([3000, 3001, 3100, 3101]).not.toContain(port);
      expect(shop.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await shop.close();
    }
  });

  it("redirects with 302 by default, honours 3xx status, absolute and relative targets", async () => {
    const shop = await startFakeShop({
      "/a": { redirect: "/b" },
      "/c": { redirect: "http://10.0.0.1/", status: 301 },
    });
    try {
      const a = await fetch(`${shop.origin}/a`, { redirect: "manual" });
      expect(a.status).toBe(302);
      expect(a.headers.get("location")).toBe("/b");
      const c = await fetch(`${shop.origin}/c`, { redirect: "manual" });
      expect(c.status).toBe(301);
      expect(c.headers.get("location")).toBe("http://10.0.0.1/");
    } finally {
      await shop.close();
    }
  });

  it("delays, serves raw buffers with custom headers, and closes with keep-alive open", async () => {
    const gz = gzipSync("hello");
    const shop = await startFakeShop({
      "/slow": { body: "x", delayMs: 150 },
      "/gz": { body: gz, headers: { "content-encoding": "gzip" } },
      "/big": { body: Buffer.alloc(6 * 1024 * 1024) },
    });
    const start = Date.now();
    await fetch(`${shop.origin}/slow`);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
    expect(await (await fetch(`${shop.origin}/gz`)).text()).toBe("hello");
    expect((await (await fetch(`${shop.origin}/big`)).arrayBuffer()).byteLength).toBe(6 * 1024 * 1024);
    await shop.close();
  });

  it("refuses a file path escaping the fixtures directory", async () => {
    const shop = await startFakeShop({ "/x": { file: "../package.json" } });
    try {
      expect((await fetch(`${shop.origin}/x`)).status).toBe(500);
    } finally {
      await shop.close();
    }
  });

  it("follows a redirect chain across routes", async () => {
    const shop = await startFakeShop({
      "/a": { redirect: "/b" },
      "/b": { redirect: "/c" },
      "/c": { body: "end" },
    });
    try {
      const res = await fetch(`${shop.origin}/a`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("end");
      expect(shop.hits).toEqual(["/a", "/b", "/c"]);
    } finally {
      await shop.close();
    }
  });

  it("clears pending delays on close", async () => {
    const shop = await startFakeShop({ "/slow": { body: "x", delayMs: 5000 } });
    const created: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const setSpy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((...args: Parameters<typeof setTimeout>) => {
      const handle = realSetTimeout(...args);
      if (args[1] === 5000) created.push(handle);
      return handle;
    }) as typeof setTimeout);
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    try {
      const controller = new AbortController();
      const pending = fetch(`${shop.origin}/slow`, { signal: controller.signal }).catch(() => null);
      await new Promise((r) => realSetTimeout(r, 100));
      controller.abort();
      await pending;
      expect(created).toHaveLength(1);
      const start = Date.now();
      await shop.close();
      expect(Date.now() - start).toBeLessThan(1000);
      expect(clearSpy.mock.calls.map(([handle]) => handle)).toContain(created[0]);
    } finally {
      setSpy.mockRestore();
      clearSpy.mockRestore();
    }
  });
});
