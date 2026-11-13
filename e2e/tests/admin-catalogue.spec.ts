import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type pg from "pg";
import { sessionsOf, signInAsAdmin } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// Catalogue « Découvrir », task 4: the admin validates a shop, ticks its values and runs its import (queued only: the
// shop has no address, so the in-process worker stops at once without any request), files an article « À classer »
// with its siblings of the same type, and hides a reported article. The database is shared by the whole suite: every
// test brings its own shop, articles and reference entries under a unique tag.

const axe = async (page: Page) => {
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

/** A Shopify shop of its own, without any domain or test page. */
async function seedShop(db: pg.Pool, status: "pending" | "published") {
  const tag = randomUUID().slice(0, 8);
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform) values ($1, $2, $3, 'shopify') returning id`,
    [`Boutique e2e ${tag}`, `e2e-admin-catalogue-${tag}`, status],
  );
  return { id: rows[0]?.id ?? "", name: `Boutique e2e ${tag}`, tag };
}

async function seedProduct(db: pg.Pool, shopId: string, name: string, productType?: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into products (shop_id, canonical_url, name, price_cents, currency, shop_data)
     values ($1, $2, $3, 4900, 'EUR', $4::jsonb) returning id`,
    [
      shopId,
      `https://admin-catalogue.e2e.test/${randomUUID()}`,
      name,
      JSON.stringify(productType ? { category: productType } : {}),
    ],
  );
  return rows[0]?.id ?? "";
}

test("une admin valide une boutique, coche ses valeurs et lance l’import de son catalogue", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "pending");
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto("/admin/boutiques?status=pending");
  await page.getByRole("link", { name: shop.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: shop.name })).toBeVisible();
  const review = page.getByRole("region", { name: "Validation" });
  await expect(review).toContainText("arrivée par un lien collé");
  await axeLightAndDark(page);

  await review.getByRole("button", { name: "Valider" }).click();
  await expect(review).toContainText("Boutique publiée");
  await expect(review.getByRole("button", { name: "Valider" })).toHaveCount(0);
  const status = await db.query<{ status: string }>("select status from shops where id = $1", [shop.id]);
  expect(status.rows).toEqual([{ status: "published" }]);

  const catalogue = page.getByRole("region", { name: "Catalogue" });
  await catalogue.getByRole("checkbox", { name: "Made in France" }).check();
  await catalogue.getByRole("checkbox", { name: "Retours gratuits" }).check();
  await catalogue.getByRole("checkbox", { name: /Importer tout le catalogue/ }).check();
  await catalogue.getByRole("button", { name: "Enregistrer" }).click();
  await expect(catalogue.getByText("Catalogue enregistré.")).toBeVisible();
  const saved = await db.query("select values, import_enabled from shops where id = $1", [shop.id]);
  expect(saved.rows).toEqual([{ values: ["made_in_france", "free_returns"], import_enabled: true }]);
  await expect(catalogue.getByText("Jamais")).toBeVisible();

  await catalogue.getByRole("button", { name: "Importer maintenant" }).click();
  await expect(catalogue.getByText(/Import lancé|déjà en cours/)).toBeVisible();
  const jobs = await db.query<{ n: number }>(
    "select count(*)::int as n from pgboss.job where name = 'catalogue-import' and singleton_key = $1",
    [shop.id],
  );
  expect(jobs.rows[0]?.n).toBeGreaterThanOrEqual(1);
  const audit = await db.query<{ action: string }>(
    "select action from admin_audit_log where target = $1 order by created_at",
    [`shop:${shop.id}`],
  );
  expect(audit.rows.map((r) => r.action)).toEqual(["shop.publish", "shop.update", "shop.import"]);
});

test("une admin classe un article « À classer » et l’applique aux articles du même type", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  const type = `Robe e2e ${shop.tag}`;
  const category = `Robes e2e ${shop.tag}`;
  const color = `Prune e2e ${shop.tag}`;
  await db.query("insert into categories (slug, name) values ($1, $2)", [`robes-e2e-${shop.tag}`, category]);
  await db.query("insert into colors (slug, name, hex) values ($1, $2, '#6B2D5C')", [`prune-e2e-${shop.tag}`, color]);
  try {
    const first = await seedProduct(db, shop.id, `Robe portefeuille ${shop.tag}`, type);
    const sibling = await seedProduct(db, shop.id, `Robe chemise ${shop.tag}`, type);
    await signInAsAdmin(page, request, db, userAgentTag);

    await page.goto("/admin/catalogue/a-classer");
    await expect(page.getByRole("heading", { level: 1, name: "À classer" })).toBeVisible();
    const row = (name: string) =>
      page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const form = row(`Robe portefeuille ${shop.tag}`);
    await expect(form).toBeVisible();
    await axeLightAndDark(page);

    await form.getByRole("combobox", { name: "Type" }).selectOption({ label: category });
    await form.getByRole("combobox", { name: "Couleur" }).selectOption({ label: color });
    await form.getByRole("checkbox", { name: "Appliquer aux articles du même type de cette boutique" }).check();
    await form.getByRole("button", { name: "Classer" }).click();

    await expect(row(`Robe portefeuille ${shop.tag}`)).toHaveCount(0);
    await expect(row(`Robe chemise ${shop.tag}`)).toHaveCount(0);
    const { rows } = await db.query<{ source: string; category: string; color: string }>(
      `select p.category_source as source, c.name as category, co.name as color
       from products p join categories c on c.id = p.category_id join colors co on co.id = p.color_id
       where p.id = any($1::uuid[])`,
      [[first, sibling]],
    );
    expect(rows).toEqual([
      { source: "admin", category, color },
      { source: "admin", category, color },
    ]);
  } finally {
    await db.query("delete from products where shop_id = $1", [shop.id]);
    await db.query("delete from categories where slug = $1", [`robes-e2e-${shop.tag}`]);
    await db.query("delete from colors where slug = $1", [`prune-e2e-${shop.tag}`]);
  }
});

test("une admin masque du catalogue un article signalé", async ({ page, request, db, userAgentTag }) => {
  const shop = await seedShop(db, "published");
  const name = `Article signalé ${shop.tag}`;
  const product = await seedProduct(db, shop.id, name);
  await signInAsAdmin(page, request, db, userAgentTag);
  const [session] = await sessionsOf(db, userAgentTag);
  await db.query("insert into product_reports (product_id, user_id, reason) values ($1, $2, 'shocking')", [
    product,
    session?.userId,
  ]);

  await page.goto("/admin/catalogue/signalements");
  await expect(page.getByRole("heading", { level: 1, name: "Signalements" })).toBeVisible();
  const line = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name }) });
  await expect(line).toContainText("1 signalement");
  await expect(line).toContainText("Choquant (1)");
  await axeLightAndDark(page);

  await line.getByRole("button", { name: "Masquer du catalogue" }).click();
  await expect(line).toHaveCount(0);
  const hidden = await db.query<{ hidden: boolean }>(
    "select hidden_at is not null as hidden from products where id = $1",
    [product],
  );
  expect(hidden.rows).toEqual([{ hidden: true }]);
  const reports = await db.query("select resolution from product_reports where product_id = $1", [product]);
  expect(reports.rows).toEqual([{ resolution: "hidden" }]);
});
