import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures/test";

test("la page d'accueil s'affiche sans violation d'accessibilité grave", async ({ page }, testInfo) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/Closyria/);

  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }));
  // Minor and moderate findings are listed in the report; serious and critical ones fail the test.
  for (const v of summary) testInfo.annotations.push({ type: `axe (${v.impact})`, description: `${v.id}: ${v.help}` });
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(summary.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

test("la page d'accueil envoie les en-têtes de sécurité de la tâche 13", async ({ page }) => {
  const response = await page.goto("/");
  const headers = (await response?.allHeaders()) ?? {};
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
  const csp = headers["content-security-policy-report-only"] ?? "";
  expect(csp.split(";").map((d) => d.trim())).toContain("frame-ancestors 'none'");
  // Only framing is enforced: a full enforced CSP would block Next's inline bootstrap (task 13).
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
});
