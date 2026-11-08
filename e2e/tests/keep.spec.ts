import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
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

test("« Ajouter à mes envies » garde l'article, Annuler le retire, et la fiche le garde après rechargement", async ({
  page,
}) => {
  await openSheet(page);
  await expect(page.getByRole("button", { name: "Favori" })).toHaveCount(0);
  await keepWish(page);
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Ajouté à tes envies");

  await toast.getByRole("button", { name: "Annuler" }).last().click();
  await expect(page.getByRole("button", { name: "Déjà commandé" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mon article" })).toHaveCount(0);

  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
});

test("Mims, Prioritaire et « Trop mims » avant d'ajouter ; sur la fiche gardée, En feu puis Annuler", async ({
  page,
}, testInfo) => {
  await openSheet(page);
  const levels = page.getByRole("group", { name: "Tu l’aimes comment ?" });
  await expect(levels.getByRole("button")).toHaveText([/Bof/, /J’aime/, /Mims/, /En feu/]);
  await expect(levels.getByRole("button", { name: "J’aime" })).toHaveAttribute("aria-pressed", "true");
  await levels.getByRole("button", { name: "Mims" }).click();
  await expect(levels.getByRole("button", { name: "Mims" })).toHaveAttribute("aria-pressed", "true");
  await expect(levels.getByRole("button", { name: "J’aime" })).toHaveAttribute("aria-pressed", "false");
  const priority = page.getByRole("button", { name: "Prioritaire" });
  await expect(priority).toHaveAttribute("aria-pressed", "false");
  await priority.click();
  await expect(priority).toHaveAttribute("aria-pressed", "true");
  const why = page.getByLabel("Pourquoi ? (facultatif)");
  await expect(why).toHaveAttribute("maxlength", "200");
  await why.fill("Trop mims");
  await page.getByRole("region", { name: "Garder cet article" }).screenshot({ path: testInfo.outputPath("keep.png") });
  await expect(page.getByRole("button", { name: "Ajouter à une liste" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Déjà commandé" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  await page.getByRole("button", { name: "Ajouter à mes envies" }).click();
  const mine = page.getByRole("region", { name: "Mon article" });
  await expect(mine).toBeVisible();
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Ajouté à tes envies");
  // Her item shows what she chose, and changes it in place (the « Ton envie » block of the sheet).
  const wish = page.getByRole("region", { name: "Ton envie" });
  const kept = wish.getByRole("group", { name: "Tu l’aimes comment ?" });
  await expect(kept.getByRole("button", { name: "Mims" })).toHaveAttribute("aria-pressed", "true");
  await expect(wish.getByRole("button", { name: "Prioritaire" })).toHaveAttribute("aria-pressed", "true");
  await expect(wish.getByLabel("Pourquoi ? (facultatif)")).toHaveValue("Trop mims");
  await kept.getByRole("button", { name: "En feu" }).click();
  await expect(toast).toContainText("Niveau : En feu");
  await expect(kept.getByRole("button", { name: "En feu" })).toHaveAttribute("aria-pressed", "true");
  await toast.getByRole("button", { name: "Annuler" }).last().click();
  await expect(kept.getByRole("button", { name: "Mims" })).toHaveAttribute("aria-pressed", "true");

  await wish.getByLabel("Pourquoi ? (facultatif)").fill("Trop trop mims");
  await wish.getByRole("button", { name: "Enregistrer l’avis" }).click();
  await expect(toast).toContainText("Avis enregistré");
  await mine.screenshot({ path: testInfo.outputPath("kept-level.png") });
  expect((await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id)).toEqual([]);

  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  await expect(card).toContainText("🥰");
  await expect(card.getByRole("button", { name: /niveau : Mims/ })).toBeVisible();
  await expect(card.getByText("Prioritaire", { exact: true })).toBeVisible();
  await expect(card).toContainText("Trop trop mims");
});

test("l'étape se change dans une fenêtre accessible, avec date et montant", async ({ page }) => {
  await openSheet(page);
  await page.getByRole("button", { name: "Déjà commandé" }).click();
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
  await keepWish(page);
  await page.getByLabel("Taille", { exact: true }).fill("M");
  await page.getByLabel("Notes").fill("Offerte par Léa");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Modifications enregistrées");

  await page.getByPlaceholder("Nouvelle étiquette").fill("Été");
  await page.getByRole("button", { name: "Créer et ajouter" }).last().click();
  await expect(page.getByRole("button", { name: "Été", pressed: true })).toBeVisible();

  await page.getByRole("button", { name: "Ajouter une photo" }).click();

  await page.getByTestId("photo-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PIXEL });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("img")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("kept.png"), fullPage: true });

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  await page.getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Article supprimé");
  await expect(page.getByRole("button", { name: "Déjà commandé" })).toBeVisible();
});

test("un article déjà gardé ailleurs : « Ajouter à une liste » l'ajoute à l'article existant", async ({
  page,
  context,
}) => {
  await openSheet(page);
  // The same sheet, open in another tab, where she keeps it first.
  const other = await context.newPage();
  await other.goto(page.url());
  await keepWish(other);
  await expect(other.getByRole("heading", { name: "Mon article" })).toBeVisible();

  // The first tab still shows the keep actions: the API answers with the existing item.
  await page.getByRole("button", { name: "Ajouter à une liste" }).click();
  const dialog = page.getByRole("dialog", { name: "Ajouter à une liste" });
  await dialog.getByLabel("Nouvelle liste").fill("Printemps");
  await dialog.getByRole("button", { name: "Créer et ajouter" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Printemps", pressed: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Ajouté à la liste Printemps");
});

test("un article gardé dans un autre profil : bandeau « Déjà dans le profil … »", async ({ page }) => {
  await openSheet(page);
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  const sheet = page.url();

  const lea = await page.evaluate(async () => {
    const response = await fetch("/api/me/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Léa", audience: "women", color: "rose" }),
    });
    return (await response.json()) as { id: string };
  });
  await page.goto(`${sheet.split("?")[0]}?profil=${lea.id}`);
  await expect(page.getByText("Déjà dans le profil Moi")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
});

test("passer à « Reçu » avec le prix payé : l'article est dans Dressing, puis Annuler", async ({ page }) => {
  await openSheet(page);
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();

  await page.getByRole("button", { name: "Passer à « Reçu »" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Montant payé (facultatif)").fill("19,90");
  await dialog.getByRole("button", { name: "Valider" }).click();
  await expect(page.getByText("Payé : 19,90")).toBeVisible();
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Étape : Reçu");
  // The Dressing view (another page in the same context) lists it while the undo is still on offer.
  const dressing = await page.context().newPage();
  await dressing.goto("/dressing");
  await expect(dressing.getByTestId("item-card")).toHaveCount(1);
  await dressing.close();
  await toast.getByRole("button", { name: "Annuler" }).last().click();
  await expect(page.getByText("Payé : 19,90")).toHaveCount(0);
  await page.goto("/dressing");
  await expect(page.getByRole("heading", { name: "Ton dressing est vide" })).toBeVisible();
});

test("deux messages empilés : survoler la pile déploie les bulles, l'Annuler du plus ancien est cliquable", async ({
  page,
}) => {
  await openSheet(page);
  await page.getByRole("button", { name: "Ajouter à mes envies" }).click();
  const wish = page.getByRole("region", { name: "Ton envie" });
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Ajouté à tes envies");
  await wish.getByRole("group", { name: "Tu l’aimes comment ?" }).getByRole("button", { name: "En feu" }).click();
  await expect(toast).toContainText("Niveau : En feu");
  await expect(toast.getByRole("button", { name: "Annuler" })).toHaveCount(2);
  await toast.locator('[data-toast-rank="0"]').hover();
  // Fanned out: the older bubble sits fully above the newest one, nothing overlaps.
  const older = toast.locator('[data-toast-rank="1"]');
  const newest = toast.locator('[data-toast-rank="0"]');
  await expect
    .poll(async () => {
      const [o, n] = [await older.boundingBox(), await newest.boundingBox()];
      return o && n ? o.y + o.height <= n.y : false;
    })
    .toBe(true);
  await older.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("button", { name: "Ajouter à mes envies" })).toBeVisible();
});
