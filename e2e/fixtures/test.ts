import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test as base, devices, expect, type Route } from "@playwright/test";
import pg from "pg";
import { type CspRecord, collectCspViolations } from "./csp";
import { BROWSER_AUTH_BUNDLE, CSP_DIR, setupValue } from "./paths";
import { CLIENT_IP_HEADER } from "./proxy";

type Fixtures = { userAgentTag: string; discovery: boolean };
type WorkerFixtures = { db: pg.Pool; browserAuthScript: string };

let clientCounter = 0;

/**
 * The suite's `test`:
 * - every test is a distinct visitor (own client address through the proxy, own user agent tag), so the
 *   database rows of one test can be found without seeing the others' (`userAgentTag`);
 * - every page gets the browser auth helpers (`window.closyriaE2E`, see browser-auth.ts);
 * - every test's CSP violations are written for the suite's artefact (R17);
 * - no request leaves the stack's origin: they are aborted, and the test fails;
 * - the first-opening discovery (refonte Boudoir, task 7) is counted as seen, so its dialog never covers the pages a
 *   journey visits: the read of `/api/me/preferences` answers `onboardedAt` (a visitor without a session yet has
 *   no account to mark). `test.use({ discovery: true })` leaves the real answers (onboarding.spec.ts).
 */
export const test = base.extend<Fixtures, WorkerFixtures>({
  baseURL: async ({}, use) => use(setupValue("E2E_BASE_URL")),
  userAgentTag: async ({}, use, testInfo) =>
    use(`closyria-e2e/${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`),
  userAgent: async ({ userAgentTag }, use, testInfo) => {
    const deviceAgent = testInfo.project.use.userAgent ?? devices["Desktop Chrome"].userAgent;
    await use(`${deviceAgent} ${userAgentTag}`);
  },
  extraHTTPHeaders: async ({}, use, testInfo) => {
    const n = ++clientCounter;
    await use({ [CLIENT_IP_HEADER]: `10.${testInfo.workerIndex % 250}.${(n >> 8) % 250}.${(n % 250) + 1}` });
  },
  discovery: [false, { option: true }],
  context: async ({ context, browserAuthScript, baseURL, discovery }, use, testInfo) => {
    // No Internet: anything but the stack's own origin is aborted, and a test that tried fails.
    const origin = new URL(baseURL ?? setupValue("E2E_BASE_URL")).origin;
    const outside: string[] = [];
    await context.route(
      (url) => (url.protocol === "http:" || url.protocol === "https:") && url.origin !== origin,
      (route) => {
        outside.push(route.request().url());
        return route.abort("blockedbyclient");
      },
    );
    await context.addInitScript({ content: browserAuthScript });
    const isPreferences = (url: URL) => url.origin === origin && url.pathname === "/api/me/preferences";
    let preferences: ((route: Route) => Promise<void>) | null = null;
    // Set once the test is over: a read still on its way then ends with « Test ended », nothing to answer.
    let ended = false;
    if (!discovery) {
      preferences = async (route: Route) => {
        if (route.request().method() !== "GET") return route.continue();
        const seen = { seenTips: [] as string[], onboardedAt: "2026-01-01T00:00:00.000Z" };
        try {
          const response = await route.fetch();
          if (response.status() === 401) return await route.fulfill({ status: 200, json: seen });
          const body = (await response.json()) as { seenTips: string[]; onboardedAt: string | null };
          return await route.fulfill({
            response,
            json: { ...body, onboardedAt: body.onboardedAt ?? seen.onboardedAt },
          });
        } catch (error) {
          // The page went on (a redirect, the next goto) while this read was on its way: nothing to answer. Any
          // other failure is the test's (the end of the test is handled after `use`, below).
          if (ended || /disposed|closed/i.test(String(error))) return;
          throw error;
        }
      };
      await context.route(isPreferences, preferences);
    }
    const violations = await collectCspViolations(context);
    await use(context);
    // The test is over, the page may still be reading (the product page asks for the preferences as it opens): that
    // handler takes no new read, and the one still on its way is let go when the context closes with « Test ended »
    // (Playwright's `unroute` has no per-route `ignoreErrors`, hence `ended`). The « no Internet » route stays until
    // the context closes.
    ended = true;
    if (preferences) await context.unroute(isPreferences, preferences);
    expect(outside, "requests outside the test stack").toEqual([]);
    const record: CspRecord = { test: testInfo.titlePath.join(" › "), project: testInfo.project.name, violations };
    const file = `${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}.json`;
    await writeFile(join(CSP_DIR, file), JSON.stringify(record));
    if (violations.length > 0) {
      await testInfo.attach("csp-violations.json", {
        body: JSON.stringify(violations, null, 2),
        contentType: "application/json",
      });
    }
  },
  browserAuthScript: [async ({}, use) => use(await readFile(BROWSER_AUTH_BUNDLE, "utf8")), { scope: "worker" }],
  db: [
    async ({}, use) => {
      const pool = new pg.Pool({ connectionString: setupValue("E2E_DATABASE_URL"), max: 2 });
      await use(pool);
      await pool.end();
    },
    { scope: "worker" },
  ],
});

export { expect };
