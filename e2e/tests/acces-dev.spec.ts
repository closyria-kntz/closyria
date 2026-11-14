import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { E2E_DEV_ACCESS_PASSWORD } from "../fixtures/dev-access";
import { expect, test } from "../fixtures/test";

// « Accès au site de test » (dev.closyria.com): the dev password, asked once per device, instead of the browser's
// password window that a home-screen web app on iPhone never shows.

const field = (page: Page) => page.getByLabel("Mot de passe du site de test");
const enter = (page: Page) => page.getByRole("button", { name: "Entrer" });

async function tryPassword(page: Page, password: string) {
  await field(page).fill(password);
  const answer = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/dev-access");
  await enter(page).click();
  return answer;
}

test("la page d'accès s'affiche sans session, en clair comme en sombre, sans rien demander à l'API", async ({
  page,
}, testInfo) => {
  // Before access, Caddy refuses every /api/* but /api/dev-access: the page must not need any (no session, no
  // audience event), nor the manifest (refused too). A request is the access page's when that page is its referrer
  // (the audience beacon sent as the page is left included).
  const called: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    const referer = req.headers().referer;
    const fromAccessPage = referer !== undefined && new URL(referer).pathname === "/acces-dev";
    const refused = (path.startsWith("/api/") && path !== "/api/dev-access") || path === "/manifest.webmanifest";
    if (fromAccessPage && refused) called.push(path);
  });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/acces-dev?suite=/articles");
    await expect(page.getByRole("heading", { level: 1, name: "Accès au site de test" })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("Closyria", { exact: true })).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(field(page)).toHaveAttribute("type", "password");
    await expect(field(page)).toHaveAttribute("autocomplete", "current-password");
    // A finger-wide field and button (44 px).
    for (const control of [field(page), enter(page)]) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const { violations } = await new AxeBuilder({ page }).analyze();
    for (const v of violations)
      testInfo.annotations.push({ type: `axe ${colorScheme} (${v.impact})`, description: v.id });
    expect(violations, colorScheme).toEqual([]);
  }
  // The audience tracker would send its batch 2 s after the page view (lib/track.ts): stay past that, then leave
  // through the form. (A beacon sent while a page unloads is not always seen by Playwright: the timer is.)
  await page.goto("/acces-dev?suite=/");
  await page.waitForTimeout(2_500);
  await field(page).fill(E2E_DEV_ACCESS_PASSWORD);
  await enter(page).click();
  await page.waitForURL((url) => url.pathname === "/");
  expect(called).toEqual([]);
  // Every other page keeps its manifest link.
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("crossorigin", "use-credentials");
});

test("un mauvais mot de passe le dit, le bon ouvre la page demandée (chemin et paramètres)", async ({ page }) => {
  await page.goto("/acces-dev?suite=/reglages/apparence?vue=liste&tri=prix");

  const wrong = await tryPassword(page, "pas-le-bon");
  expect(wrong.status()).toBe(401);
  // (Next's route announcer is an alert too.)
  await expect(page.getByRole("alert").filter({ hasText: "Mot de passe incorrect." })).toBeVisible();
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).pathname).toBe("/acces-dev");

  const right = await tryPassword(page, E2E_DEV_ACCESS_PASSWORD);
  expect(right.status()).toBe(204);
  const cookie = (await right.headerValue("set-cookie")) ?? "";
  expect(cookie).toMatch(/^closyria_dev_access=[0-9a-f]{64};/);
  for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=31536000"]) {
    expect(cookie).toContain(attribute);
  }
  await page.waitForURL((url) => url.pathname === "/reglages/apparence");
  expect(new URL(page.url()).search).toBe("?vue=liste&tri=prix");
});

test("le bon mot de passe ne mène jamais vers un autre site, ni en boucle sur la page d'accès", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL ?? "").origin;
  for (const suite of ["//evil.example/", "https://evil.example/", "%2F%2Fevil.example", "/acces-dev"]) {
    await page.goto(`/acces-dev?suite=${suite}`);
    expect((await tryPassword(page, E2E_DEV_ACCESS_PASSWORD)).status(), suite).toBe(204);
    await page.waitForURL((url) => url.origin === origin && url.pathname === "/");
  }
});

test("après 5 essais, la page demande d'attendre quelques minutes", async ({ page }) => {
  await page.goto("/acces-dev");
  for (let i = 0; i < 5; i++) expect((await tryPassword(page, `faux-${i}`)).status()).toBe(401);
  expect((await tryPassword(page, E2E_DEV_ACCESS_PASSWORD)).status()).toBe(429);
  await expect(
    page.getByRole("alert").filter({ hasText: "Trop d’essais : réessaie dans quelques minutes." }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/acces-dev");
});
