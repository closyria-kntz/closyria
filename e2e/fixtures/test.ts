import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test as base, devices, expect } from "@playwright/test";
import pg from "pg";
import { type CspRecord, collectCspViolations } from "./csp";
import { BROWSER_AUTH_BUNDLE, CSP_DIR, setupValue } from "./paths";
import { CLIENT_IP_HEADER } from "./proxy";

type Fixtures = { userAgentTag: string };
type WorkerFixtures = { db: pg.Pool; browserAuthScript: string };

let clientCounter = 0;

/**
 * The suite's `test`:
 * - every test is a distinct visitor (own client address through the proxy, own user agent tag), so the
 *   database rows of one test can be found without seeing the others' (`userAgentTag`);
 * - every page gets the browser auth helpers (`window.closyriaE2E`, see browser-auth.ts);
 * - every test's CSP violations are written for the suite's artefact (R17).
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
  context: async ({ context, browserAuthScript }, use, testInfo) => {
    await context.addInitScript({ content: browserAuthScript });
    const violations = await collectCspViolations(context);
    await use(context);
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
