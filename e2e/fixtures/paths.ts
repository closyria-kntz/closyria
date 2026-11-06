import { join } from "node:path";

/** Everything the suite writes for humans and CI artefacts (gitignored). */
export const REPORTS_DIR = join(import.meta.dirname, "../reports");
/** One JSON file per test, merged into CSP_REPORT by the global teardown (R17). */
export const CSP_DIR = join(REPORTS_DIR, "csp");
export const CSP_REPORT = join(REPORTS_DIR, "csp-violations.json");
export const SERVER_LOG = join(REPORTS_DIR, "servers.log");
export const BROWSER_AUTH_BUNDLE = join(REPORTS_DIR, "browser-auth.js");

/** A variable the global setup sets for the test workers. */
export function setupValue(
  name: "E2E_BASE_URL" | "E2E_DATABASE_URL" | "E2E_FAKE_SHOP_URL" | "E2E_STORAGE_DIR",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run the suite with playwright test (global setup)`);
  return value;
}
