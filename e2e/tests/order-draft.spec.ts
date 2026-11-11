import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { keepWish, manualProductUrl } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Envies chaleureuses, task 10: « Préparer une commande » with the budget of the profile or of a list (spec §3.6, §3.7).

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};

/** A wish at a price of her own (a manual shop: she types the name and the price). */
async function wishAt(page: Page, name: string, price: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(manualProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Nom de l’article").fill(name);
  await page.getByLabel("Prix (en euros)").fill(price);
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await keepWish(page);
}

const band = (page: Page) => page.getByRole("region", { name: "Ma commande" });
const row = (page: Page, name: string) => page.getByRole("checkbox", { name: new RegExp(name) });

test("budget de la semaine, deux envies cochées, « J’ai commandé » puis « Annuler »", async ({ page }, testInfo) => {
  await wishAt(page, "Robe Alma", "89");
  await wishAt(page, "Gilet Brume", "65");
  await page.goto("/envies");
  await page.getByRole("link", { name: "Préparer une commande" }).click();
  await expect(page).toHaveURL(/\/envies\/commande$/);
  await expect(page.getByRole("heading", { level: 1, name: "Préparer une commande" })).toBeVisible();
  await expect(page.getByRole("link", { name: "‹ Mes envies" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(2);
  await axe(page);
  await band(page).getByRole("button", { name: "J’ai commandé" }).click();
  await expect(page.getByText("Coche au moins une envie")).toBeVisible();

  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mon budget" });
  await dialog.getByLabel("Montant (en euros)").fill("150");
  await dialog.getByRole("radio", { name: "Par semaine" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.getByRole("region", { name: "Mon budget" });
  await expect(card).toContainText(/Budget de la semaine : 150\s€/);
  await expect(card).toContainText(/Déjà commandé : 0\s€/);

  await row(page, "Robe Alma").check();
  await row(page, "Gilet Brume").check();
  await expect(band(page)).toContainText(/2 articles, 154\s€/);
  await expect(band(page)).toContainText(/4\s€ au-dessus/);
  // The toast (« Budget enregistré · Annuler ») sits above the band, never over the totals.
  await expect(toast(page)).toContainText("Budget enregistré");
  await expect(async () => {
    const message = await toast(page).locator("p").filter({ hasText: "Budget enregistré" }).boundingBox();
    const bar = await band(page).boundingBox();
    expect(message && bar && message.y + message.height <= bar.y).toBe(true);
  }).toPass();
  // A ticked row: a very light pink background and the band's pink edge, not a heavy dark outline.
  const ticked = page.getByRole("listitem").filter({ hasText: "Robe Alma" }).locator("> div");
  await expect(ticked).toHaveCSS("background-color", "rgb(243, 214, 218)");
  await expect(ticked).toHaveCSS("border-top-color", "rgb(140, 42, 60)");
  await expect(ticked.getByText(/89\s€/)).toHaveCSS("font-variant-numeric", "tabular-nums");
  await expect(band(page).getByText(/2 articles/)).toHaveCSS("font-variant-numeric", "tabular-nums");
  // A glass band (refonte « Cocon lumineux », replaces the white one of 2026-11-07), and over the budget in red.
  await expect(band(page)).toHaveClass(/glass/);
  await expect(band(page)).toHaveCSS("background-color", "color(srgb 1 1 1 / 0.6)");
  // Buttons show the hand, like links, and « J'ai commandé » darkens on hover.
  const ordered = band(page).getByRole("button", { name: "J’ai commandé" });
  await expect(ordered).toHaveCSS("cursor", "pointer");
  await expect(page.getByRole("button", { name: "Budget", exact: true })).toHaveCSS("cursor", "pointer");
  if (!testInfo.project.use.hasTouch) {
    // Only with a mouse: phones and tablets have no hover.
    await ordered.hover();
    await expect(ordered).toHaveCSS("background-color", "rgb(43, 20, 24)");
  }
  // Over the budget: a soft red fill, a red edge and red text (version B, same style as the green one).
  const over = band(page).getByText(/au-dessus/);
  await expect(over).toHaveCSS("background-color", "rgb(251, 227, 230)");
  await expect(over).toHaveCSS("border-top-color", "rgb(217, 127, 140)");
  await expect(over).toHaveCSS("color", "rgb(155, 28, 49)");
  // Same in dark mode: a wine fill, an old-rose edge and salmon text.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "boudoir-dark"));
  await expect(over).toHaveCSS("background-color", "rgb(74, 34, 40)");
  await expect(over).toHaveCSS("border-top-color", "rgb(180, 100, 108)");
  await expect(over).toHaveCSS("color", "rgb(244, 163, 168)");
  await axe(page);
  await page.screenshot({ path: testInfo.outputPath("commande-sombre.png") });
  // The browser knows the page is dark (scroll bars, native controls), and ticked rows keep their soft tint.
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(ticked).toHaveCSS("background-color", "rgb(74, 39, 48)");
  await expect(ticked).toHaveCSS("border-top-color", "rgb(240, 169, 182)");
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.screenshot({ path: testInfo.outputPath("commande.png") });
  await axe(page);

  // Saved: still ticked on another visit.
  await page.reload();
  await expect(row(page, "Robe Alma")).toBeChecked();
  await expect(row(page, "Gilet Brume")).toBeChecked();
  await row(page, "Gilet Brume").uncheck();
  await expect(band(page)).toContainText(/1 article, 89\s€/);
  await expect(band(page)).toContainText(/Il te resterait 61\s€/);
  // Under the budget: a soft mint fill, a green edge and pine text (version B).
  const left = band(page).getByText(/Il te resterait/);
  await expect(left).toHaveCSS("background-color", "rgb(227, 241, 231)");
  await expect(left).toHaveCSS("border-top-color", "rgb(111, 165, 138)");
  await expect(left).toHaveCSS("color", "rgb(31, 74, 63)");
  // Same in dark mode: a spruce fill, a fern edge and celadon text.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "boudoir-dark"));
  await expect(left).toHaveCSS("background-color", "rgb(29, 58, 49)");
  await expect(left).toHaveCSS("border-top-color", "rgb(78, 138, 110)");
  await expect(left).toHaveCSS("color", "rgb(169, 220, 191)");
  await axe(page);
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await row(page, "Gilet Brume").check();
  await expect(band(page)).toContainText(/2 articles, 154\s€/);

  await band(page).getByRole("button", { name: "J’ai commandé" }).click();
  await expect(toast(page)).toContainText("2 articles passés en Commandé");
  await expect(card).toContainText(/Déjà commandé : 154\s€/);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Rien à commander pour l’instant")).toBeVisible();
  await expect(band(page)).toContainText(/0 article, 0\s€/);

  // In « Commandé » (another tab: the toast stays here).
  const other = await page.context().newPage();
  await other.goto("/commande");
  await expect(other.getByTestId("item-card")).toHaveCount(2);
  await other.close();

  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(row(page, "Robe Alma")).toBeChecked();
  await expect(row(page, "Gilet Brume")).toBeChecked();
  await expect(card).toContainText(/Déjà commandé : 0\s€/);
  await expect(band(page)).toContainText(/2 articles, 154\s€/);
});

test("depuis une liste, seuls ses articles et le budget de la liste", async ({ page }) => {
  await wishAt(page, "Pull Noël", "40");
  await wishAt(page, "Jupe Été", "30");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Noël");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Noël » créée");
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await page.getByTestId("item-card").getByRole("button", { name: "Pull Noël" }).click();
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Liste", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Noël" }).click();
  await expect(toast(page)).toContainText("1 article ajouté à Noël");

  await page.goto("/listes");
  await page.getByRole("link", { name: /Noël/ }).click();
  await page.getByRole("link", { name: "Préparer une commande" }).click();
  await expect(page).toHaveURL(/\/envies\/commande\?liste=[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "‹ Noël" })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await expect(row(page, "Pull Noël")).toBeVisible();
  const card = page.getByRole("region", { name: "Budget de la liste" });
  await expect(card).toContainText("Pas encore de budget");

  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Budget de la liste" });
  await dialog.getByLabel("Montant (en euros)").fill("300,50");
  await dialog.getByRole("radio", { name: "Sans période" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(card).toContainText(/Budget : 300,50\s€/);
  await row(page, "Pull Noël").check();
  await expect(band(page)).toContainText(/1 article, 40\s€/);
  await expect(band(page)).toContainText(/Il te resterait 260,50\s€/);
  await axe(page);

  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await dialog.getByRole("button", { name: "Supprimer le budget" }).click();
  await expect(card).toContainText("Pas encore de budget");
  await expect(band(page)).not.toContainText("resterait");
});

test("budget : « Annuler » après Enregistrer ou Supprimer, « Recommencer à zéro » demande confirmation", async ({
  page,
}) => {
  await wishAt(page, "Sac Lune", "20");
  await page.goto("/envies/commande");
  const card = page.getByRole("region", { name: "Mon budget" });
  const dialog = page.getByRole("dialog", { name: "Mon budget" });
  const save = async (amount: string, period: string) => {
    await page.getByRole("button", { name: "Budget", exact: true }).click();
    await dialog.getByLabel("Montant (en euros)").fill(amount);
    await dialog.getByRole("radio", { name: period }).check();
    await dialog.getByRole("button", { name: "Enregistrer" }).click();
    await expect(dialog).toHaveCount(0);
  };

  // A new budget, undone: there is none again.
  await save("150", "Par semaine");
  await expect(card).toContainText(/Budget de la semaine : 150\s€/);
  await expect(toast(page)).toContainText("Budget enregistré");
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(card).toContainText("Pas encore de budget");

  // A change, undone: the previous amount and period come back.
  await save("150", "Par semaine");
  await save("200", "Par mois");
  await expect(card).toContainText(/Budget du mois : 200\s€/);
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(card).toContainText(/Budget de la semaine : 150\s€/);

  // Deleted, undone.
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await dialog.getByRole("button", { name: "Supprimer le budget" }).click();
  await expect(card).toContainText("Pas encore de budget");
  await expect(toast(page)).toContainText("Budget supprimé");
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(card).toContainText(/Budget de la semaine : 150\s€/);

  // « Recommencer à zéro » (no period only): asks first; « Garder » keeps it, « Recommencer » resets, no undo.
  await save("100", "Sans période");
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await dialog.getByRole("button", { name: "Recommencer à zéro" }).click();
  await expect(dialog).toContainText("Recommencer à zéro ? Ce qui est déjà commandé repartira de 0 €.");
  await axe(page);
  await dialog.getByRole("button", { name: "Garder" }).click();
  await expect(dialog.getByRole("button", { name: "Recommencer à zéro" })).toBeVisible();
  await dialog.getByRole("button", { name: "Recommencer à zéro" }).click();
  await dialog.getByRole("button", { name: "Recommencer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toast(page)).toContainText("Budget remis à zéro");
  // Older bubbles keep their own Annuler: only the newest one (this message) has none.
  await expect(toast(page).locator('[data-toast-rank="0"]').getByRole("button", { name: "Annuler" })).toHaveCount(0);
  await expect(card).toContainText(/Budget : 100\s€/);
});

test("le budget d’une liste se règle aussi depuis la page de la liste", async ({ page }) => {
  await wishAt(page, "Bonnet Givre", "25");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Hiver");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await page.getByRole("link", { name: /Hiver/ }).click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Budget de la liste" });
  await dialog.getByLabel("Montant (en euros)").fill("80");
  await dialog.getByRole("radio", { name: "Par mois" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(toast(page)).toContainText("Budget enregistré");
  await axe(page);

  // Opened again: the saved budget is there; and « Préparer une commande » shows it.
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await expect(dialog.getByLabel("Montant (en euros)")).toHaveValue("80");
  await expect(dialog.getByRole("radio", { name: "Par mois" })).toBeChecked();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Préparer une commande" }).click();
  await expect(page.getByRole("region", { name: "Budget de la liste" })).toContainText(/Budget du mois : 80\s€/);
});

test("la petite case coche, et le lien de la boutique s’ouvre dans un nouvel onglet", async ({ page }) => {
  await wishAt(page, "Robe Alma", "89");
  await page.goto("/envies/commande");
  const box = row(page, "Robe Alma");
  await expect(box).not.toBeChecked();
  // A small square box, still easy to touch.
  const mark = page.getByTestId("order-check").first();
  const size = await mark.boundingBox();
  expect(size?.width).toBeLessThanOrEqual(24);
  await expect(mark).not.toHaveCSS("border-top-left-radius", "9999px");
  await box.check();
  await expect(band(page)).toContainText(/1 article, 89\s€/);
  const shop = page.getByRole("link", { name: /^Voir chez / });
  await expect(shop).toHaveAttribute("target", "_blank");
  await expect(shop).toHaveAttribute("rel", /noopener/);
  // Underlined only on hover: no stripes repeated on every row.
  await expect(shop).toHaveCSS("text-decoration-line", "none");
});

test("l’aperçu s’ouvre sans quitter la page : « Je le prends », Fermer, Échap, retour, glisser", async ({
  page,
}, testInfo) => {
  await wishAt(page, "Robe Alma", "89");
  await page.goto("/envies/commande");
  const preview = page.getByRole("dialog", { name: "Aperçu de Robe Alma" });

  // Open from the name: the page stays, the preview shows the item.
  await page.getByRole("button", { name: /Robe Alma/ }).click();
  await expect(preview).toBeVisible();
  await expect(page).toHaveURL(/\/envies\/commande\?.*apercu=/);
  await expect(preview).toContainText(/89\s€/);
  // The name once, the same small square box as in the list, the content does not scroll the page behind.
  await expect(preview.getByText(/Robe Alma/)).toHaveCount(1);
  await expect(preview.getByTestId("order-check")).toHaveCount(1);
  await expect(preview.getByTestId("preview-body")).toHaveCSS("overscroll-behavior-y", "contain");
  if (testInfo.project.use.hasTouch) await expect(preview).toContainText("Glisse vers le bas pour fermer");
  await expect(preview.getByRole("link", { name: /^Voir chez / })).toHaveAttribute("target", "_blank");
  await expect(preview.getByRole("link", { name: "Ouvrir la fiche complète" })).toHaveAttribute("href", /\/produits\//);
  await axe(page);
  await page.screenshot({ path: testInfo.outputPath("apercu.png") });
  if (!testInfo.project.use.hasTouch) {
    // On a computer, a large panel: at least 560 px wide.
    const box = await preview.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(560);
  }

  // « Je le prends » ticks it in the order without closing.
  await preview.getByRole("checkbox", { name: /Je le prends/ }).check();
  await expect(preview).toBeVisible();
  await expect(band(page)).toContainText(/1 article, 89\s€/);

  // « Fermer »: back on the list, the box ticked.
  await preview.getByRole("button", { name: "Fermer" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page).toHaveURL(/\/envies\/commande$/);
  await expect(row(page, "Robe Alma")).toBeChecked();

  // Escape closes it too.
  await page.getByRole("button", { name: /Robe Alma/ }).click();
  await expect(preview).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page).toHaveURL(/\/envies\/commande$/);

  // The phone's back button closes it and stays on the page.
  await page.getByRole("button", { name: /Robe Alma/ }).click();
  await expect(preview).toBeVisible();
  await page.goBack();
  await expect(preview).toHaveCount(0);
  await expect(page).toHaveURL(/\/envies\/commande$/);
  await expect(page.getByRole("heading", { level: 1, name: "Préparer une commande" })).toBeVisible();

  // Dragging the top of the preview down closes it.
  await page.getByRole("button", { name: /Robe Alma/ }).click();
  await expect(preview).toBeVisible();
  const handle = await page.getByTestId("preview-handle").boundingBox();
  if (!handle) throw new Error("no handle");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(preview).toHaveCount(0);

  // « Ouvrir la fiche complète » goes to the item.
  await page.getByRole("button", { name: /Robe Alma/ }).click();
  await preview.getByRole("link", { name: "Ouvrir la fiche complète" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Robe Alma" })).toBeVisible();
});

test("Mes envies : un onglet par liste, la grille filtrée et le budget de la liste", async ({ page }) => {
  await wishAt(page, "Pull Noël", "40");
  await wishAt(page, "Jupe Été", "30");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été » créée");
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await page.getByTestId("item-card").getByRole("button", { name: "Jupe Été" }).click();
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Liste", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("1 article ajouté à Été");
  await page.goto("/envies");

  const tabs = page.getByRole("navigation", { name: "Mes listes" });
  const all = tabs.getByRole("button", { name: /Toutes mes envies/ });
  const summer = tabs.getByRole("button", { name: /^Été/ });
  await expect(all).toHaveAttribute("aria-current", "true");
  await expect(all).toContainText("2");
  await expect(summer).toContainText("1");
  expect((await summer.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId("item-card")).toHaveCount(2);
  const card = page.getByTestId("budget-card");
  await expect(card).toContainText("Pas de budget");
  await expect(card).toHaveCSS("font-variant-numeric", "tabular-nums");

  await summer.click();
  await expect(page).toHaveURL(/\/articles\?etape=envie&liste=[0-9a-f-]{36}$/);
  await expect(summer).toHaveAttribute("aria-current", "true");
  await expect(all).not.toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByTestId("item-card")).toContainText("Jupe Été");
  await expect(tabs.getByTestId("nav-underline")).toHaveAttribute("data-shown", "true");
  await expect(page.getByRole("link", { name: "Préparer une commande" })).toHaveAttribute(
    "href",
    /\/envies\/commande\?liste=[0-9a-f-]{36}$/,
  );
  // A list without a budget: said so, and its wishes still count in the profile's budget (Review Focus 1).
  await expect(card).toContainText("Pas de budget pour « Été »");
  await expect(card).toContainText("Ces articles comptent quand même dans ton budget du mois.");
  await expect(card).not.toContainText("NaN");

  await card.getByRole("button", { name: "Ajouter un budget" }).click();
  const dialog = page.getByRole("dialog", { name: "Budget de la liste" });
  await dialog.getByLabel("Montant (en euros)").fill("100");
  await dialog.getByRole("radio", { name: "Par mois" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(card).toContainText(/Budget du mois : 100\s€/);
  await expect(card).toContainText(/Déjà commandé : 0\s€/);
  await expect(card).toContainText(/Reste 100\s€/);
  await expect(card).toContainText("Ma commande en cours");
  // The legend tells which bar is which: a swatch each, in the colours of the two bars.
  const spentColor = await card.getByTestId("swatch-spent").evaluate((n) => getComputedStyle(n).backgroundColor);
  const draftColor = await card.getByTestId("swatch-draft").evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(spentColor).not.toBe(draftColor);
  expect(draftColor).not.toBe("rgba(0, 0, 0, 0)");
  await expect(card).toContainText("Ces articles comptent aussi dans ton budget du mois.");
  await axe(page);

  await all.click();
  await expect(page).toHaveURL(/\/articles\?etape=envie$/);
  await expect(page.getByTestId("item-card")).toHaveCount(2);
  await expect(card).toContainText("Pas de budget");
  await expect(card).not.toContainText("Budget du mois");
});

// Refonte « Cocon lumineux », task 10: the « Ma commande » band at the bottom of « Mes envies ».

const envBand = (page: Page) => page.getByTestId("order-band");
const takeCard = (page: Page, name: string) =>
  page.getByTestId("item-card").filter({ hasText: name }).getByTestId("card-take");

async function setBudget(page: Page, dialogName: string, amount: string) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await dialog.getByLabel("Montant (en euros)").fill(amount);
  await dialog.getByRole("radio", { name: "Par mois" }).check();
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(dialog).toHaveCount(0);
}

test("Mes envies : le bandeau « Ma commande », trois envies prises, une décochée, « J’ai commandé (2) »", async ({
  page,
}, testInfo) => {
  await wishAt(page, "Robe Alma", "89");
  await wishAt(page, "Gilet Brume", "65");
  await wishAt(page, "Jupe Été", "30");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été » créée");
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  for (const name of ["Robe Alma", "Gilet Brume", "Jupe Été"]) {
    await page.getByTestId("item-card").getByRole("button", { name }).click();
  }
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Liste", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("3 articles ajoutés à Été");
  await page.goto("/envies");
  const card = page.getByTestId("budget-card");
  await card.getByRole("button", { name: "Ajouter un budget" }).click();
  await setBudget(page, "Mon budget", "300");
  await page.getByRole("navigation", { name: "Mes listes" }).getByRole("button", { name: /^Été/ }).click();
  await card.getByRole("button", { name: "Ajouter un budget" }).click();
  await setBudget(page, "Budget de la liste", "200");
  await page
    .getByRole("navigation", { name: "Mes listes" })
    .getByRole("button", { name: /Toutes mes envies/ })
    .click();

  // Nothing ticked: no band.
  await expect(page.getByTestId("item-card")).toHaveCount(3);
  await expect(envBand(page)).toHaveCount(0);
  for (const name of ["Robe Alma", "Gilet Brume", "Jupe Été"]) await takeCard(page, name).click();
  const bar = envBand(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("heading", { name: "Ma commande" })).toBeVisible();
  await expect(bar).toContainText(/3 articles, 184\s€/);
  await expect(bar).toContainText(/Il te resterait 116\s€/);
  await expect(bar).toHaveClass(/glass/);
  await expect(bar.getByTestId("budget-bars")).toBeVisible();
  await axe(page);
  await page.screenshot({ path: testInfo.outputPath("envies-bandeau.png") });

  // « Voir » folds the ticked ones out; unticking keeps the row (to tick it again) until the list is closed.
  const see = bar.getByRole("button", { name: "Voir" });
  await expect(see).toHaveAttribute("aria-expanded", "false");
  await see.click();
  await expect(see).toHaveAttribute("aria-expanded", "true");
  const rows = bar.getByRole("checkbox");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toBeChecked();
  await bar.getByRole("checkbox", { name: /Jupe Été/ }).uncheck();
  await expect(bar.getByRole("checkbox", { name: /Jupe Été/ })).toBeVisible();
  await expect(bar).toContainText(/2 articles, 154\s€/);
  await expect(bar.getByRole("button", { name: "J’ai commandé (2)" })).toBeVisible();
  await bar.getByRole("checkbox", { name: /Jupe Été/ }).check();
  await expect(bar.getByRole("button", { name: "J’ai commandé (3)" })).toBeVisible();
  await bar.getByRole("checkbox", { name: /Jupe Été/ }).uncheck();
  await see.click();
  await see.click();
  await expect(bar.getByRole("checkbox")).toHaveCount(2);

  await bar.getByRole("button", { name: "J’ai commandé (2)" }).click();
  await expect(toast(page)).toContainText("2 articles passés en Commandé");
  await expect(envBand(page)).toHaveCount(0);
  // Only the two went to « Commandé »: the unticked one stays in Mes envies.
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByTestId("item-card")).toContainText("Jupe Été");
  await expect(card).toContainText(/Déjà commandé : 154\s€/);
  await page.getByRole("navigation", { name: "Mes listes" }).getByRole("button", { name: /^Été/ }).click();
  await expect(card).toContainText(/Déjà commandé : 154\s€/);
});

/** « Robe Alma » (Moi, 89 €) and « Gilet Brume » (Léa, 65 €), both in the list « Été »; ends on « Mes envies » of Moi. */
async function twoProfilesInOneList(page: Page): Promise<void> {
  await wishAt(page, "Robe Alma", "89");
  await wishAt(page, "Gilet Brume", "65");
  await page.goto("/reglages/profils");
  const add = page.getByRole("form", { name: "Nouveau profil" });
  await add.getByLabel("Nom").fill("Léa");
  await add.getByRole("button", { name: "Ajouter un profil" }).click();
  await expect(toast(page)).toContainText("Profil « Léa » ajouté");
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été » créée");
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  for (const name of ["Robe Alma", "Gilet Brume"]) {
    await page.getByTestId("item-card").getByRole("button", { name }).click();
  }
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Liste", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("2 articles ajoutés à Été");
  await page.goto("/envies");
  // « Gilet Brume » goes to Léa: the list now holds a wish of each profile.
  await page
    .getByTestId("item-card")
    .filter({ hasText: "Gilet Brume" })
    .getByRole("button", { name: "Plus d’actions" })
    .click();
  await page
    .getByRole("dialog", { name: "Actions sur Gilet Brume" })
    .getByRole("button", { name: "Déplacer vers un profil" })
    .click();
  await page.getByRole("dialog", { name: "Déplacer vers un profil" }).getByRole("button", { name: "Léa" }).click();
  await expect(toast(page)).toContainText("Déplacé vers Léa");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
}

test("Mes envies : l'onglet d'une liste montre les envies de tous les profils, « Toutes mes envies » celles du profil", async ({
  page,
}) => {
  await twoProfilesInOneList(page);
  const cards = page.getByTestId("item-card");
  const tabs = page.getByRole("navigation", { name: "Mes listes" });
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Robe Alma");
  await tabs.getByRole("button", { name: /^Été/ }).click();
  await expect(page).toHaveURL(/liste=[0-9a-f-]{36}/);
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: "Robe Alma" })).toHaveCount(1);
  await expect(cards.filter({ hasText: "Gilet Brume" })).toHaveCount(1);
  // The list keeps its own order: no sort in the menu there.
  const menu = page.getByRole("button", { name: "Filtres et tri" });
  await menu.click();
  await expect(page.getByLabel("Boutique")).toBeVisible();
  await expect(page.getByLabel("Trier par")).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Léa's wish keeps its pill and menu there: changing it never drops it from the list's tab.
  await cards.filter({ hasText: "Gilet Brume" }).getByTestId("card-take").click();
  await expect(cards).toHaveCount(2);
  await tabs.getByRole("button", { name: /Toutes mes envies/ }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Robe Alma");
  await menu.click();
  await expect(page.getByLabel("Trier par")).toBeVisible();
});

test("Mes envies : une liste partagée par deux profils, un onglet qui compte et commande les envies des deux", async ({
  page,
}) => {
  await twoProfilesInOneList(page);

  // One tick each, from each profile.
  await takeCard(page, "Robe Alma").click();
  await expect(envBand(page)).toContainText(/1 article, 89\s€/);
  const switcher = page.getByLabel("Profil", { exact: true }).filter({ visible: true });
  await switcher.selectOption({ label: "Léa" });
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await takeCard(page, "Gilet Brume").click();
  await expect(envBand(page)).toContainText(/1 article, 65\s€/);
  await switcher.selectOption({ label: "Moi" });
  await expect(page.getByTestId("item-card")).toContainText("Robe Alma");

  // The list's tab: both wishes, as on « Préparer une commande » of the list and as the server orders them.
  const tabs = page.getByRole("navigation", { name: "Mes listes" });
  const summer = tabs.getByRole("button", { name: /^Été/ });
  await expect(tabs.getByRole("button", { name: /Toutes mes envies/ })).toContainText("1");
  await expect(summer).toContainText("2");
  await summer.click();
  await expect(page).toHaveURL(/liste=[0-9a-f-]{36}/);
  const bar = envBand(page);
  await expect(bar).toContainText(/2 articles, 154\s€/);
  await bar.getByRole("button", { name: "J’ai commandé (2)" }).click();
  await expect(toast(page)).toContainText("2 articles passés en Commandé");
  await expect(envBand(page)).toHaveCount(0);
  await expect(summer).toContainText("0");
  await page.goto("/commande");
  await expect(page.getByTestId("item-card")).toContainText("Robe Alma");
  await switcher.selectOption({ label: "Léa" });
  await expect(page.getByTestId("item-card")).toContainText("Gilet Brume");
});

test("Mes envies : tout décocher puis « J’ai commandé (0) » secoue le bouton ; mouvement réduit : rien ne bouge", async ({
  page,
}) => {
  await wishAt(page, "Robe Alma", "89");
  await page.goto("/envies");
  await takeCard(page, "Robe Alma").click();
  const bar = envBand(page);
  await expect(bar).toContainText(/1 article, 89\s€/);
  await bar.getByRole("button", { name: "Voir" }).click();
  await bar.getByRole("checkbox", { name: /Robe Alma/ }).uncheck();
  // Still there while the list is open, so she can tick it again.
  await expect(bar.getByRole("button", { name: "J’ai commandé (0)" })).toBeVisible();
  const ordered = bar.getByRole("button", { name: "J’ai commandé (0)" });
  await ordered.click();
  await expect(toast(page)).toContainText("Coche au moins une envie");
  await expect(ordered).toHaveAttribute("data-shaking", "true");
  await expect(ordered).not.toHaveCSS("animation-name", "none");
  await expect(ordered).toHaveAttribute("data-shaking", "false");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ordered.click();
  await expect(ordered).toHaveCSS("animation-name", "none");
  await expect(bar.getByTestId("count-roll")).toHaveCSS("animation-name", "none");
  // Closed with nothing ticked: the band goes.
  await bar.getByRole("button", { name: "Voir" }).click();
  await expect(envBand(page)).toHaveCount(0);
});

test("Mes envies : une envie sans prix cochée, 1 article, 0 €, « dont 1 prix inconnu »", async ({ page }) => {
  await wishAt(page, "Sac sans prix", "");
  await page.goto("/envies");
  await takeCard(page, "Sac sans prix").click();
  await expect(envBand(page)).toContainText(/1 article, 0\s€/);
  await expect(envBand(page)).toContainText("dont 1 prix inconnu");
});

test("Mes envies : décocher puis commander aussitôt, l’envie décochée n’est pas commandée", async ({ page }) => {
  await wishAt(page, "Robe Alma", "89");
  await wishAt(page, "Gilet Brume", "65");
  await page.goto("/envies");
  await takeCard(page, "Robe Alma").click();
  await takeCard(page, "Gilet Brume").click();
  const bar = envBand(page);
  await expect(bar).toContainText(/2 articles, 154\s€/);
  await bar.getByRole("button", { name: "Voir" }).click();
  // The saves are slow: the order must wait for them instead of overtaking the untick.
  await page.route("**/api/me/items/*", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((done) => setTimeout(done, 800));
    await route.continue();
  });
  await bar.getByRole("checkbox", { name: /Gilet Brume/ }).uncheck();
  await bar.getByRole("button", { name: "J’ai commandé (1)" }).click();
  await expect(toast(page)).toContainText("1 article passé en Commandé");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByTestId("item-card")).toContainText("Gilet Brume");
  // Untick then tick again quickly: the last tap wins.
  await page.getByTestId("item-card").getByTestId("card-take").click();
  await page.getByTestId("item-card").getByTestId("card-take").click();
  await expect(page.getByTestId("item-card").getByTestId("card-take")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByTestId("item-card").getByTestId("card-take")).toHaveAttribute("aria-pressed", "false");
});
