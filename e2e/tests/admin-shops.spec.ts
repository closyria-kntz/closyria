import type { Locator } from "@playwright/test";
import { signInAsAdmin } from "../fixtures/auth";
import { newShopUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 1, task 14: the shop admin. The draft shop gets a loopback name of its own (a domain belongs to
// one shop), which the in-process capture worker resolves to the fake shop.

/** The value next to a label of a capture outcome (`<dt>label</dt><dd>value</dd>`). */
const detail = (scope: Locator, label: string) =>
  scope
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");

test("une admin ajoute une boutique depuis un lien (brouillon), puis teste un lien", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  await signInAsAdmin(page, request, db, userAgentTag);
  const { host, url } = newShopUrl();

  await page.goto("/admin/boutiques");
  await page.getByRole("link", { name: "Ajouter une boutique" }).click();
  await expect(page).toHaveURL(/\/admin\/boutiques\/nouvelle$/);
  await page.getByLabel("Adresse d’un produit de la boutique").fill(url);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByText("Boutique créée en brouillon.")).toBeVisible();

  const { rows } = await db.query<{ status: string }>(
    "select s.status from shops s join shop_domains d on d.shop_id = s.id where d.domain = $1",
    [host],
  );
  expect(rows).toEqual([{ status: "draft" }]);
  // The test capture of the new shop pre-fills its settings.
  const main = page.getByRole("main");
  await expect(detail(main, "Nom")).toHaveText(PRODUCT.name, { timeout: 15_000 });

  await page.getByRole("link", { name: "Ouvrir la boutique" }).click();
  await expect(page).toHaveURL(/\/admin\/boutiques\/[0-9a-f-]{36}$/);
  const tester = page.getByRole("region", { name: "Tester un lien" });
  await tester.getByLabel("Adresse du produit").fill(url);
  await tester.getByRole("button", { name: "Lancer le test" }).click();
  await expect(detail(tester, "Méthode")).toHaveText("Shopify", { timeout: 15_000 });
  await expect(detail(tester, "Nom")).toHaveText(PRODUCT.name);
});
