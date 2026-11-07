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
  await page.getByRole("button", { name: "Ajouter" }).click();
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
  await expect(band(page)).toContainText(/2 articles · 154\s€/);
  await expect(band(page)).toContainText(/4\s€ au-dessus/);
  // A very light pink band with a pink edge (version B), and over the budget in red (the danger color).
  await expect(band(page)).toHaveCSS("background-color", "rgb(246, 228, 225)");
  await expect(band(page)).toHaveCSS("border-top-color", "rgb(216, 169, 163)");
  await expect(band(page).getByText(/au-dessus/)).toHaveCSS("background-color", "rgb(155, 28, 49)");
  await page.screenshot({ path: testInfo.outputPath("commande.png") });
  await axe(page);

  // Saved: still ticked on another visit.
  await page.reload();
  await expect(row(page, "Robe Alma")).toBeChecked();
  await expect(row(page, "Gilet Brume")).toBeChecked();
  await row(page, "Gilet Brume").uncheck();
  await expect(band(page)).toContainText(/1 article · 89\s€/);
  await expect(band(page)).toContainText(/Il te resterait 61\s€/);
  await row(page, "Gilet Brume").check();
  await expect(band(page)).toContainText(/2 articles · 154\s€/);

  await band(page).getByRole("button", { name: "J’ai commandé" }).click();
  await expect(toast(page)).toContainText("2 articles passés en Commandé");
  await expect(card).toContainText(/Déjà commandé : 154\s€/);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText("Rien à commander pour l’instant")).toBeVisible();
  await expect(band(page)).toContainText(/0 article · 0\s€/);

  // In « Commandé » (another tab: the toast stays here).
  const other = await page.context().newPage();
  await other.goto("/commande");
  await expect(other.getByTestId("item-card")).toHaveCount(2);
  await other.close();

  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(row(page, "Robe Alma")).toBeChecked();
  await expect(row(page, "Gilet Brume")).toBeChecked();
  await expect(card).toContainText(/Déjà commandé : 0\s€/);
  await expect(band(page)).toContainText(/2 articles · 154\s€/);
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
  await expect(band(page)).toContainText(/1 article · 40\s€/);
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
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(card).toContainText("Pas encore de budget");

  // A change, undone: the previous amount and period come back.
  await save("150", "Par semaine");
  await save("200", "Par mois");
  await expect(card).toContainText(/Budget du mois : 200\s€/);
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(card).toContainText(/Budget de la semaine : 150\s€/);

  // Deleted, undone.
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await dialog.getByRole("button", { name: "Supprimer le budget" }).click();
  await expect(card).toContainText("Pas encore de budget");
  await expect(toast(page)).toContainText("Budget supprimé");
  await toast(page).getByRole("button", { name: "Annuler" }).click();
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
  await expect(toast(page).getByRole("button", { name: "Annuler" })).toHaveCount(0);
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
