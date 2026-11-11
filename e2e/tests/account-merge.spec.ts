import type { Page } from "@playwright/test";
import { signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 18: an anonymous wardrobe survives sign-in, and merges into an account that has the same product.

async function pasteAndWish(page: Page, url: string): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(url);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

test("anonyme avec 3 articles : bandeau, connexion par code, articles toujours là", async ({ page, request }) => {
  for (let i = 0; i < 3; i++) await pasteAndWish(page, autoProductUrl());
  const banner = page.getByRole("region", { name: "Proposition de compte" });
  await expect(banner).toContainText("Garde tes articles");
  await expect(banner.getByRole("link", { name: "Créer mon compte" })).toBeVisible();

  await signInWithEmailCode(page, request, uniqueEmail());
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(3);
});

test("connexion à un compte qui a déjà l'un des articles : réunis, sans doublon", async ({ page, request }) => {
  const shared = autoProductUrl();
  const email = uniqueEmail();

  // The account first: it keeps the shared product.
  await pasteAndWish(page, shared);
  await signInWithEmailCode(page, request, email);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Anonymous again: the same product plus two others, then signs in to the same account.
  await pasteAndWish(page, shared);
  await pasteAndWish(page, autoProductUrl());
  await pasteAndWish(page, autoProductUrl());
  await signInWithEmailCode(page, request, email);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(3);
});
