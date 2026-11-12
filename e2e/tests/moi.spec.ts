import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 7 (spec R6): « Moi » — her name, « Réglages », four tiles (Dressing, À vendre, Commandes
// « Bientôt », Budget), the coming return dates, « Mon dressing », and every page the old list gave.

type Db = Parameters<typeof sessionsOf>[0];

const axe = async (page: Page) => {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
};

async function axeLightAndDark(page: Page) {
  await page.emulateMedia({ colorScheme: "light" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
}

async function pasteAndWish(page: Page) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
}

/** Four articles: two in her dressing, one for sale, one wish; a 200 € monthly budget on « Moi ». */
async function seed(page: Page, db: Db, userAgentTag: string) {
  for (let i = 0; i < 4; i++) await pasteAndWish(page);
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  const { rows } = await db.query<{ id: string; profile_id: string }>(
    "select id, profile_id from items where user_id = $1 order by created_at",
    [userId],
  );
  const [a, b, c] = rows;
  if (!a || !b || !c) throw new Error("items missing");
  await db.query("update items set stage = 'owned' where id = any($1)", [[a.id, b.id]]);
  await db.query("update items set stage = 'for_sale', sale_price_cents = 2000 where id = $1", [c.id]);
  await db.query("insert into budgets (user_id, profile_id, amount_cents, period) values ($1, $2, 20000, 'month')", [
    userId,
    a.profile_id,
  ]);
}

const main = (page: Page) => page.getByRole("main");

test("Moi montre son dressing, ce qu’elle vend, son budget, les commandes à venir et ses réglages", async ({
  page,
  db,
  userAgentTag,
}) => {
  await seed(page, db, userAgentTag);
  await page.goto("/moi");
  await expect(main(page).getByText("Moi", { exact: true }).first()).toBeVisible();
  await expect(main(page).getByRole("heading", { level: 1 })).toBeVisible();

  const glance = main(page).getByRole("region", { name: "En un coup d’œil" });
  const dressing = glance.getByRole("link", { name: /^Dressing/ });
  await expect(dressing).toContainText("2");
  await expect(dressing).toHaveAttribute("href", "/articles?etape=dressing");
  const forSale = glance.getByRole("link", { name: /^À vendre/ });
  await expect(forSale).toContainText("1");
  await expect(forSale).toHaveAttribute("href", "/articles?etape=a-vendre");
  const budget = glance.getByRole("link", { name: /^Budget/ });
  await expect(budget).toHaveText(/^Budget\s*0\s€\s*sur 200\s€ ce mois$/);
  await expect(budget).toHaveAttribute("href", "/articles?etape=envie");
  // Orders and parcels come with chantier 3: said, not linked.
  const orders = glance.getByTestId("tile-commandes");
  await expect(orders).toContainText("Commandes");
  await expect(orders).toContainText("Bientôt");
  await expect(orders.getByRole("link")).toHaveCount(0);

  await expect(
    main(page).getByText("Les dates limites de retour, remboursements et avoirs arriveront ici."),
  ).toBeVisible();

  const mine = main(page).getByRole("region", { name: "Mon dressing" });
  await expect(mine.getByRole("listitem")).toHaveCount(2);
  await expect(mine.getByRole("link", { name: "Tout voir" })).toHaveAttribute("href", "/articles?etape=dressing");

  await axeLightAndDark(page);

  await main(page).getByRole("link", { name: "Réglages", exact: true }).first().click();
  await expect(page).toHaveURL(/\/reglages\/profils$/);
});

test("Moi mène toujours à toutes ses pages d’avant, et à l’apparence", async ({ page }) => {
  await page.goto("/moi");
  const places = main(page).getByRole("navigation", { name: "Mes pages" });
  const expected: [string | RegExp, RegExp][] = [
    ["Mes envies", /\/articles\?etape=envie$/],
    ["Commandé", /\/articles\?etape=commande$/],
    ["Mon dressing", /\/articles\?etape=dressing$/],
    ["À vendre", /\/articles\?etape=a-vendre$/],
    ["Mes listes", /\/listes$/],
    [/^Mon budget/, /\/articles\?etape=envie$/],
    ["Réglages", /\/reglages\/profils$/],
    [/^Mon compte/, /\/reglages\/compte$/],
    ["Ajouter depuis le téléphone", /\/aide\/telephone$/],
  ];
  for (const [name, href] of expected) {
    await expect(places.getByRole("link", { name, exact: typeof name === "string" })).toHaveAttribute("href", href);
  }
  await expect(main(page).getByRole("button", { name: "Passer en mode sombre" })).toBeVisible();
  // A new account: the tiles say what to do rather than showing zeros only.
  const mine = main(page).getByRole("region", { name: "Mon dressing" });
  await expect(mine).toContainText("Ton dressing est vide");
  await axeLightAndDark(page);
});
