import type { Locator } from "@playwright/test";
import type pg from "pg";
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

/**
 * Waits until every capture of the shop at this address is finished. The admin capture queue is shared by the
 * whole suite and handles one job at a time (localConcurrency 1): under load a job waits its turn, so the wait
 * is on the capture's own state, not on a fixed delay.
 */
async function capturesFinished(db: pg.Pool, host: string, trigger: "admin_test" | "any", expected: number) {
  await expect
    .poll(
      async () => {
        const { rows } = await db.query<{ status: string }>(
          `select c.status from captures c join shop_domains d on d.shop_id = c.shop_id
           where d.domain = $1 and ($2 = 'any' or c.trigger = $2)`,
          [host, trigger],
        );
        const done = rows.filter((row) => !["queued", "running"].includes(row.status));
        return done.length >= expected && done.length === rows.length;
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
}

test("une admin ajoute une boutique depuis un lien (brouillon), puis teste un lien", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  // Two captures wait their turn in the admin queue, which the whole suite shares: the default 30 s is not enough under load.
  test.slow();
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
  await capturesFinished(db, host, "any", 1);
  await expect(detail(main, "Nom")).toHaveText(PRODUCT.name);

  await page.getByRole("link", { name: "Ouvrir la boutique" }).click();
  await expect(page).toHaveURL(/\/admin\/boutiques\/[0-9a-f-]{36}$/);
  const tester = page.getByRole("region", { name: "Tester un lien" });
  await tester.getByLabel("Adresse du produit").fill(url);
  await tester.getByRole("button", { name: "Lancer le test" }).click();
  await capturesFinished(db, host, "admin_test", 2);
  await expect(detail(tester, "Méthode")).toHaveText("Shopify");
  await expect(detail(tester, "Nom")).toHaveText(PRODUCT.name);
});
