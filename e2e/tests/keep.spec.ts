import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 14: the product sheet keeps the product in one gesture, then shows HER item.

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function openSheet(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
}

test("♡ garde l'article, Annuler le retire, et la fiche garde l'article après rechargement", async ({ page }) => {
  await openSheet(page);
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Gardé en favori");

  await toast.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("button", { name: "Je l’ai commandé" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mon article" })).toHaveCount(0);

  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
});

test("l'étape se change dans une fenêtre accessible, avec date et montant", async ({ page }) => {
  await openSheet(page);
  await page.getByRole("button", { name: "Je l’ai commandé" }).click();
  await expect(page.getByRole("button", { name: /Commandé \(étape actuelle\)/ })).toBeDisabled();

  const open = page.getByRole("button", { name: "Passer à « Reçu »" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Passer à « Reçu »" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await dialog.getByLabel("Montant payé (facultatif)").fill("39,90");
  await dialog.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Payé : 39,90")).toBeVisible();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Étape : Reçu");
});

test("taille, notes, étiquette, photo personnelle et suppression", async ({ page }, testInfo) => {
  await openSheet(page);
  await page.getByRole("button", { name: "Favori" }).click();
  await page.getByLabel("Taille", { exact: true }).fill("M");
  await page.getByLabel("Notes").fill("Offerte par Léa");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Modifications enregistrées");

  await page.getByPlaceholder("Nouvelle étiquette").fill("Été");
  await page.getByRole("button", { name: "Créer et ajouter" }).last().click();
  await expect(page.getByRole("button", { name: "Été", pressed: true })).toBeVisible();

  await page.getByTestId("photo-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PIXEL });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("img")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("kept.png"), fullPage: true });

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Article supprimé");
  await expect(page.getByRole("button", { name: "Je l’ai commandé" })).toBeVisible();
});
