import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, keepWish, manualProductUrl, PRODUCT } from "../fixtures/shops";
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
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
/** The colour a token resolves to, as computed styles report it. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};

test("un article gardé apparaît dans Envies, l'onglet courant est marqué, et la vue vide propose de coller un lien", async ({
  page,
}) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await expect(page.getByRole("heading", { level: 1, name: "Mes articles" })).toBeVisible();
  const card = page.getByTestId("item-card").first();
  await expect(card).toContainText(PRODUCT.name);
  await expect(card.getByRole("button", { name: "Niveau : J’aime. Toucher pour changer" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Menu principal" });
  await expect(nav.locator("[aria-current=page]")).toHaveText("Mes articles");

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  // On the photo (its centre: the quick buttons sit at its bottom, always shown on a touch screen).
  await card.locator("[data-photo]").click();
  await expect(page).toHaveURL(/\/produits\//);

  await page.goto("/dressing");
  await expect(page.getByRole("heading", { name: "Ton dressing est vide" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Coller un lien" })).toBeVisible();
});

test("les filtres vivent dans l'adresse et le bouton Précédent les restaure", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Filtres et tri" }).click();
  await page.getByLabel("Trier par").selectOption("price_asc");
  await expect(page).toHaveURL(/tri=price_asc/);
  await page.getByLabel("Étape", { exact: true }).selectOption("sold");
  await expect(page).toHaveURL(/statut=sold/);
  await expect(page.getByRole("heading", { name: "Aucun article ne correspond" })).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/statut=sold/);
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
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
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

  // Level chips (several at once) and « Prioritaires », in the « Filtres et tri » panel and in the address.
  await page.getByRole("button", { name: /^Filtres et tri/ }).click();
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
  await page.getByRole("button", { name: /Prioritaires/ }).click();
  await expect(page).toHaveURL(/prioritaire=1/);
  await expect(cards).toHaveCount(1);
  await levels.getByRole("button", { name: "J’aime" }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("Prioritaire");
  await axe(page);

  // « Ce que j’aime le plus »: the « En feu » first, then the « J’aime » (the priority one before the other).
  await page.goto("/envies");
  await page.getByRole("button", { name: "Filtres et tri" }).click();
  await page.getByLabel("Trier par").selectOption({ label: "Ce que j’aime le plus" });
  await expect(page).toHaveURL(/tri=love/);
  await expect(cards.nth(0).getByRole("button", { name: /niveau : En feu/ })).toBeVisible();
  await expect(cards.nth(1).getByRole("button", { name: /niveau : En feu/ })).toBeVisible();
  await expect(cards.nth(2).getByRole("button", { name: /niveau : J’aime/ })).toBeVisible();
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

  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
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
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(cards).toHaveCount(3);

  // List.
  await pickTwo();
  await bar(page).getByRole("button", { name: "Liste", exact: true }).click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("2 articles ajoutés à Été");
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  // The earlier « C’est annulé. » is still stacked: wait for the second one.
  await expect(toast(page).getByText("C’est annulé.")).toHaveCount(2);
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
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(cards).toHaveCount(3);
});

test("ce qui change ailleurs apparaît tout seul, sans recharger ni cliquer", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  await expect(card.getByRole("button", { name: /niveau : J’aime/ })).toBeVisible();

  // Elsewhere (as on her phone): the level becomes Mims, with no event on this page (no focus, no tab switch).
  const status = await page.evaluate(async () => {
    const list = await (await fetch("/api/me/items?stage=spotted")).json();
    const res = await fetch(`/api/me/items/${list.items[0].id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loveLevel: 3 }),
    });
    return res.status;
  });
  expect(status).toBe(200);
  await expect(card.getByRole("button", { name: /niveau : J’aime/ })).toBeVisible();
  // Nothing to do: the page asks every 10 s whether something changed.
  await expect(card.getByRole("button", { name: /niveau : Mims/ })).toBeVisible({ timeout: 15_000 });
});

test("la grille a 2, 3 ou 4 colonnes selon l'écran", async ({ page }, testInfo) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  const columns = await page
    .getByTestId("item-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  const expected = { "iPhone 15": 2, "iPad (gen 7)": 3, "Desktop Chrome": 4 }[testInfo.project.name];
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

test.describe("barre du haut sur ordinateur", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("le menu est dans le bandeau, sans menu latéral, la place courante en pilule", async ({ page }) => {
    await page.goto("/articles?etape=envie");
    const bar = page.getByTestId("app-nav-top");
    await expect(bar).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);
    const current = bar.locator("a[aria-current=page]");
    await expect(current).toHaveText("Mes articles");
    await bar.getByRole("link", { name: "Moi" }).click();
    await expect(page).toHaveURL(/\/moi$/);
    await expect(current).toHaveText("Moi");
    // The current place is a pill of its own colour, the others sit on the band.
    const fill = (name: string) =>
      bar.getByRole("link", { name }).evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await fill("Moi")).not.toBe(await fill("Accueil"));
    await axe(page);
  });
});

// Cocon lumineux, task 6: the emoji sits alone on the photo; a double tap (or a click on it) opens her 4 levels.

test("double-clic sur la photo : la bulle des 4 niveaux, rien ne change avant de choisir, pas de navigation", async ({
  page,
}, testInfo) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  const emoji = card.getByRole("button", { name: /niveau : J’aime/ });
  await expect(emoji).toBeVisible();

  await card.locator("img, [data-photo]").first().dblclick();
  const bubble = page.getByRole("radiogroup", { name: `Ton niveau d’envie pour ${PRODUCT.name}` });
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole("radio")).toHaveCount(4);
  await expect(bubble.getByRole("radio", { name: "J’aime" })).toBeChecked();
  await expect(bubble.getByRole("radio", { name: "J’aime" })).toBeFocused();
  await page.waitForTimeout(450); // longer than the single-click delay
  await expect(page).toHaveURL(/\/articles\?etape=envie/);
  await expect(emoji).toBeVisible(); // nothing changed yet
  await axe(page);

  // Escape closes without a change.
  await page.keyboard.press("Escape");
  await expect(bubble).toHaveCount(0);
  await expect(emoji).toBeVisible();
  await expect(emoji).toBeFocused();

  // A click on the emoji opens it too; click outside closes without a change.
  await emoji.click();
  await expect(bubble).toBeVisible();
  await page.getByRole("heading", { level: 1, name: "Mes articles" }).click();
  await expect(bubble).toHaveCount(0);

  // Choosing « Mims » changes the card and saves; « Annuler » puts it back.
  await emoji.click();
  await bubble.getByRole("radio", { name: "Mims" }).click();
  await expect(bubble).toHaveCount(0);
  await expect(card.getByRole("button", { name: /niveau : Mims/ })).toBeVisible();
  await expect(toast(page)).toContainText(`${PRODUCT.name} : Mims`);
  await page.reload();
  await expect(
    page
      .getByTestId("item-card")
      .first()
      .getByRole("button", { name: /niveau : Mims/ }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("level-picker.png") });
});

test("un clic simple sur la photo ouvre la fiche après un court délai, le clavier tout de suite", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await page.getByTestId("item-card").first().locator("[data-photo]").click();
  await expect(page).toHaveURL(/\/produits\//);
  await page.goBack();
  const link = page.getByTestId("item-card").first().getByRole("link");
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/produits\//);
});

test("étincelles seulement pour le niveau le plus haut, rien en mouvement réduit", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  const bubble = page.getByRole("radiogroup");
  const pick = async (from: RegExp, to: string) => {
    await card.getByRole("button", { name: from }).click();
    await bubble.getByRole("radio", { name: to }).click();
  };
  await pick(/niveau : J’aime/, "Mims");
  await expect(card.getByRole("button", { name: /niveau : Mims/ })).toBeVisible();
  await expect(card.getByTestId("level-sparks")).toHaveCount(0);

  await pick(/niveau : Mims/, "En feu");
  await expect(card.getByTestId("level-sparks")).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await pick(/niveau : En feu/, "Mims");
  await pick(/niveau : Mims/, "En feu");
  await expect(card.getByRole("button", { name: /niveau : En feu/ })).toBeVisible();
  await expect(card.getByTestId("level-sparks")).toHaveCount(0);
});

test("filtres : la coche se dessine dans la pastille active, « Effacer » vide tout en un clic et garde le tri", async ({
  page,
}) => {
  await pasteAndWish(page);
  await pasteAndWish(page);
  await page.goto("/envies");
  const cards = page.getByTestId("item-card");
  await expect(cards).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Effacer/ })).toHaveCount(0);
  // Only the step chips on the page (mockup): the levels and « Prioritaires » wait in the « Filtres et tri » panel.
  await expect(page.getByRole("button", { name: "J’aime", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Filtres et tri", exact: true }).click();

  const liked = page.getByRole("button", { name: "J’aime", exact: true });
  const priority = page.getByRole("button", { name: "Prioritaires", exact: true });
  // A check is only drawn (non-zero dash) inside an active chip.
  await expect(liked.locator("svg")).toHaveCount(0);
  await liked.click();
  await expect(liked).toHaveAttribute("aria-pressed", "true");
  const stroke = liked.locator("svg path");
  await expect(stroke).toHaveCount(1);
  await expect(stroke).toHaveCSS("stroke-dasharray", /^\d+(\.\d+)?(px)?$/);
  await expect(page.getByRole("button", { name: "Effacer le filtre", exact: true })).toBeVisible();

  await priority.click();
  await expect(cards).toHaveCount(0);
  // The panel's button counts them; the sort is not a filter.
  await expect(page.getByRole("button", { name: "Filtres et tri (2)", exact: true })).toBeVisible();
  await page.getByLabel("Trier par").selectOption("price_asc");
  await expect(page).toHaveURL(/tri=price_asc/);
  await page.keyboard.press("Escape");
  const clear = page.getByRole("button", { name: "Effacer les 2 filtres", exact: true });
  await expect(clear).toBeVisible();
  expect((await clear.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await clear.click();
  await expect(cards).toHaveCount(2);
  await page.getByRole("button", { name: "Filtres et tri", exact: true }).click();
  await expect(liked).toHaveAttribute("aria-pressed", "false");
  await expect(priority).toHaveAttribute("aria-pressed", "false");
  await expect(page).not.toHaveURL(/niveau=|prioritaire=/);
  await expect(page).toHaveURL(/tri=price_asc/);
  await expect(page.getByRole("button", { name: /^Effacer/ })).toHaveCount(0);
});

// Refonte « Cocon lumineux », task 9 and palier 3 bis: « Aperçu », « Je le prends ». Refonte Boudoir, task 3: the
// card is a white 20 px card, its step as a clothing tag, the price (and its drop) in a powder-pink price tag.

const card = (page: Page) => page.getByTestId("item-card").first();

test("la carte Boudoir : étape en haut à gauche, l'émoji en haut à droite, « … » sous la photo, « −20 € » dans l'étiquette de prix", async ({
  page,
  db,
}) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  const href = await card(page).getByRole("link").first().getAttribute("href");
  const productId = href?.split("/").pop();
  await db.query("UPDATE products SET compare_at_cents = NULL WHERE id = $1", [productId]);
  await page.reload();
  const first = card(page);
  // A white card with 20 px corners; the photo fills the top of it (its top corners follow the card's).
  await expect(first).toHaveCSS("border-top-left-radius", "20px");
  await expect(first).toHaveCSS("background-color", await tokenColor(page, "--color-surface-raised"));
  const photo = first.locator("[data-photo]");
  await expect(photo).toHaveCSS("border-top-left-radius", "20px");
  await expect(photo).toHaveCSS("border-bottom-left-radius", "0px");
  await expect(photo.locator("img")).toHaveCSS("object-fit", "cover");
  // The step top left as an ochre tag, her level emoji top right (the mockup's heart); « … » off the photo, bottom
  // right of the card beside the price tag; both a finger wide (measured once the card has risen in).
  const step = first.getByTestId("card-step");
  await expect(step).toHaveText("Envie");
  await expect(step).toHaveCSS("background-color", await tokenColor(page, "--color-label"));
  await first.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const frame = await photo.boundingBox();
  const tag = await step.boundingBox();
  const emoji = await first.getByRole("button", { name: /niveau : J’aime/ }).boundingBox();
  const more = await first.getByRole("button", { name: /Plus d’actions/ }).boundingBox();
  if (!frame || !tag || !emoji || !more) throw new Error("no box");
  expect(tag.x - frame.x).toBeGreaterThanOrEqual(6);
  expect(tag.y - frame.y).toBeGreaterThanOrEqual(6);
  expect(emoji.x + emoji.width / 2).toBeGreaterThan(frame.x + frame.width / 2);
  expect(emoji.y + emoji.height).toBeLessThan(frame.y + frame.height / 2);
  expect(more.x + more.width / 2).toBeGreaterThan(frame.x + frame.width / 2);
  expect(more.y).toBeGreaterThanOrEqual(frame.y + frame.height);
  for (const box of [emoji, more]) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  // The price tag fits its content (a tag, not a bar) and never runs under « … ».
  const priceBox = await first.getByTestId("price-tag").boundingBox();
  if (!priceBox) throw new Error("no box");
  expect(priceBox.width).toBeLessThan(frame.width / 2);
  expect(priceBox.x + priceBox.width).toBeLessThanOrEqual(more.x + 1);
  // No drop yet: nothing crossed.
  await expect(first.getByTestId("card-drop")).toHaveCount(0);
  await expect(first.getByTestId("price-tag")).toHaveCSS("background-color", await tokenColor(page, "--color-une"));

  await db.query("UPDATE products SET compare_at_cents = 4300 WHERE id = $1", [productId]);
  await page.reload();
  const priceTag = card(page).getByTestId("price-tag");
  const drop = priceTag.getByTestId("card-drop");
  await expect(drop).toHaveText(/^−20\s€$/);
  await expect(priceTag.locator("s")).toHaveText(/43\s€/);
  // Inside the price tag, under the photo, whole (never cut, never over « Aperçu » and « Je le prends »), measured
  // once the card has risen in.
  await card(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const dropBox = await drop.boundingBox();
  const tagBox = await priceTag.boundingBox();
  const photoBox = await card(page).locator("[data-photo]").boundingBox();
  if (!dropBox || !tagBox || !photoBox) throw new Error("no box");
  expect(dropBox.y).toBeGreaterThan(photoBox.y + photoBox.height);
  expect(dropBox.x).toBeGreaterThanOrEqual(tagBox.x);
  expect(dropBox.y).toBeGreaterThanOrEqual(tagBox.y);
  expect(dropBox.x + dropBox.width).toBeLessThanOrEqual(tagBox.x + tagBox.width + 0.5);
  expect(dropBox.y + dropBox.height).toBeLessThanOrEqual(tagBox.y + tagBox.height + 0.5);
  expect(await drop.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // Equal or lower crossed price: no badge.
  await db.query("UPDATE products SET compare_at_cents = 2300 WHERE id = $1", [productId]);
  await page.reload();
  await expect(card(page).getByTestId("card-drop")).toHaveCount(0);
});

test("« Aperçu » ouvre le panneau sans quitter la page ; « Je le prends » coche la carte et met le budget à jour", async ({
  page,
}, testInfo) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  // A budget, so the card has a bar to move.
  await page.getByTestId("budget-card").getByRole("button", { name: "Ajouter un budget" }).click();
  const budgetDialog = page.getByRole("dialog", { name: "Mon budget" });
  await budgetDialog.getByLabel("Montant (en euros)").fill("100");
  await budgetDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(budgetDialog).toHaveCount(0);
  await expect(page.getByTestId("budget-card")).toContainText(/Ma commande en cours : 0\s€/);
  await page.mouse.move(0, 0);
  const first = card(page);
  const touch = testInfo.project.use.hasTouch === true;
  const quick = first.locator(".card-quick");
  const take = first.getByTestId("card-take");
  const preview = first.getByTestId("card-preview");
  if (touch) {
    // Always visible on a touch screen, and big enough to tap.
    await expect(quick).toHaveCSS("opacity", "1");
  } else {
    // A mouse: hidden until the card is hovered or focused.
    await expect(quick).toHaveCSS("opacity", "0");
    await first.hover();
    await expect(quick).toHaveCSS("opacity", "1");
  }
  // Drawn at the mockup's size (42 px, 38 on a phone), a finger wide all the same: the invisible hit area reaches 44.
  // Measured once the card finished rising in (its arrival scales it a little).
  await first.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  for (const button of [take, preview]) {
    const box = await button.boundingBox();
    expect(box?.height).toBeLessThanOrEqual(42);
    const hit = await button.evaluate((el) => {
      const after = getComputedStyle(el, "::after");
      return { width: Number.parseFloat(after.width), height: Number.parseFloat(after.height) };
    });
    expect(Math.min(hit.width, hit.height)).toBeGreaterThanOrEqual(44);
  }
  await expect(take).toHaveAttribute("aria-pressed", "false");
  await expect(first.getByTestId("card-taken")).toHaveCount(0);

  await preview.click();
  const panel = page.getByRole("dialog", { name: `Aperçu de ${PRODUCT.name}` });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/articles\?etape=envie&.*apercu=/);
  await expect(panel).toContainText(/23\s€/);
  await expect(panel.getByRole("region", { name: "Photos de l’article" })).toBeVisible();
  await expect(panel.getByText("J’aime")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Ouvrir la fiche complète" })).toHaveAttribute("href", /\/produits\//);
  await axe(page);
  // « Je le prends » from the panel, then the back button closes it and the page stays.
  await panel.getByRole("checkbox", { name: /Je le prends/ }).click();
  await expect(panel.getByRole("checkbox", { name: /Je le prends/ })).toBeChecked();
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/\/articles\?etape=envie$/);
  await expect(card(page).getByTestId("card-taken")).toBeVisible();
  await expect(card(page).getByTestId("card-take")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page).getByTestId("card-take")).toHaveText("Retirer");
  // Taken, it reads as a state: the soft pressed look (hint fill, accent edge, ink text), not the dark « Je le prends ».
  await expect(card(page).getByTestId("card-take")).toHaveCSS("background-color", "rgb(243, 214, 218)");
  await expect(card(page).getByTestId("card-take")).toHaveCSS("color", "rgb(43, 20, 24)");
  await expect(card(page).getByTestId("card-take")).toHaveCSS("border-top-color", "rgb(91, 26, 42)");

  // Put it back from the card.
  await card(page).getByTestId("card-take").click();
  await expect(card(page).getByTestId("card-taken")).toHaveCount(0);
  await expect(card(page).getByTestId("card-take")).toHaveText("Je le prends");
  // And take it from the card: the budget card counts it in the order in progress.
  await card(page).getByTestId("card-take").click();
  await expect(card(page).getByTestId("card-taken")).toBeVisible();
  // The tick never sits under the card's « … » button.
  const taken = await card(page).getByTestId("card-taken").boundingBox();
  const menu = await card(page).getByRole("button", { name: "Plus d’actions" }).boundingBox();
  expect(taken).not.toBeNull();
  expect(menu).not.toBeNull();
  if (taken && menu) {
    const apart =
      taken.x >= menu.x + menu.width ||
      menu.x >= taken.x + taken.width ||
      taken.y >= menu.y + menu.height ||
      menu.y >= taken.y + taken.height;
    expect(apart).toBe(true);
  }
  await expect(page.getByTestId("budget-card")).toContainText(/23\s€/);
  await card(page).getByTestId("card-take").click();
  await expect(page.getByTestId("budget-card")).not.toContainText(/23\s€/);
  await card(page).getByTestId("card-take").click();
  await expect(page.getByTestId("budget-card")).toContainText(/23\s€/);
});

test("prix inconnu : la carte dit « prix inconnu » ; en sélection, plus de boutons rapides", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(manualProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Nom de l’article").fill("Robe sans prix");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Robe sans prix" })).toBeVisible();
  await keepWish(page);
  await page.goto("/envies");
  await expect(card(page)).toContainText("prix inconnu");
  await expect(card(page).getByTestId("card-drop")).toHaveCount(0);
  await expect(card(page).getByTestId("card-take")).toHaveCount(1);
  await page.getByRole("button", { name: "Sélectionner" }).click();
  await expect(card(page).getByTestId("card-take")).toHaveCount(0);
  await expect(card(page).getByTestId("card-preview")).toHaveCount(0);
});

// Palier 3 bis (docs/plans/2026-11-08-refonte-ecarts-maquette.md): the head of « Mes envies » and its tools.

test("Mes envies : grand titre, pastilles de résumé, loupe, menu des filtres et du tri, « Ajouter une envie »", async ({
  page,
  db,
}) => {
  await pasteAndWish(page);
  await pasteAndWish(page);
  await page.goto("/envies");
  const cards = page.getByTestId("item-card");
  await expect(cards).toHaveCount(2);
  const ids = await Promise.all(
    (await cards.getByRole("link").all()).map(async (link) => (await link.getAttribute("href"))?.split("/").pop()),
  );
  await db.query("UPDATE products SET name = 'Robe Lina', compare_at_cents = 4300 WHERE id = $1", [ids[0]]);
  await db.query("UPDATE products SET compare_at_cents = NULL WHERE id = $1", [ids[1]]);
  await page.reload();

  const title = page.getByRole("heading", { level: 1, name: "Mes articles" });
  await expect(title).toHaveCSS("font-family", /Gloock/);
  const summary = page.getByRole("list", { name: "En bref" });
  await expect(summary.getByRole("listitem")).toHaveText(["2 envies", /^46\s€ en tout$/, "1 prix en baisse"]);

  // The old « Filtres » button and the « Trier par » list with its label above are gone from the page itself.
  await expect(page.getByRole("button", { name: "Filtres", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Trier par")).toHaveCount(0);
  // The menu holds the level chips, the sort and the other filters; Escape closes it and gives the focus back.
  const menu = page.getByRole("button", { name: "Filtres et tri" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  // The chips: full and soft, no border; chosen = the hint fill.
  const liked = page.getByRole("button", { name: "J’aime", exact: true });
  await expect(liked).toHaveCSS("border-top-width", "0px");
  await liked.click();
  await expect(liked).toHaveCSS("background-color", await tokenColor(page, "--color-hint"));
  await liked.click();
  await expect(liked).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Trier par").selectOption("name");
  await expect(page).toHaveURL(/tri=name/);
  await expect(cards.first()).toContainText(PRODUCT.name);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Trier par")).toHaveCount(0);
  await expect(menu).toBeFocused();

  // The magnifier opens a field; the search lives in the address and « Effacer » clears it.
  await page.getByRole("button", { name: "Chercher", exact: true }).click();
  const field = page.getByRole("searchbox", { name: "Chercher une envie" });
  await expect(field).toBeFocused();
  await field.fill("lina");
  await expect(page).toHaveURL(/recherche=lina/);
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Robe Lina");
  await page.getByRole("button", { name: "Effacer le filtre", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(page).not.toHaveURL(/recherche=/);
  await expect(page).toHaveURL(/tri=name/);
  await expect(field).toHaveValue("");

  // « Ajouter une envie » opens the paste field right there.
  await page.getByRole("button", { name: "Ajouter une envie" }).click();
  await expect(page.getByRole("region", { name: "Ajouter une envie" }).getByLabel("Coller un lien")).toBeVisible();
  await axe(page);
});

test("Ma commande : une barre fine sur une ligne, centrée, la jauge dessous", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await page.getByTestId("budget-card").getByRole("button", { name: "Ajouter un budget" }).click();
  const budgetDialog = page.getByRole("dialog", { name: "Mon budget" });
  await budgetDialog.getByLabel("Montant (en euros)").fill("100");
  await budgetDialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(budgetDialog).toHaveCount(0);
  await card(page).getByTestId("card-take").click();
  const band = page.getByTestId("order-band");
  await expect(band).toContainText(/1 article, 23\s€/);
  await expect(band).toContainText(/Il te resterait 77\s€/);
  const parts = [
    band.getByRole("heading", { name: "Ma commande" }),
    band.getByText(/Il te resterait/),
    band.getByRole("button", { name: "Voir" }),
    band.getByRole("button", { name: "J’ai commandé (1)" }),
  ];
  const boxes = await Promise.all(parts.map(async (part) => await part.boundingBox()));
  const bars = await band.getByTestId("budget-bars").boundingBox();
  const frame = await band.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (!bars || !frame || boxes.some((b) => !b)) throw new Error("no box");
  // The gauge under everything else.
  for (const box of boxes) expect(bars.y).toBeGreaterThan((box?.y ?? 0) + (box?.height ?? 0) - 1);
  if (width >= 768) {
    // One line: the buttons sit level with the totals, and the bar is centred and narrow.
    const middle = (b: (typeof boxes)[number] | undefined) => (b?.y ?? 0) + (b?.height ?? 0) / 2;
    expect(Math.abs(middle(boxes[2]) - middle(boxes[3]))).toBeLessThan(2);
    expect(Math.abs(middle(boxes[1]) - middle(boxes[3]))).toBeLessThan(16);
    expect(frame.height).toBeLessThan(110);
    const content = await page.locator("#app-content").boundingBox();
    if (content) expect(Math.abs(frame.x + frame.width / 2 - (content.x + content.width / 2))).toBeLessThan(24);
  }
});

// Palier 3 bis, fix round 1: the search and the menu hand the focus back and close alone.

test("recherche : Échap ou ✕ la referme et rend le focus à la loupe ; une adresse avec recherche ne prend pas le focus", async ({
  page,
}) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  const magnifier = page.getByRole("button", { name: "Chercher", exact: true });
  const field = page.getByRole("searchbox", { name: "Chercher une envie" });
  await magnifier.click();
  await expect(field).toBeFocused();
  await field.fill("pantalon");
  await expect(page).toHaveURL(/recherche=pantalon/);
  await page.keyboard.press("Escape");
  await expect(field).toHaveCount(0);
  await expect(magnifier).toBeFocused();
  await expect(page).not.toHaveURL(/recherche=/);

  // Drawn smaller than a finger on a phone: a tap just outside the pill, or on its padding, still lands in the field.
  await magnifier.click();
  await field.blur();
  const pill = await page.locator("search").boundingBox();
  if (!pill) throw new Error("no search pill");
  if (pill.height < 44) {
    await page.mouse.click(pill.x + pill.width / 2, pill.y - (44 - pill.height) / 2 + 1);
    await expect(field).toBeFocused();
    await field.blur();
  }
  await page.mouse.click(pill.x + 4, pill.y + pill.height / 2);
  await expect(field).toBeFocused();
  await field.fill("pantalon");
  await page.getByRole("button", { name: "Fermer la recherche" }).click();
  await expect(field).toHaveCount(0);
  await expect(magnifier).toBeFocused();

  // Opened by the address: the field shows its words, the focus (and a phone's keyboard) stays away.
  await page.goto("/envies?recherche=pantalon");
  await expect(field).toHaveValue("pantalon");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(field).not.toBeFocused();
});

test("menu « Filtres et tri » : un Échap ferme le menu sans quitter « Sélectionner »", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  const menu = page.getByRole("button", { name: "Filtres et tri" });
  await menu.click();
  await expect(page.getByLabel("Trier par")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Trier par")).toHaveCount(0);
  await expect(menu).toBeFocused();
  await expect(page.getByRole("button", { name: "Terminé" })).toBeVisible();
  // A second Escape leaves the mode, as before.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Sélectionner", exact: true })).toBeVisible();
});
