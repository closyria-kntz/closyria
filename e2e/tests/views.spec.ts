import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 15: the four views, filters in the address, multi-select with « Annuler », account prompt.

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function keepFavorite(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });

test("un article gardé apparaît dans Envies, l'onglet courant est marqué, et la vue vide propose de coller un lien", async ({
  page,
}) => {
  await keepFavorite(page);
  await page.goto("/envies");
  await expect(page.getByRole("heading", { level: 1, name: "Envies" })).toBeVisible();
  const card = page.getByTestId("item-card").first();
  await expect(card).toContainText(PRODUCT.name);
  await expect(card.getByRole("button", { name: "Niveau : J’aime. Toucher pour changer" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: /Menu principal|Onglets/ }).filter({ visible: true });
  await expect(nav.locator("[aria-current=page]")).toHaveText("Envies");

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  await card.getByRole("link").click();
  await expect(page).toHaveURL(/\/produits\//);

  await page.goto("/dressing");
  await expect(page.getByRole("heading", { name: "Ton dressing est vide" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Coller un lien" })).toBeVisible();
});

test("les filtres vivent dans l'adresse et le bouton Précédent les restaure", async ({ page }) => {
  await keepFavorite(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Filtres" }).click();
  await page.getByLabel("Trier par").selectOption("price_asc");
  await expect(page).toHaveURL(/tri=price_asc/);
  await page.getByLabel("Étape").selectOption("sold");
  await expect(page).toHaveURL(/etape=sold/);
  await expect(page.getByRole("heading", { name: "Aucun article ne correspond" })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/etape=sold/);
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await page.getByLabel("Trier par").selectOption("love");
  await expect(page).toHaveURL(/tri=love/);
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  // The « Favoris seulement » filter is gone (levels replace it): an old address still shows everything.
  await page.goto("/envies?favori=1");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByLabel("Favoris seulement")).toHaveCount(0);
});

// The cards lost their checkbox (Envies chaleureuses task 7); task 8 brings the selection back with « Sélectionner »
// and rewrites this journey.
test.fixme("sélection multiple : changer l'étape, puis Annuler", async ({ page }) => {
  await keepFavorite(page);
  await page.goto("/envies");
  await page.getByRole("checkbox", { name: new RegExp(`Sélectionner ${PRODUCT.name}`) }).check();
  const bar = page.getByRole("region", { name: "Actions sur la sélection" });
  await expect(bar).toContainText("1 article choisi");
  await bar.getByRole("button", { name: "Étape" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reçu" }).click();
  await expect(toast(page)).toContainText("passé à « Reçu »");
  await expect(page.getByTestId("item-card")).toHaveCount(0);

  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(1);

  await page.getByRole("checkbox", { name: new RegExp(`Sélectionner ${PRODUCT.name}`) }).check();
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Supprimer" })
    .click();
  await expect(toast(page)).toContainText("supprimé");
  await expect(page.getByTestId("item-card")).toHaveCount(0);
});

test("la grille a 2, 3 ou 5 colonnes selon l'écran", async ({ page }, testInfo) => {
  await keepFavorite(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  const columns = await page
    .getByTestId("item-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  const expected = { "iPhone 15": 2, "iPad (gen 7)": 3, "Desktop Chrome": 5 }[testInfo.project.name];
  expect(columns).toBe(expected);
});

test("la 1re photo ajoutée propose un compte, la proposition se ferme sans bloquer", async ({ page }, testInfo) => {
  await keepFavorite(page);
  await page.getByRole("button", { name: "Ajouter une photo" }).click();
  await page.getByTestId("photo-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PIXEL });
  const banner = page.getByRole("region", { name: "Proposition de compte" });
  await expect(banner).toContainText("Garde tes articles");
  await expect(banner.getByRole("link", { name: "Créer mon compte" })).toHaveAttribute(
    "href",
    /^\/connexion\?next=%2Fproduits%2F/,
  );
  await page.screenshot({ path: testInfo.outputPath("prompt.png"), fullPage: true });
  await banner.getByRole("button", { name: "Plus tard" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Ajouter une photo" }).click();
  await page.getByTestId("photo-input").setInputFiles({ name: "p2.png", mimeType: "image/png", buffer: PIXEL });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("img").first()).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("retirer le ♡ d'une simple envie ne la retire jamais (spec §4)", async ({ page }) => {
  await keepFavorite(page);
  await page.getByRole("button", { name: "Favori", exact: true }).click();
  await expect(toast(page)).toContainText("Retiré des favoris");
  await expect(toast(page)).not.toContainText("Retiré de tes envies");
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Donner un niveau" })).toBeVisible();
});

test("retirer le ♡ d'une envie rangée dans une liste ne retire que le favori", async ({ page }) => {
  await keepFavorite(page);
  await page.getByLabel("Nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer et ajouter" }).and(page.locator(":enabled")).click();
  await expect(toast(page)).toContainText("Ajouté à Été");
  await page.getByRole("button", { name: "Favori", exact: true }).click();
  await expect(toast(page)).toContainText("Retiré des favoris");
  await expect(toast(page)).not.toContainText("Retiré de tes envies");
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
});

// Task 8 (« Sélectionner »): no way to select a card until then.
test.fixme("téléphone : la barre de sélection reste juste au-dessus du toast et des onglets (cadre fixe)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await keepFavorite(page);
  await page.goto("/envies");
  await page.getByRole("checkbox", { name: new RegExp(`Sélectionner ${PRODUCT.name}`) }).check();
  const bar = page.getByRole("region", { name: "Actions sur la sélection" });
  await expect(bar).toBeVisible();
  await page.evaluate(() => {
    const main = document.getElementById("app-content");
    if (main) main.scrollTop = 0;
  });
  const barBox = await bar.boundingBox();
  const tabs = await page.getByTestId("app-nav-bottom").boundingBox();
  const gap = (tabs?.y ?? 0) - ((barBox?.y ?? 0) + (barBox?.height ?? 0));
  // Room for the undo toast (4rem above the window's bottom, 3rem high) and no more: the content area already ends
  // above the tabs.
  expect(gap).toBeGreaterThanOrEqual(7 * 16 - (tabs?.height ?? 0));
  expect(gap).toBeLessThanOrEqual(4 * 16);
});
