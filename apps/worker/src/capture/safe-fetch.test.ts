import type dns from "node:dns";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureError } from "./capture-error";
import { BOT_USER_AGENT, safeFetch } from "./safe-fetch";
import { loopbackForTests } from "./testing";

const HTML = { "content-type": "text/html; charset=utf-8" };
const SIX_MB = 6 * 1024 * 1024;

let shop: FakeShop | undefined;
afterEach(async () => {
  await shop?.close();
  shop = undefined;
});

async function serve(routes: Record<string, FakeRoute>): Promise<FakeShop> {
  shop = await startFakeShop(routes);
  return shop;
}

/** A resolver that never touches the network: each host maps to fixed addresses. */
function fakeLookup(table: Record<string, string[]>, calls: string[] = []): typeof dns.lookup {
  const lookup = (
    hostname: string,
    _options: dns.LookupAllOptions,
    callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
  ) => {
    calls.push(hostname);
    const addresses = table[hostname];
    queueMicrotask(() => {
      if (!addresses) {
        callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }), []);
        return;
      }
      callback(
        null,
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      );
    });
  };
  return lookup as unknown as typeof dns.lookup;
}

async function captureError(promise: Promise<unknown>): Promise<CaptureError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(CaptureError);
  return error as CaptureError;
}

/** A bare server that records request headers (the fake shop only records paths). */
async function headerEcho(): Promise<{ origin: string; seen: IncomingHttpHeaders[]; close(): Promise<void> }> {
  const seen: IncomingHttpHeaders[] = [];
  const reserved = new Set([3000, 3001, 3100, 3101]);
  let server: Server;
  let port: number;
  do {
    server = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { ...HTML, "set-cookie": "session=abc; Path=/" }).end("<p>ok</p>");
    });
    port = await new Promise<number>((done) =>
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        done(typeof address === "object" && address ? address.port : 0);
      }),
    );
    if (reserved.has(port)) await new Promise((done) => server.close(done));
  } while (reserved.has(port));
  const listening = server;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((done) => listening.close(() => done())),
  };
}

