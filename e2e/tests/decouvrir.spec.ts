import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type pg from "pg";
import { signInAsAdmin } from "../fixtures/auth";
import { setupValue } from "../fixtures/paths";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 6: « Découvrir » shows the published shops Closyria knows (photo, name, domain, how many
// articles), each opening its site in a new tab, a search on their name or domain (it searches the catalogue too,
// catalogue.spec.ts), and the « boutique de la semaine » an admin puts forward. The directory is shared by the whole suite: every test finds its own shops by a unique name.

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

const TINY_WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

/** A shop of its own (unique name and domain) with `products` products « Découvrir » shows (name, price, photo). */
async function seedShop(db: pg.Pool, name: string, status: "published" | "draft", products: number) {
  const tag = randomUUID().slice(0, 8);
  const domain = `${name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}-${tag}.e2e.test`;
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform, capture_mode) values ($1, $2, $3, 'other', 'manual') returning id`,
    [`${name} ${tag}`, `e2e-decouvrir-${tag}`, status],
  );
  const id = rows[0]?.id ?? "";
  await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [domain, id]);
  for (let i = 0; i < products; i++) {
    const product = await db.query<{ id: string }>(
      `insert into products (shop_id, canonical_url, name, price_cents, currency)
       values ($1, $2, $3, 4900, 'EUR') returning id`,
      [id, `https://${domain}/products/${i}`, `Article ${i} ${tag}`],
    );
    const productId = product.rows[0]?.id ?? "";
    const key = `products/${productId}/0.webp`;
    await mkdir(dirname(join(setupValue("E2E_STORAGE_DIR"), key)), { recursive: true });
    await writeFile(join(setupValue("E2E_STORAGE_DIR"), key), TINY_WEBP);
    await db.query(
      "insert into product_images (product_id, position, key, width, height, source_hash) values ($1, 0, $2, 1, 1, $3)",
      [productId, key, `h-${productId}`],
    );
  }
  return { id, name: `${name} ${tag}`, domain, tag };
}

test("la grille montre les boutiques publiées avec leur site, et la recherche les filtre par nom ou domaine", async ({
  page,
  db,
}) => {
  const shop = await seedShop(db, "Atelier Zéphyr", "published", 2);
  const draft = await seedShop(db, "Brouillon caché", "draft", 5);

  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1, name: "Les pépites des petites boutiques" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Découvrir", { exact: true })).toBeVisible();

  const grid = page.getByRole("region", { name: "Toutes les boutiques" });
  const card = grid.getByRole("link", { name: new RegExp(shop.name) });
  await expect(card).toBeVisible();
  await expect(card).toContainText(shop.domain);
  await expect(card).toContainText("2 articles");
  await expect(card).toHaveAttribute("href", `https://${shop.domain}`);
  await expect(card).toHaveAttribute("target", "_blank");
  await expect(card).toHaveAttribute("rel", /noopener/);
  await expect(page.getByRole("link", { name: new RegExp(draft.name) })).toHaveCount(0);
  await axeLightAndDark(page);

  const search = page.getByRole("searchbox", { name: "Rechercher un article ou une boutique" });
  await search.fill(shop.tag);
  await expect(grid.getByRole("link")).toHaveCount(1);
  await expect(grid.getByRole("link", { name: new RegExp(shop.name) })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /boutique/ })).toHaveText("1 boutique");
  // By its domain, whatever the case and the accents.
  await search.fill(`ATELIER-ZEPHYR-${shop.tag}`);
  await expect(grid.getByRole("link")).toHaveCount(1);
  await search.fill("zephyr");
  await expect(grid.getByRole("link", { name: new RegExp(shop.name) })).toBeVisible();
  await search.fill(draft.tag);
  await expect(grid.getByRole("link")).toHaveCount(0);
  await expect(page.getByText(`Aucune boutique ne correspond à « ${draft.tag} ».`)).toBeVisible();
  await search.fill("");
  await expect(grid.getByRole("link", { name: new RegExp(shop.name) })).toBeVisible();
});

test("sans aucune boutique, l’écran explique comment en faire apparaître", async ({ page }) => {
  // The suite's database always has shops: the answer of an empty directory is played to this page only.
  await page.route("**/api/shops", (route) => route.fulfill({ json: { featured: null, shops: [] } }));
  // Nor any article: no shop, no catalogue.
  await page.route("**/api/catalog?*", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, hasSizes: false } }),
  );
  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1, name: "Les pépites des petites boutiques" })).toBeVisible();
  await expect(
    page.getByText("Aucune boutique pour l’instant. Colle le lien d’un article : sa boutique apparaîtra ici."),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Toutes les boutiques" })).toHaveCount(0);
  await expect(page.getByText("Aucun article dans le catalogue pour l’instant.", { exact: false })).toBeVisible();
  await axeLightAndDark(page);
});

test("une admin met une boutique en boutique de la semaine : elle fait la une de Découvrir, puis la retire", async ({
  page,
  request,
  db,
  userAgentTag,
}, testInfo) => {
  // There is one « boutique de la semaine » for everyone: a single project features one, the others would race it.
  test.skip(testInfo.project.name !== "Desktop Chrome", "one featured shop for the whole suite");
  const shop = await seedShop(db, "Les Cœurs", "published", 3);
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto(`/admin/boutiques/${shop.id}`);
  const feature = page.getByRole("region", { name: "Boutique de la semaine" });
  await feature.getByRole("button", { name: "Mettre en boutique de la semaine" }).click();
  await expect(feature.getByRole("button", { name: "Retirer de la une" })).toBeVisible();

  await page.goto("/decouvrir");
  const une = page.getByRole("article", { name: shop.name });
  await expect(une).toContainText("La boutique de la semaine");
  await expect(une).toContainText("3 articles");
  const open = une.getByRole("link", { name: /Voir la boutique/ });
  await expect(open).toHaveAttribute("href", `https://${shop.domain}`);
  await expect(open).toHaveAttribute("target", "_blank");
  // Not twice: the une is out of the grid.
  await expect(
    page.getByRole("region", { name: "Toutes les boutiques" }).getByRole("link", { name: new RegExp(shop.name) }),
  ).toHaveCount(0);
  await axeLightAndDark(page);
  // On a phone too.
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(une.getByRole("link", { name: /Voir la boutique/ })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  // A search shows the matching shops, the one of the week among them.
  await page.getByRole("searchbox", { name: "Rechercher un article ou une boutique" }).fill(shop.tag);
  await expect(page.getByRole("article", { name: shop.name })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Toutes les boutiques" }).getByRole("link", { name: new RegExp(shop.name) }),
  ).toBeVisible();

  await page.goto(`/admin/boutiques/${shop.id}`);
  await feature.getByRole("button", { name: "Retirer de la une" }).click();
  await expect(feature.getByRole("button", { name: "Mettre en boutique de la semaine" })).toBeVisible();
  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1, name: "Les pépites des petites boutiques" })).toBeVisible();
  await expect(page.getByRole("article", { name: shop.name })).toHaveCount(0);
  const { rows } = await db.query<{ action: string }>(
    "select action from admin_audit_log where target = $1 order by created_at",
    [`shop:${shop.id}`],
  );
  expect(rows.map((r) => r.action)).toEqual(["shop.feature", "shop.unfeature"]);
});
