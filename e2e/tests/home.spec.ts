import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { AUTO_SHOP, autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 5: « Accueil » — « Bonjour » and how many news, the une, « Ce qui a changé », the add box
// (the same capture as « Coller un lien »), a tip she closes, « Boutiques à découvrir », « Tes envies du moment »;
// a new account sees what to do.

type Db = Parameters<typeof sessionsOf>[0];

const axe = async (page: Page) => {
  // Once the cards have risen in (half faded, their text would read paler than it is).
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

/** Her first wish, pasted in the add box of « Accueil ». */
async function firstWish(page: Page, db: Db, userAgentTag: string) {
  await page.goto("/");
  const box = page.getByRole("region", { name: "Tu as vu un vêtement qui te plaît ?" });
  await expect(box.getByPlaceholder("Colle son lien ici…")).toBeVisible();
  await box.getByLabel("Coller un lien").fill(autoProductUrl());
  await box.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  const { rows } = await db.query<{ id: string; product_id: string; shop_id: string }>(
    `select i.id, i.product_id, p.shop_id from items i join products p on p.id = i.product_id where i.user_id = $1`,
    [userId],
  );
  const [item] = rows;
  if (!item) throw new Error("no item");
  return { userId, ...item };
}

/** A price drop on her wish (30 € ten days ago, the price of today's capture since), and a list with news. */
async function seedNews(db: Db, wish: { userId: string; id: string; product_id: string; shop_id: string }) {
  await db.query(
    `insert into product_history (product_id, seen_at, price_cents, sizes)
     values ($1, now() - interval '10 days', 3000, '{}'::jsonb)`,
    [wish.product_id],
  );
  const { rows } = await db.query<{ id: string }>(
    `insert into wishlists (user_id, name, allow_gifts, gift_occasion, gift_date)
     values ($1, 'Anniversaire', true, 'Mon anniversaire', (now() - interval '3 days')::date) returning id`,
    [wish.userId],
  );
  const listId = rows[0]?.id ?? "";
  await db.query("insert into wishlist_items (wishlist_id, item_id) values ($1, $2)", [listId, wish.id]);
  await db.query(
    `insert into wishlist_opinions (wishlist_id, item_id, author_name, author_name_key, level, note, created_at, updated_at)
     values ($1, $2, 'Inès', 'ines', 4, 'Fonce, il est parfait', now() - interval '2 hours', now() - interval '2 hours')`,
    [listId, wish.id],
  );
  await db.query(
    `insert into group_orders (wishlist_id, shop_id, status, shipping_label, shipping_cents, currency, updated_at)
     values ($1, $2, 'open', 'Colissimo', 590, 'EUR', now() - interval '1 day')`,
    [listId, wish.shop_id],
  );
  return listId;
}

test("une nouvelle utilisatrice voit l’accueil vide qui explique quoi faire, sans liste vide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Bienvenue sur Closyria" })).toBeVisible();
  await expect(page.getByText("Bonjour", { exact: true })).toBeVisible();
  const start = page.getByRole("region", { name: "Comment ça marche" });
  await expect(start.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Tu as vu un vêtement qui te plaît ?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ce qui a changé" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tes envies du moment" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Boutiques à découvrir" })).toHaveCount(0);
  await axeLightAndDark(page);

  // « Autres façons d'ajouter » opens the + sheet: photo, share from a shop.
  await page.getByRole("button", { name: "Autres façons d’ajouter" }).click();
  const sheet = page.getByRole("dialog", { name: "Ajouter un article" });
  await expect(sheet.getByRole("button", { name: /Prendre une photo/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Partager depuis une boutique/ })).toBeVisible();
});

test("la zone « Colle son lien ici » capture comme avant ; ses envies, ses boutiques et l’astuce qu’elle ferme", async ({
  page,
  db,
  userAgentTag,
}) => {
  await firstWish(page, db, userAgentTag);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Rien de neuf pour l’instant" })).toBeVisible();

  const wishes = page.getByRole("region", { name: "Tes envies du moment" });
  await expect(wishes.getByTestId("item-card")).toHaveCount(1);
  await expect(wishes.getByRole("link", { name: "Mes articles" })).toHaveAttribute("href", "/articles?etape=envie");

  const shops = page.getByRole("region", { name: "Boutiques à découvrir" });
  await expect(shops.getByRole("link", { name: "Toutes" })).toHaveAttribute("href", "/decouvrir");
  await expect(shops.getByRole("link", { name: new RegExp(AUTO_SHOP.name) })).toHaveAttribute(
    "href",
    /^\/articles\?boutique=/,
  );

  const tip = page.getByRole("complementary", { name: "Astuce" });
  await expect(tip).toContainText("Touche deux fois la photo d’un article");
  await tip.getByRole("button", { name: "Fermer l’astuce" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Rien de neuf pour l’instant" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Astuce" })).toHaveCount(0);
});

test("la une et « Ce qui a changé » montrent ses nouvelles avec leur lien", async ({ page, db, userAgentTag }) => {
  const wish = await firstWish(page, db, userAgentTag);
  const listId = await seedNews(db, wish);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "4 nouvelles pour toi" })).toBeVisible();
  const une = page.getByRole("article", { name: /passe à 23,00/ });
  await expect(une).toContainText("Baisse de prix");
  await expect(une).toContainText(`−7,00 € chez ${AUTO_SHOP.name}`);
  await expect(une.getByRole("link", { name: "Voir l’article" })).toHaveAttribute(
    "href",
    `/produits/${wish.product_id}`,
  );

  const news = page.getByRole("region", { name: "Ce qui a changé" });
  const rows = news.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Inès a donné son avis sur");
  await expect(rows.nth(0)).toContainText("« Fonce, il est parfait »");
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", `/listes/${listId}`);
  await expect(rows.nth(1)).toContainText(`Commande groupée ${AUTO_SHOP.name}`);
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", `/listes/${listId}/commande-groupee`);
  await expect(rows.nth(2)).toContainText("Anniversaire : as-tu reçu tes cadeaux ?");
  await expect(rows.nth(2)).toContainText("Mon anniversaire est passé");
  await axeLightAndDark(page);

  await rows.nth(0).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/listes/${listId}$`));
});