describe("safeFetch with the fake shop and loopbackForTests", () => {
  it("returns the body of a 200 HTML page", async () => {
    const { origin } = await serve({ "/p": { headers: HTML, body: "<h1>Robe</h1>" } });
    const response = await safeFetch(`${origin}/p`, { accept: "page", policy: loopbackForTests });
    expect(response).toEqual({
      finalUrl: `${origin}/p`,
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: Buffer.from("<h1>Robe</h1>"),
    });
  });

  it("follows relative and absolute redirects and reports the final URL", async () => {
    const routes: Record<string, FakeRoute> = {
      "/a": { redirect: "/b", status: 301 },
      "/c": { headers: HTML, body: "fin" },
    };
    const { origin, hits } = await serve(routes);
    // The fake shop reads its routes per request: the absolute target needs the origin.
    routes["/b"] = { redirect: `${origin}/c`, status: 308 };
    const response = await safeFetch(`${origin}/a`, { accept: "page", policy: loopbackForTests });
    expect(response.body.toString()).toBe("fin");
    expect(response.finalUrl).toBe(`${origin}/c`);
    expect(hits).toEqual(["/a", "/b", "/c"]);
  });

  it("refuses a redirect to http://10.0.0.1/ with forbidden_address", async () => {
    const { origin } = await serve({ "/r": { redirect: "http://10.0.0.1/" } });
    const error = await captureError(safeFetch(`${origin}/r`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("forbidden_address");
  });

  it.each([
    ["credentials", (origin: string) => origin.replace("http://", "http://user:pass@")],
    ["another scheme", () => "file:///etc/passwd"],
    ["a URL over 2 048 characters", (origin: string) => `${origin}/c?${"a".repeat(2_048)}`],
  ])("rechecks each redirect: refuses one with %s", async (_case, target) => {
    const routes: Record<string, FakeRoute> = { "/c": { headers: HTML, body: "ok" } };
    const { origin, hits } = await serve(routes);
    routes["/r"] = { redirect: target(origin) };
    const error = await captureError(safeFetch(`${origin}/r`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("forbidden_address");
    expect(hits).toEqual(["/r"]);
  });

  it("follows 5 redirects but refuses a 6th with http_error", async () => {
    const routes: Record<string, FakeRoute> = { "/r6": { headers: HTML, body: "ok" } };
    for (let i = 0; i < 6; i++) routes[`/r${i}`] = { redirect: `/r${i + 1}` };
    const { origin } = await serve(routes);
    const five = await safeFetch(`${origin}/r1`, { accept: "page", policy: loopbackForTests });
    expect(five.finalUrl).toBe(`${origin}/r6`);
    const error = await captureError(safeFetch(`${origin}/r0`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("http_error");
  });

  it("refuses a 6 MB body with too_large", async () => {
    const { origin } = await serve({ "/big": { headers: HTML, body: Buffer.alloc(SIX_MB, 0x61) } });
    const error = await captureError(safeFetch(`${origin}/big`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("too_large");
  });

  it("refuses a gzip body that inflates to 6 MB with too_large", async () => {
    const body = gzipSync(Buffer.alloc(SIX_MB, 0x61));
    expect(body.length).toBeLessThan(100_000);
    const { origin } = await serve({ "/gz": { headers: { ...HTML, "content-encoding": "gzip" }, body } });
    const error = await captureError(safeFetch(`${origin}/gz`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("too_large");
  });

  it("applies maxBytes after decompression", async () => {
    const body = gzipSync(Buffer.alloc(2_000, 0x61));
    const { origin } = await serve({ "/gz": { headers: { ...HTML, "content-encoding": "gzip" }, body } });
    const error = await captureError(
      safeFetch(`${origin}/gz`, { accept: "page", policy: loopbackForTests, maxBytes: 1_000 }),
    );
    expect(error.code).toBe("too_large");
  });

  it.each([
    ["gzip", gzipSync],
    ["br", brotliCompressSync],
  ] as const)("decompresses %s bodies", async (encoding, compress) => {
    const { origin } = await serve({
      "/z": { headers: { ...HTML, "content-encoding": encoding }, body: compress(Buffer.from("<p>compressé</p>")) },
    });
    const response = await safeFetch(`${origin}/z`, { accept: "page", policy: loopbackForTests });
    expect(response.body.toString()).toBe("<p>compressé</p>");
  });

  it("does not ask for deflate and refuses a deflate body with invalid_data", async () => {
    const echo = await headerEcho();
    try {
      await safeFetch(`${echo.origin}/`, { accept: "page", policy: loopbackForTests });
      expect(echo.seen[0]?.["accept-encoding"]).toBe("gzip, br");
    } finally {
      await echo.close();
    }
    const { origin } = await serve({
      "/d": { headers: { ...HTML, "content-encoding": "deflate" }, body: deflateSync(Buffer.from("<p>x</p>")) },
    });
    const error = await captureError(safeFetch(`${origin}/d`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("invalid_data");
  });

  it("gives timeout when the shop answers after the deadline", async () => {
    const { origin } = await serve({ "/slow": { headers: HTML, body: "tard", delayMs: 200 } });
    const error = await captureError(
      safeFetch(`${origin}/slow`, { accept: "page", policy: loopbackForTests, timeoutMs: 100 }),
    );
    expect(error.code).toBe("timeout");
  });

  it("gives up at once when its signal is aborted (worker stopping), already or during the request", async () => {
    const { origin } = await serve({ "/slow": { headers: HTML, body: "tard", delayMs: 2000 } });
    const options = { accept: "page" as const, policy: loopbackForTests, timeoutMs: 10_000 };
    expect((await captureError(safeFetch(`${origin}/slow`, { ...options, signal: AbortSignal.abort() }))).code).toBe(
      "timeout",
    );
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);
    const error = await captureError(safeFetch(`${origin}/slow`, { ...options, signal: controller.signal }));
    expect(error.code).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("takes a sitemap as XML, and refuses HTML where XML is asked for", async () => {
    const { origin } = await serve({
      "/sitemap.xml": { headers: { "content-type": "application/xml; charset=utf-8" }, body: "<urlset/>" },
      "/old.xml": { headers: { "content-type": "text/xml" }, body: "<urlset/>" },
      "/page": { headers: HTML, body: "<html></html>" },
    });
    const options = { accept: "xml" as const, policy: loopbackForTests };
    expect((await safeFetch(`${origin}/sitemap.xml`, options)).body.toString()).toBe("<urlset/>");
    expect((await safeFetch(`${origin}/old.xml`, options)).status).toBe(200);
    expect((await captureError(safeFetch(`${origin}/page`, options))).code).toBe("invalid_data");
  });

  it("counts redirects inside the single deadline", async () => {
    const { origin } = await serve({
      "/a": { redirect: "/b", delayMs: 60 },
      "/b": { redirect: "/c", delayMs: 60 },
      "/c": { headers: HTML, body: "tard", delayMs: 60 },
    });
    const error = await captureError(
      safeFetch(`${origin}/a`, { accept: "page", policy: loopbackForTests, timeoutMs: 150 }),
    );
    expect(error.code).toBe("timeout");
  });

  it.each([401, 403, 429])("gives blocked for %i", async (status) => {
    const { origin } = await serve({ "/b": { status, headers: HTML, body: "non" } });
    const error = await captureError(safeFetch(`${origin}/b`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("blocked");
    expect(error.httpStatus).toBe(status);
  });

  it.each(["captcha-delivery", "cf-chl", "_incapsula_"])("gives blocked for a %s challenge page", async (marker) => {
    const { origin } = await serve({
      "/c": { headers: HTML, body: `<html><script src="https://x/${marker}/a.js"></script></html>` },
    });
    const error = await captureError(safeFetch(`${origin}/c`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("blocked");
  });

  it.each([
    ["captcha-delivery", 503, {}],
    ["cf-chl", 503, {}],
    ["_incapsula_", 500, {}],
    ["captcha-delivery", 404, { "content-encoding": "gzip" }],
  ] as const)("gives blocked for a %s challenge page served with %i %o", async (marker, status, extra) => {
    const html = Buffer.from(`<html><script src="https://x/${marker}/a.js"></script></html>`);
    const body = "content-encoding" in extra ? gzipSync(html) : html;
    const { origin } = await serve({ "/c": { status, headers: { ...HTML, ...extra }, body } });
    const error = await captureError(safeFetch(`${origin}/c`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("blocked");
    expect(error.httpStatus).toBe(status);
  });

  it("keeps http_error for an error page whose marker lies beyond the first 64 KB, or is not HTML", async () => {
    const late = Buffer.concat([Buffer.alloc(SIX_MB, 0x61), Buffer.from("captcha-delivery")]);
    const { origin } = await serve({
      "/late": { status: 503, headers: HTML, body: late },
      "/json": { status: 503, headers: { "content-type": "application/json" }, body: '{"captcha-delivery":1}' },
    });
    for (const path of ["/late", "/json"]) {
      const error = await captureError(safeFetch(`${origin}${path}`, { accept: "page", policy: loopbackForTests }));
      expect(error.code, path).toBe("http_error");
      expect(error.httpStatus, path).toBe(503);
    }
  });

  it.each([404, 410, 500, 503])("gives http_error with the status for %i", async (status) => {
    const { origin } = await serve({ "/e": { status, headers: HTML, body: "erreur" } });
    const error = await captureError(safeFetch(`${origin}/e`, { accept: "page", policy: loopbackForTests }));
    expect(error.code).toBe("http_error");
    expect(error.httpStatus).toBe(status);
  });

  it.each([
    ["page", "application/json"],
    ["page", "image/png"],
    ["json", "text/html"],
    ["image", "text/html"],
    ["image", "image/svg+xml"],
    ["image", "image/svg+xml; charset=utf-8"],
    ["page", ""],
  ] as const)("gives invalid_data when %s receives %s", async (accept, contentType) => {
    const headers: Record<string, string> = contentType ? { "content-type": contentType } : {};
    const { origin } = await serve({ "/x": { headers, body: "{}" } });
    const error = await captureError(safeFetch(`${origin}/x`, { accept, policy: loopbackForTests }));
    expect(error.code).toBe("invalid_data");
  });

  it.each([
    ["page", "application/xhtml+xml"],
    ["json", "application/json; charset=utf-8"],
    ["json", "text/javascript"],
    ["image", "image/webp"],
    ["image", "IMAGE/JPEG"],
  ] as const)("accepts %s with %s", async (accept, contentType) => {
    const { origin } = await serve({ "/x": { headers: { "content-type": contentType }, body: "{}" } });
    const response = await safeFetch(`${origin}/x`, { accept, policy: loopbackForTests });
    expect(response.contentType).toBe(contentType);
  });

  it("refuses a lookup that returns [8.8.8.8, 10.0.0.1] with forbidden_address", async () => {
    const calls: string[] = [];
    const error = await captureError(
      safeFetch("http://shop.example/p", {
        accept: "page",
        policy: loopbackForTests,
        lookup: fakeLookup({ "shop.example": ["8.8.8.8", "10.0.0.1"] }, calls),
      }),
    );
    expect(error.code).toBe("forbidden_address");
    expect(calls).toEqual(["shop.example"]);
  });

  it("refuses a lookup that returns an IPv4-mapped loopback", async () => {
    const error = await captureError(
      safeFetch("https://shop.example/p", {
        accept: "page",
        lookup: fakeLookup({ "shop.example": ["2001:41d0::1", "::ffff:7f00:1"] }),
      }),
    );
    expect(error.code).toBe("forbidden_address");
  });

  it("connects to the address it vetted, resolving the host once", async () => {
    const { origin, hits } = await serve({ "/p": { headers: HTML, body: "épinglé" } });
    const port = new URL(origin).port;
    const calls: string[] = [];
    const response = await safeFetch(`http://boutique.test:${port}/p`, {
      accept: "page",
      policy: loopbackForTests,
      lookup: fakeLookup({ "boutique.test": ["127.0.0.1"] }, calls),
    });
    expect(response.body.toString()).toBe("épinglé");
    expect(response.finalUrl).toBe(`http://boutique.test:${port}/p`);
    expect(calls).toEqual(["boutique.test"]);
    expect(hits).toEqual(["/p"]);
  });

  it("refuses port 8080", async () => {
    const calls: string[] = [];
    const error = await captureError(
      safeFetch("http://shop.example:8080/p", {
        accept: "page",
        policy: loopbackForTests,
        lookup: fakeLookup({ "shop.example": ["51.38.1.1"] }, calls),
      }),
    );
    expect(error.code).toBe("forbidden_address");
  });

  it("sends the exact bot user agent, no cookie, and ignores set-cookie", async () => {
    const echo = await headerEcho();
    try {
      await safeFetch(`${echo.origin}/one`, { accept: "page", policy: loopbackForTests });
      await safeFetch(`${echo.origin}/two`, { accept: "page", policy: loopbackForTests });
      expect(echo.seen).toHaveLength(2);
      for (const headers of echo.seen) {
        expect(headers["user-agent"]).toBe("Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)");
        expect(headers.cookie).toBeUndefined();
      }
      expect(BOT_USER_AGENT).toBe("Mozilla/5.0 (compatible; ClosyriaBot/1.0; +https://closyria.com)");
    } finally {
      await echo.close();
    }
  });
});

describe("safeFetch URL rules", () => {
  it.each([
    ["ftp://shop.example/p", "a scheme other than http/https"],
    ["file:///etc/passwd", "file URLs"],
    ["http://user:pass@shop.example/p", "credentials"],
    ["http://user@shop.example/p", "a user name"],
    [`http://shop.example/${"a".repeat(2_030)}`, "more than 2 048 characters"],
    ["http://shop.example:22/p", "port 22"],
    ["https://shop.example:8443/p", "port 8443"],
    ["not a url", "something that is not a URL"],
  ])("refuses %s (%s) before any lookup", async (url) => {
    const calls: string[] = [];
    const error = await captureError(
      safeFetch(url, { accept: "page", lookup: fakeLookup({ "shop.example": ["51.38.1.1"] }, calls) }),
    );
    expect(error.code).toBe("forbidden_address");
    expect(calls).toEqual([]);
  });

  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0x7f.1/",
    "http://2130706433/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[64:ff9b::a00:1]/",
  ])("refuses the literal address %s without a lookup", async (url) => {
    const calls: string[] = [];
    const error = await captureError(safeFetch(url, { accept: "page", lookup: fakeLookup({}, calls) }));
    expect(error.code).toBe("forbidden_address");
    expect(calls).toEqual([]);
  });

  it("refuses a host whose lookup answers a private address under the default strict policy", async () => {
    const error = await captureError(
      safeFetch("http://localhost/", { accept: "page", lookup: fakeLookup({ localhost: ["127.0.0.1", "::1"] }) }),
    );
    expect(error.code).toBe("forbidden_address");
  });

  it("refuses, under the default strict policy, a port-80 host that resolves to 127.0.0.1", async () => {
    // Port 80 passes the URL rules: only the address check can refuse this one.
    const calls: string[] = [];
    const error = await captureError(
      safeFetch("http://boutique.test/p", {
        accept: "page",
        lookup: fakeLookup({ "boutique.test": ["127.0.0.1"] }, calls),
      }),
    );
    expect(error.code).toBe("forbidden_address");
    expect(calls).toEqual(["boutique.test"]);
  });

  it("turns a resolver that throws into http_error", async () => {
    const throwing = (() => {
      throw new Error("resolver exploded");
    }) as unknown as typeof dns.lookup;
    const error = await captureError(safeFetch("http://shop.example/", { accept: "page", lookup: throwing }));
    expect(error.code).toBe("http_error");
  });

  it("refuses a non-standard port under loopbackForTests unless the vetted address is 127.0.0.1", async () => {
    const error = await captureError(
      safeFetch("http://mixed.test:8080/", {
        accept: "page",
        policy: loopbackForTests,
        lookup: fakeLookup({ "mixed.test": ["127.0.0.1", "51.38.1.1"] }),
      }),
    );
    expect(error.code).toBe("forbidden_address");
  });

  it("gives http_error when the host does not resolve", async () => {
    const error = await captureError(safeFetch("http://nowhere.test/", { accept: "page", lookup: fakeLookup({}) }));
    expect(error.code).toBe("http_error");
  });

  describe("accept: text", () => {
    it.each(["text/plain", "text/plain; charset=utf-8", "TEXT/PLAIN;charset=ISO-8859-1"])(
      "accepts %s",
      async (type) => {
        const s = await serve({ "/robots.txt": { headers: { "content-type": type }, body: "User-agent: *" } });
        const res = await safeFetch(`${s.origin}/robots.txt`, { accept: "text", policy: loopbackForTests });
        expect(res.body.toString("utf8")).toBe("User-agent: *");
      },
    );

    it.each(["text/html", "application/json", "image/png"])("refuses %s", async (type) => {
      const s = await serve({ "/robots.txt": { headers: { "content-type": type }, body: "x" } });
      const error = await captureError(
        safeFetch(`${s.origin}/robots.txt`, { accept: "text", policy: loopbackForTests }),
      );
      expect(error.code).toBe("invalid_data");
    });
  });
});
