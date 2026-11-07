import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Envies chaleureuses, task 7: the level pill and the « … » menu on the cards (spec §3.2, §3.3, §4).

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};

/** Keeps the product as a wish (« J’aime »), then opens Envies. */
async function wishInEnvies(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
}

const card = (page: Page) => page.getByTestId("item-card").first();
const menu = (page: Page) => page.getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` });

test("la pastille passe de J’aime à Mims, « Annuler » remet J’aime ; plus de case à cocher", async ({ page }) => {
  await wishInEnvies(page);
  await expect(card(page).getByRole("checkbox")).toHaveCount(0);
  await expect(card(page).getByRole("img", { name: "Favori" })).toHaveCount(0);
  await axe(page);

  await card(page).getByRole("button", { name: "Niveau : J’aime. Toucher pour changer" }).click();
  await expect(card(page).getByRole("button", { name: "Niveau : Mims. Toucher pour changer" })).toBeVisible();
  await expect(card(page)).toContainText("Mims");
  await expect(toast(page)).toContainText("Niveau : Mims");

  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(card(page).getByRole("button", { name: "Niveau : J’aime. Toucher pour changer" })).toBeVisible();

  // Taken back to « Bof »… then cleared from the menu: the item stays (spec §4), the pill offers « + ».
  await card(page).getByRole("button", { name: "Plus d’actions" }).click();
  await menu(page).getByRole("button", { name: "J’aime" }).click();
  await expect(toast(page)).toContainText("Niveau retiré");
  await expect(card(page).getByRole("button", { name: "Donner un niveau" })).toBeVisible();
  await card(page).getByRole("button", { name: "Donner un niveau" }).click();
  await expect(card(page).getByRole("button", { name: "Niveau : J’aime. Toucher pour changer" })).toBeVisible();
});

test("menu « … » : focus, Échap, niveau, Prioritaire et Mon avis sur la vignette", async ({ page }, testInfo) => {
  await wishInEnvies(page);
  const more = card(page).getByRole("button", { name: "Plus d’actions" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page).getByRole("button", { name: "J’aime" })).toHaveAttribute("aria-pressed", "true");
  await expect(menu(page).getByRole("button").first()).toBeFocused();
  // On a phone the sheet is modal (the page behind is inert for every reader); from a tablet up, a small menu.
  const phone = testInfo.project.name === "iPhone 15";
  expect(await menu(page).evaluate((dialog) => dialog.matches(":modal"))).toBe(phone);
  await page.screenshot({ path: testInfo.outputPath("menu.png") });
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(more).toBeFocused();

  await more.click();
  await menu(page).getByRole("button", { name: "En feu" }).click();
  await expect(toast(page)).toContainText("Niveau : En feu");
  await expect(card(page).getByRole("button", { name: "Niveau : En feu. Toucher pour changer" })).toBeVisible();

  await more.click();
  await menu(page).getByRole("button", { name: "Prioritaire" }).click();
  await expect(toast(page)).toContainText("Prioritaire");
  await expect(card(page).getByText("Prioritaire", { exact: true })).toBeVisible();
  await more.click();
  await expect(menu(page).getByRole("button", { name: "Retirer de Prioritaire" })).toBeVisible();
  await page.keyboard.press("Escape");

  await more.click();
  await menu(page).getByRole("button", { name: "Mon avis" }).click();
  const dialog = page.getByRole("dialog", { name: "Mon avis" });
  await dialog.getByLabel("Pourquoi ?").fill("La coupe parfaite");
  await dialog.getByRole("button", { name: "Enregistrer" }).click();
  await expect(toast(page)).toContainText("Avis enregistré");
  await expect(card(page)).toContainText("« La coupe parfaite »");
  await expect(more).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("card.png") });
  await axe(page);

  await page.reload();
  await expect(card(page).getByText("Prioritaire", { exact: true })).toBeVisible();
  await expect(card(page)).toContainText("« La coupe parfaite »");
});

test("menu « … » : changer d’étape passe par la date et le montant", async ({ page }) => {
  await wishInEnvies(page);
  await card(page).getByRole("button", { name: "Plus d’actions" }).click();
  await menu(page).getByRole("button", { name: "Je l’ai commandé" }).click();
  const dialog = page.getByRole("dialog", { name: /Commandé/ });
  await expect(dialog.getByLabel("Date")).toBeVisible();
  await dialog.getByRole("button", { name: "Valider" }).click();
  await expect(toast(page)).toContainText("Étape : Commandé");
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  await page.goto("/commande");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
});

test("menu « … » → « Retirer de mes envies » met l’article à la corbeille, « Annuler » le remet", async ({ page }) => {
  await wishInEnvies(page);
  await card(page).getByRole("button", { name: "Plus d’actions" }).click();
  await menu(page).getByRole("button", { name: "Retirer de mes envies" }).click();
  await expect(toast(page)).toContainText("Retiré de tes envies");
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(1);

  await card(page).getByRole("button", { name: "Plus d’actions" }).click();
  await menu(page).getByRole("button", { name: "Retirer de mes envies" }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  await page.goto("/reglages/corbeille");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
});
