import type dns from "node:dns";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createDb } from "@closyria/db";
import { fsStore } from "@closyria/storage";
import { type FakeRoute, type FakeShop, startFakeShop } from "@closyria/testing";
import { registerCaptureQueues } from "@closyria/worker/capture";
import { loopbackForTests } from "@closyria/worker/capture/testing";
import { PgBoss } from "pg-boss";
import { LOOPBACK_NAME_SUFFIX, PRODUCT_PATH } from "./shops";
import { ROOT } from "./stack";

const FIXTURES = join(ROOT, "packages/extract/fixtures");

// 1×1 PNG: every photo of the recorded pages (the worker turns it into WebP).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Points every absolute address of a recorded page at the fake shop (the recordings reference real CDNs),
 * schema.org and www.w3.org aside (vocabularies, never fetched). JSON recordings escape slashes (`\/\/cdn…`);
 * unescaped they are still valid JSON. Same rewrite as run-capture.integration.test.ts.
 */
function localAddresses(text: string, origin: string, routes: Record<string, FakeRoute>): string {
  const seen = new Map<string, number>();
  return text
    .replaceAll("\\/", "/")
    .replace(/(?:https?:)?\/\/(?!127\.0\.0\.1|schema\.org|www\.w3\.org)[^"'\s<>\\]+/g, (match) => {
      if (!seen.has(match)) seen.set(match, seen.size);
      const path = `/img/${seen.get(match)}.png`;
      routes[path] = { headers: { "content-type": "image/png" }, body: PNG };
      return `${origin}${path}`;
    });
}

/**
 * Only 127.0.0.1, on any port: what loopbackForTests allows, minus the public Internet it also allows (an
 * address left unrewritten fails the capture instead of leaving the machine).
 */
const loopbackOnly = Object.freeze(
  Object.assign((ip: string): boolean => ip === "127.0.0.1" && loopbackForTests(ip), {
    anyPortOnLoopback: true as const,
  }),
);

/** No DNS: the suite's loopback names (`*.e2e.test`) are 127.0.0.1, every other name fails. */
const loopbackNames = ((
  host: string,
  _options: unknown,
  callback: (error: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void,
) => {
  if (host.toLowerCase().endsWith(LOOPBACK_NAME_SUFFIX)) return callback(null, [{ address: "127.0.0.1", family: 4 }]);
  callback(Object.assign(new Error(`no DNS in the browser tests: ${host}`), { code: "ENOTFOUND" }), []);
}) as unknown as typeof dns.lookup;

export type CaptureWorker = { shop: FakeShop; stop(): Promise<void> };

/**
 * The capture worker of the browser tests, in the Playwright process: pg-boss on the test database (the
 * API queues there), the real capture queues with photos in `storageDir` (the API serves them from the same
 * directory), and the fake shop serving the recorded MCB Paris product (page and `.js`). No robots.txt
 * route: 404, so everything is allowed. No spacing between requests: the production 2 s per shop would
 * make the parallel tests wait on each other for one local shop.
 */
export async function startCaptureWorker(databaseUrl: string, storageDir: string): Promise<CaptureWorker> {
  const routes: Record<string, FakeRoute> = {};
  const shop = await startFakeShop(routes);
  const cleanups: (() => Promise<unknown>)[] = [() => shop.close()];
  const stop = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
  };
  try {
    const [page, js] = await Promise.all([
      readFile(join(FIXTURES, "real/mcb-paris.html"), "utf8"),
      readFile(join(FIXTURES, "real/mcb-paris.js.json"), "utf8"),
    ]);
    routes[PRODUCT_PATH] = {
      headers: { "content-type": "text/html; charset=utf-8" },
      // The rewrite removes the CDN marker of Shopify pages: put one back, so a shop of unknown platform
      // (the admin's new shop) is read through the `.js` like a known Shopify shop.
      body: `${localAddresses(page, shop.origin, routes)}<script>Shopify.shop = "e2e";</script>`,
    };
    routes[`${PRODUCT_PATH}.js`] = {
      headers: { "content-type": "application/json; charset=utf-8" },
      body: localAddresses(js, shop.origin, routes),
    };

    const { db, pool } = createDb(databaseUrl, { max: 4 });
    cleanups.push(() => pool.end());
    const boss = new PgBoss({ connectionString: databaseUrl, max: 4 });
    boss.on("error", (error) => console.error("e2e capture worker, pg-boss error:", error));
    await boss.start();
    cleanups.push(() => boss.stop({ graceful: false, timeout: 5_000 }));
    await registerCaptureQueues(boss, {
      db,
      store: fsStore(storageDir),
      policy: loopbackOnly,
      lookup: loopbackNames,
      throttle: { wait: async () => {} },
    });
    return { shop, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
