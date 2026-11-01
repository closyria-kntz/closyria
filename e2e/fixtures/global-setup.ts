import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import type { CspRecord } from "./csp";
import { BROWSER_AUTH_BUNDLE, CSP_DIR, CSP_REPORT, REPORTS_DIR, SERVER_LOG } from "./paths";
import { startStack } from "./stack";

/** Starts the stack once for the whole run; the returned function is the global teardown. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  await rm(CSP_DIR, { recursive: true, force: true });
  await rm(CSP_REPORT, { force: true });
  await mkdir(CSP_DIR, { recursive: true });

  await build({
    entryPoints: [join(import.meta.dirname, "browser-auth.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile: BROWSER_AUTH_BUNDLE,
    logLevel: "error",
  });

  const stack = await startStack(SERVER_LOG);
  // Inherited by the test workers, which start after the global setup.
  process.env.E2E_BASE_URL = stack.baseUrl;
  process.env.E2E_DATABASE_URL = stack.databaseUrl;

  return async () => {
    await stack.stop();
    await writeCspReport();
  };
}

/** Merges the per-test CSP files into one artefact. Report-Only: listed, never a failure (R17). */
async function writeCspReport(): Promise<void> {
  const records: CspRecord[] = [];
  for (const file of (await readdir(CSP_DIR)).sort()) {
    records.push(JSON.parse(await readFile(join(CSP_DIR, file), "utf8")) as CspRecord);
  }
  const byDirective: Record<string, number> = {};
  for (const violation of records.flatMap((record) => record.violations)) {
    byDirective[violation.effectiveDirective] = (byDirective[violation.effectiveDirective] ?? 0) + 1;
  }
  const total = Object.values(byDirective).reduce((sum, n) => sum + n, 0);
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(CSP_REPORT, `${JSON.stringify({ total, byDirective, tests: records }, null, 2)}\n`);
}
