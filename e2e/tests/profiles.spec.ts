import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 18: a second profile (« Léa »), bulk move, filtering by profile, delete refused while non-empty.

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });

async function keepFavorite(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

test("créer « Léa », y déplacer deux articles en lot, filtrer par profil, suppression refusée tant qu'elle n'est pas vide", async ({
  page,
}) => {
  await keepFavorite(page);
  await keepFavorite(page);
  await keepFavorite(page);

  await page.goto("/reglages/profils");
  const add = page.getByRole("form", { name: "Nouveau profil" });
  await add.getByLabel("Nom").fill("Léa");
  await add.getByLabel("Public").selectOption("child");
  await add.getByLabel("Précision").selectOption("girl");
  await add.getByRole("button", { name: "Ajouter un profil" }).click();
  await expect(toast(page)).toContainText("Profil « Léa » ajouté");

  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(3);
  const boxes = page.getByRole("checkbox", { name: new RegExp(`Sélectionner ${PRODUCT.name}`) });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  const bar = page.getByRole("region", { name: "Actions sur la sélection" });
  await expect(bar).toContainText("2 articles choisis");
  await bar.getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("dialog", { name: "Déplacer vers un profil" }).getByRole("button", { name: "Léa" }).click();
  await expect(toast(page)).toContainText("2 articles déplacés vers Léa");
  await expect(page.getByTestId("item-card")).toHaveCount(1);

  // « Annuler » brings them back.
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(3);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await bar.getByRole("button", { name: "Profil", exact: true }).click();
  await page.getByRole("dialog", { name: "Déplacer vers un profil" }).getByRole("button", { name: "Léa" }).click();
  await expect(toast(page)).toContainText("2 articles déplacés vers Léa");
  await expect(page.getByTestId("item-card")).toHaveCount(1);

  // Filter by profile: the choice lives in the address.
  const switcher = page.getByLabel("Profil", { exact: true }).filter({ visible: true });
  await switcher.selectOption({ label: "Léa" });
  await expect(page).toHaveURL(/profil=/);
  await expect(page.getByTestId("item-card")).toHaveCount(2);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
  await switcher.selectOption({ label: "Moi" });
  await expect(page.getByTestId("item-card")).toHaveCount(1);

  // Léa holds articles: deleting her is refused.
  await page.goto("/reglages/profils");
  await page.getByRole("button", { name: "Supprimer Léa" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer le profil" }).click();
  await expect(page.getByText("Déplace d’abord ses articles.")).toBeVisible();
});
