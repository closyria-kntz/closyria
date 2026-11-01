import type { BrowserContext } from "@playwright/test";

/** A `securitypolicyviolation` event, as reported by the browser (R17). */
export type CspViolation = {
  page: string;
  effectiveDirective: string;
  blockedURI: string;
  sourceFile: string;
  lineNumber: number;
  sample: string;
  disposition: string;
};

export type CspRecord = { test: string; project: string; violations: CspViolation[] };

const BINDING = "__closyriaCspViolation";

/**
 * Collects every CSP violation of the context's pages, across navigations. The CSP is Report-Only:
 * violations are listed in the suite's artefact, they never fail a test.
 */
export async function collectCspViolations(context: BrowserContext): Promise<CspViolation[]> {
  const violations: CspViolation[] = [];
  await context.exposeBinding(BINDING, ({ page }, violation: Omit<CspViolation, "page">) => {
    violations.push({ page: new URL(page.url()).pathname, ...violation });
  });
  await context.addInitScript((binding: string) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as Record<string, (v: unknown) => void>)[binding];
      report?.({
        effectiveDirective: event.effectiveDirective,
        blockedURI: event.blockedURI,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        sample: event.sample,
        disposition: event.disposition,
      });
    });
  }, BINDING);
  return violations;
}
