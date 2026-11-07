import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 15: the four views, filters in the address, multi-select with « Annuler », account prompt.
// Envies chaleureuses, task 8: « Sélectionner », level and « Prioritaires » filters, « Ce que j’aime le plus ».

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function pasteAndWish(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};

test("un article gardé apparaît dans Envies, l'onglet courant est marqué, et la vue vide propose de coller un lien", async ({
  page,
}) => {
  await pasteAndWish(page);
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
  await pasteAndWish(page);
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

const bar = (page: Page) => page.getByRole("region", { name: "Actions sur la sélection" });
/** In « Sélectionner » mode each card is one toggle button (its text: the item). */
const pick = (page: Page, index: number) =>
  page.getByTestId("item-card").nth(index).getByRole("button", { name: PRODUCT.name });

test("Sélectionner : deux articles passent En feu, Annuler ; filtres par niveau, Prioritaires, tri « Ce que j’aime le plus »", async ({
  page,
}, testInfo) => {
  await pasteAndWish(page);
  await pasteAndWish(page);
  await pasteAndWish(page);
  await page.goto("/envies");
  const cards = page.getByTestId("item-card");
  await expect(cards).toHaveCount(3);

  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  // A tap toggles the selection: no pill nor « … » to catch it.
  await expect(cards.first().getByRole("button", { name: "Plus d’actions" })).toHaveCount(0);
  await expect(cards.first().getByRole("button", { name: /niveau/i })).toHaveCount(0);
  await expect(cards.first().getByRole("link")).toHaveCount(0);
  // The level badge is display-only: a tap on it goes through to the card.
  const badge = cards.nth(2).getByText("J’aime", { exact: true });
  await badge.click({ force: true });
  await expect(pick(page, 2)).toHaveAttribute("aria-pressed", "true");
  await badge.click({ force: true });
  await expect(pick(page, 2)).toHaveAttribute("aria-pressed", "false");
  await pick(page, 0).click();
  await pick(page, 1).click();
  await expect(pick(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(pick(page, 2)).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page)).toContainText("2 sélectionnés");
  await page.screenshot({ path: testInfo.outputPath("select.png") });
  await axe(page);

  const setFire = async () => {
    await bar(page).getByRole("button", { name: "Niveau", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Donner un niveau" });
    await expect(dialog.getByRole("button", { name: "Aucun" })).toBeVisible();
    await dialog.getByRole("button", { name: "En feu" }).click();
    await expect(toast(page)).toContainText("Niveau « En feu » pour 2 articles");
  };
  await setFire();
  await expect(cards.filter({ hasText: "En feu" })).toHaveCount(2);
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(cards.filter({ hasText: "En feu" })).toHaveCount(0);
  await expect(cards.filter({ hasText: "J’aime" })).toHaveCount(3);

  await pick(page, 0).click();
  await pick(page, 1).click();
  await setFire();
  await expect(cards.filter({ hasText: "En feu" })).toHaveCount(2);

  // One « Prioritaire » among the « J’aime ».
  await cards.filter({ hasText: "J’aime" }).getByRole("button", { name: PRODUCT.name }).click();
  await expect(bar(page)).toContainText("1 sélectionné");
  await bar(page).getByRole("button", { name: "Prioritaire", exact: true }).click();
  await page.getByRole("dialog", { name: "Prioritaire" }).getByRole("button", { name: "Marquer prioritaire" }).click();
  await expect(toast(page)).toContainText("1 article prioritaire");
  await expect(cards.filter({ hasText: "Prioritaire" })).toHaveCount(1);

  // « Terminé » leaves the mode: the pills and « … » come back.
  await page.getByRole("button", { name: "Terminé" }).click();
  await expect(cards.first().getByRole("button", { name: "Plus d’actions" })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);

  // Level chips (several at once) and « Prioritaires », in the address.
  const levels = page.getByRole("group", { name: "Niveau" });
  await levels.getByRole("button", { name: "En feu" }).click();
  await expect(page).toHaveURL(/niveau=4(&|$)/);
  await expect(cards).toHaveCount(2);
  await expect(levels.getByRole("button", { name: "En feu" })).toHaveAttribute("aria-pressed", "true");
  await levels.getByRole("button", { name: "J’aime" }).click();
  await expect(page).toHaveURL(/niveau=4,2/);
  await expect(cards).toHaveCount(3);
  await levels.getByRole("button", { name: "En feu" }).click();
  await expect(page).toHaveURL(/niveau=2(&|$)/);
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "Prioritaires" }).click();
  await expect(page).toHaveURL(/prioritaire=1/);
  await expect(cards).toHaveCount(1);
  await levels.getByRole("button", { name: "J’aime" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Prioritaire");
  await axe(page);

  // « Ce que j’aime le plus »: the « En feu » first, then the « J’aime » (the priority one before the other).
  await page.goto("/envies");
  await page.getByLabel("Trier par").selectOption({ label: "Ce que j’aime le plus" });
  await expect(page).toHaveURL(/tri=love/);
  await expect(cards.nth(0)).toContainText("En feu");
  await expect(cards.nth(1)).toContainText("En feu");
  await expect(cards.nth(2)).toContainText("J’aime");
});

test("Sélectionner : changer l'étape puis Annuler ; Échap quitte le mode", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await pick(page, 0).click();
  await expect(bar(page)).toContainText("1 sélectionné");
  await bar(page).getByRole("button", { name: "Étape" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reçu" }).click();
  await expect(toast(page)).toContainText("passé à « Reçu »");
  await expect(page.getByTestId("item-card")).toHaveCount(0);

  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await pick(page, 0).click();
  await expect(bar(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sélectionner", exact: true })).toBeVisible();
  await expect(page.getByTestId("item-card").first().getByRole("button", { name: "Plus d’actions" })).toBeVisible();
});

test("Sélectionner : déplacer deux articles vers un profil, les ajouter à une liste, les supprimer, chaque fois Annuler", async ({
  page,
}) => {
  await pasteAndWish(page);
  await pasteAndWish(page);
  await pasteAndWish(page);
  await page.goto("/reglages/profils");
  const add = page.getByRole("form", { name: "Nouveau profil" });
  await add.getByLabel("Nom").fill("Léa");
  await add.getByLabel("Public").selectOption("child");
  await add.getByLabel("Précision").selectOption("girl");
  await add.getByRole("button", { name: "Ajouter un profil" }).click();
  await expect(toast(page)).toContainText("Profil « Léa » ajouté");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été » créée");
  const listHolds = async (count: number) => {
    await page.goto("/listes");
    await page.getByRole("link", { name: /Été/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Été" })).toBeVisible();
    if (count === 0) await expect(page.getByRole("heading", { name: "Cette liste est vide" })).toBeVisible();
    else await expect(page.getByTestId("item-card")).toHaveCount(count);
  };

  await page.goto("/envies");
  const cards = page.getByTestId("item-card");
  await expect(cards).toHaveCount(3);
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  const pickTwo = async () => {
    await pick(page, 0).click();
    await pick(page, 1).click();
    await expect(bar(page)).toContainText("2 sélectionnés");
  };

  // Profile.
  await pickTwo();
  await bar(page).getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("dialog", { name: "Déplacer vers un profil" }).getByRole("button", { name: "Léa" }).click();
  await expect(toast(page)).toContainText("2 articles déplacés vers Léa");
  await expect(cards).toHaveCount(1);
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(cards).toHaveCount(3);

  // List.
  await pickTwo();
  await bar(page).getByRole("button", { name: "Liste", exact: true }).click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("2 articles ajoutés à Été");
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(toast(page)).toContainText("C’est annulé.");
  await listHolds(0);
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await pickTwo();
  await bar(page).getByRole("button", { name: "Liste", exact: true }).click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("2 articles ajoutés à Été");
  await listHolds(2);

  // Delete.
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await pickTwo();
  await bar(page).getByRole("button", { name: "Supprimer" }).click();
  await expect(toast(page)).toContainText("2 articles supprimés");
  await expect(cards).toHaveCount(1);
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(cards).toHaveCount(3);
});

test("la grille a 2, 3 ou 5 colonnes selon l'écran", async ({ page }, testInfo) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  const columns = await page
    .getByTestId("item-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  const expected = { "iPhone 15": 2, "iPad (gen 7)": 3, "Desktop Chrome": 5 }[testInfo.project.name];
  expect(columns).toBe(expected);
});

test("la 1re photo ajoutée propose un compte, la proposition se ferme sans bloquer", async ({ page }, testInfo) => {
  await pasteAndWish(page);
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

test("retirer le niveau d'une simple envie ne la retire jamais (spec §4)", async ({ page }) => {
  await pasteAndWish(page);
  await page.getByRole("group", { name: "Tu l’aimes comment ?" }).getByRole("button", { name: "J’aime" }).click();
  await expect(toast(page)).toContainText("Niveau retiré");
  await expect(toast(page)).not.toContainText("Retiré de tes envies");
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Donner un niveau" })).toBeVisible();
});

test("retirer le niveau d'une envie rangée dans une liste ne retire que le niveau", async ({ page }) => {
  await pasteAndWish(page);
  await page.getByLabel("Nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer et ajouter" }).and(page.locator(":enabled")).click();
  await expect(toast(page)).toContainText("Ajouté à Été");
  await page.getByRole("group", { name: "Tu l’aimes comment ?" }).getByRole("button", { name: "J’aime" }).click();
  await expect(toast(page)).toContainText("Niveau retiré");
  await expect(toast(page)).not.toContainText("Retiré de tes envies");
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
});

test("téléphone : la barre de sélection reste juste au-dessus du toast et des onglets (cadre fixe)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await pasteAndWish(page);
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await pick(page, 0).click();
  const selection = bar(page);
  await expect(selection).toBeVisible();
  await page.evaluate(() => {
    const main = document.getElementById("app-content");
    if (main) main.scrollTop = 0;
  });
  const barBox = await selection.boundingBox();
  const tabs = await page.getByTestId("app-nav-bottom").boundingBox();
  const gap = (tabs?.y ?? 0) - ((barBox?.y ?? 0) + (barBox?.height ?? 0));
  // Room for the undo toast (4rem above the window's bottom, 3rem high) and no more: the content area already ends
  // above the tabs.
  expect(gap).toBeGreaterThanOrEqual(7 * 16 - (tabs?.height ?? 0));
  expect(gap).toBeLessThanOrEqual(4 * 16);
});
