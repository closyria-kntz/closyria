import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, MANUAL_SHOP, manualProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 1, task 14: a pasted link becomes a product sheet. The capture worker runs in the Playwright
// process against the fake shop (capture-worker.ts); neither it nor the browser ever reaches the Internet.

/** The capture target of the spec: name, price, sizes and a photo in under 5 s. */
const CAPTURE_BUDGET_MS = 5_000;

async function paste(page: Page, url: string): Promise<void> {
  await page.getByLabel("Coller un lien").fill(url);
  await page.getByRole("button", { name: "Ajouter" }).click();
}

/** The whole captured sheet: name, price, sizes and at least one photo actually loaded. */
async function expectCapturedSheet(page: Page, timeout: number): Promise<void> {
  const sheet = page.getByRole("article");
  await expect(sheet.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout });
  await expect(sheet.getByText(PRODUCT.price)).toBeVisible({ timeout });
  const sizes = sheet.getByRole("region", { name: "Tailles" }).getByRole("listitem");
  await expect(sizes).toHaveText([...PRODUCT.sizes], { timeout });
  const photo = sheet.getByRole("img", { name: PRODUCT.name }).first();
  await expect(photo).toBeVisible({ timeout });
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { timeout })
    .toBe(true);
}

test("coller le lien d'un article Shopify affiche nom, prix, tailles et photo en moins de 5 s", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const started = Date.now();
  await paste(page, autoProductUrl());
  await expectCapturedSheet(page, CAPTURE_BUDGET_MS);
  const elapsed = Date.now() - started;
  testInfo.annotations.push({ type: "capture (ms)", description: String(elapsed) });
  expect(elapsed).toBeLessThan(CAPTURE_BUDGET_MS);
  await expect(page).toHaveURL(/\/produits\/[0-9a-f-]{36}\?capture=[0-9a-f-]{36}$/);
});

test("une boutique en mode manuel propose le formulaire, et la fiche s'affiche après saisie", async ({ page }) => {
  await page.goto("/");
  await paste(page, manualProductUrl());
  await expect(
    page.getByText(`${MANUAL_SHOP.name} ne permet pas la lecture automatique. Complète la fiche en quelques secondes.`),
  ).toBeVisible();
  await page.getByLabel("Nom de l’article").fill("Robe en lin");
  await page.getByLabel("Prix (en euros)").fill("49,90");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();

  const sheet = page.getByRole("article");
  await expect(sheet.getByRole("heading", { level: 1, name: "Robe en lin" })).toBeVisible();
  await expect(sheet.getByText(/^49,90\s€$/)).toBeVisible();
  await expect(page.getByLabel("Nom de l’article")).toHaveCount(0);
});

test("un partage Android dont le lien est dans le texte ouvre la fiche", async ({ page }) => {
  await page.goto(`/partager?text=Regarde%20${encodeURIComponent(autoProductUrl())}`);
  await expect(page).toHaveURL(/\/produits\/[0-9a-f-]{36}\?capture=/);
  await expectCapturedSheet(page, 10_000);
});

test("la fiche capturée n'a aucune violation d'accessibilité", async ({ page }, testInfo) => {
  await page.goto("/");
  await paste(page, autoProductUrl());
  await expectCapturedSheet(page, 10_000);
  await expect(page.getByRole("article")).not.toHaveAttribute("aria-busy", /.*/);

  const { violations } = await new AxeBuilder({ page }).analyze();
  await testInfo.attach("axe-violations.json", {
    body: JSON.stringify(violations, null, 2),
    contentType: "application/json",
  });
  expect(violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length }))).toEqual([]);
});

test("l'accueil rappelle les derniers liens collés, ✕ en retire un, et une fiche gardée n'y figure plus", async ({
  page,
}) => {
  await page.goto("/");
  await paste(page, autoProductUrl());
  await expectCapturedSheet(page, 10_000);

  await page.goto("/");
  const recents = page.getByRole("region", { name: "Derniers liens" });
  const card = recents.getByRole("link", { name: new RegExp(PRODUCT.name) });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\S/);
  const thumbnail = card.locator("img");
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);

  await recents.getByRole("button", { name: `Retirer ${PRODUCT.name} de la liste` }).click();
  await expect(recents).toHaveCount(0);

  // Pasted again then kept (♡): it is in her dressing, not in the recents.
  await paste(page, autoProductUrl());
  await expectCapturedSheet(page, 10_000);
  await page.getByRole("button", { name: /Favori/ }).click();
  await expect(page.getByRole("button", { name: /Favori/ })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Coller un lien" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Derniers liens" })).toHaveCount(0);
});
