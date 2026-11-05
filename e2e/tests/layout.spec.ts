import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 13: the shell and the pages adapt to the screen (spec §4, « Adaptation aux écrans »).
const REM = 16;

async function openSheet(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
  await expect(page.getByRole("img", { name: PRODUCT.name }).first()).toBeVisible();
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
}

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("à 1440 px la fiche a deux colonnes, le menu latéral et un contenu large", async ({ page }) => {
    await openSheet(page);

    const side = page.getByRole("navigation", { name: "Menu principal" });
    await expect(side).toBeVisible();
    await expect(side.getByRole("link")).toHaveText([
      "Envies",
      "Commandé",
      "Dressing",
      "À vendre",
      "Listes",
      "Réglages",
    ]);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();

    const gallery = await box(page, "[data-testid=product-gallery]");
    const info = await box(page, "[data-testid=product-info]");
    expect(info.x).toBeGreaterThan(gallery.x + gallery.width - 1);
    expect(Math.abs(info.y - gallery.y)).toBeLessThan(2 * REM);
    const content = await box(page, "main > div");
    expect(content.width).toBeGreaterThan(60 * REM);
  });
});

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("à 390 px la barre d'onglets est en bas, la fiche sur une colonne", async ({ page }) => {
    await openSheet(page);

    const bar = page.getByRole("navigation", { name: "Onglets" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link")).toHaveText(["Envies", "Commandé", "Dressing"]);
    await expect(bar.getByRole("button", { name: "Plus" })).toBeVisible();
    const barBox = await box(page, "[data-testid=app-nav-bottom]");
    expect(barBox.y + barBox.height).toBeGreaterThan(844 - 2);
    for (const target of await bar.locator("a, button").all()) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    const gallery = await box(page, "[data-testid=product-gallery]");
    const info = await box(page, "[data-testid=product-info]");
    expect(info.y).toBeGreaterThan(gallery.y + gallery.height - 1);

    await bar.getByRole("button", { name: "Plus" }).click();
    await expect(page.getByRole("link", { name: "À vendre" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Listes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Réglages" })).toBeVisible();
  });
});

test.describe("820 px", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("à 820 px les onglets sont en haut", async ({ page }) => {
    await openSheet(page);

    const tabs = page.getByRole("navigation", { name: "Onglets" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveCount(6);
    expect((await box(page, "[data-testid=app-nav-top]")).y).toBeLessThan(6 * REM);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeHidden();
  });
});

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("« + Ajouter » ouvre le champ « Coller un lien » depuis la fiche", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("button", { name: "+ Ajouter" }).click();
    await expect(page.getByLabel("Coller un lien")).toBeVisible();
  });
});

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("la page d'accueil donne un champ confortable sur ordinateur", async ({ page }) => {
    await page.goto("/");
    const field = await page.getByLabel("Coller un lien").boundingBox();
    expect(field?.width ?? 0).toBeGreaterThan(32 * REM);
  });
});
