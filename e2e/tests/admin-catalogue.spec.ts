import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type pg from "pg";
import { sessionsOf, signInAsAdmin } from "../fixtures/auth";
import { setupValue } from "../fixtures/paths";
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

/** The admin's element under a point of the window (what a tap there would reach). */
const tagAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest("header, nav, main")?.tagName,
    [x, y],
  );

/** A Shopify shop of its own, without any domain or test page. */
async function seedShop(db: pg.Pool, status: "pending" | "published") {
  const tag = randomUUID().slice(0, 8);
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform) values ($1, $2, $3, 'shopify') returning id`,
    [`Boutique e2e ${tag}`, `e2e-admin-catalogue-${tag}`, status],
  );
  return { id: rows[0]?.id ?? "", name: `Boutique e2e ${tag}`, tag };
}

const TINY_WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

/** A complete article (name, price, photo), as « Découvrir » and « À classer » need it. */
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
  const id = rows[0]?.id ?? "";
  const key = `products/${id}/0.webp`;
  await mkdir(dirname(join(setupValue("E2E_STORAGE_DIR"), key)), { recursive: true });
  await writeFile(join(setupValue("E2E_STORAGE_DIR"), key), TINY_WEBP);
  await db.query(
    "insert into product_images (product_id, position, key, width, height, source_hash) values ($1, 0, $2, 1, 1, $3)",
    [id, key, `h-${id}`],
  );
  return id;
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

  await expect(catalogue.getByTestId("import-state")).toHaveText("Aucun import pour l’instant");
  await catalogue.getByRole("button", { name: "Importer maintenant" }).click();
  await expect(catalogue.getByText(/Import lancé|déjà en cours/)).toBeVisible();
  // « En attente », then the worker stops at once (no address): the page reads it again on its own.
  await expect(catalogue.getByTestId("import-state")).toHaveText("Adresse de la boutique introuvable", {
    timeout: 15_000,
  });
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
    // Each row opens the article's admin sheet, by a written link a finger high.
    const sheet = form.getByRole("link", { name: `Voir la fiche Robe portefeuille ${shop.tag}` });
    await expect(sheet).toHaveAttribute("href", `/admin/fiches/${first}`);
    expect((await sheet.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
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
  const sheet = line.getByRole("link", { name: `Voir la fiche ${name}` });
  await expect(sheet).toHaveAttribute("href", `/admin/fiches/${product}`);
  expect((await sheet.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await axeLightAndDark(page);

  await line.getByRole("button", { name: "Masquer du catalogue" }).click();
  // It asks first; nothing is hidden before the confirmation.
  const confirm = line.getByRole("alertdialog");
  await expect(confirm).toContainText("Masquer cet article de « Découvrir » ?");
  await confirm.getByRole("button", { name: "Annuler" }).click();
  await expect(confirm).toHaveCount(0);
  await line.getByRole("button", { name: "Masquer du catalogue" }).click();
  await line.getByRole("alertdialog").getByRole("button", { name: "Masquer du catalogue" }).click();
  await expect(line).toHaveCount(0);
  const hidden = await db.query<{ hidden: boolean }>(
    "select hidden_at is not null as hidden from products where id = $1",
    [product],
  );
  expect(hidden.rows).toEqual([{ hidden: true }]);
  const reports = await db.query("select resolution from product_reports where product_id = $1", [product]);
  expect(reports.rows).toEqual([{ resolution: "hidden" }]);

  // « Remettre dans le catalogue », from the hidden sheets.
  await page.getByRole("link", { name: "Voir les articles masqués" }).click();
  await expect(page).toHaveURL(/\/admin\/fiches\?catalogue=hidden/);
  await page.getByRole("link", { name }).click();
  await expect(page.getByText("Masqué de « Découvrir » le")).toBeVisible();
  // The article at the shop, in a new tab.
  const atShop = page.getByRole("link", { name: `Voir chez ${shop.name} (s’ouvre dans un nouvel onglet)` });
  await expect(atShop).toHaveAttribute("href", /^https:\/\/admin-catalogue\.e2e\.test\//);
  await expect(atShop).toHaveAttribute("target", "_blank");
  await expect(atShop).toHaveAttribute("rel", "noopener noreferrer");
  await axeLightAndDark(page);
  await page.getByRole("button", { name: "Remettre dans le catalogue" }).click();
  await expect(page.getByText("Article remis dans le catalogue.")).toBeVisible();
  await expect(page.getByText("Masqué de « Découvrir » le")).toHaveCount(0);
  const back = await db.query<{ hidden: boolean }>(
    "select hidden_at is not null as hidden from products where id = $1",
    [product],
  );
  expect(back.rows).toEqual([{ hidden: false }]);
});

test("l’avancement d’un import se lit tout seul dans la fiche boutique, et la liste le signale", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  await db.query(
    "update shops set import_state = 'running', import_started_at = now(), import_pages = 3, import_seen = 712 where id = $1",
    [shop.id],
  );
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto(`/admin/boutiques?status=published`);
  const listed = page.getByRole("row").filter({ has: page.getByRole("link", { name: shop.name }) });
  await expect(listed.getByTestId("importing-tag")).toHaveText("Import en cours");

  // The page is not rendered again while the import runs: the progress comes from the light status route.
  const pageReads: string[] = [];
  const statusReads: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/import-status")) statusReads.push(url);
    else if (url.includes("_rsc=") && url.includes(`/admin/boutiques/${shop.id}`)) pageReads.push(url);
  });
  await page.goto(`/admin/boutiques/${shop.id}`);
  const catalogue = page.getByRole("region", { name: "Catalogue" });
  const state = catalogue.getByTestId("import-state");
  await expect(state).toHaveText("Import en cours : page 3, 712 articles lus");
  // A first import has no total to measure against: the bar is indeterminate.
  const bar = catalogue.getByRole("progressbar", { name: "Avancement de l’import" });
  await expect(bar).toBeVisible();
  await expect(bar).not.toHaveAttribute("value");
  await expect(catalogue.getByRole("button", { name: "Importer maintenant" })).toBeDisabled();
  await axeLightAndDark(page);

  // The worker reads the next page: the status follows without a reload.
  const pageReadsAtStart = pageReads.length;
  await db.query("update shops set import_pages = 4, import_seen = 962 where id = $1", [shop.id]);
  await expect(state).toHaveText("Import en cours : page 4, 962 articles lus", { timeout: 15_000 });
  expect(statusReads.length).toBeGreaterThan(0);
  expect(pageReads).toHaveLength(pageReadsAtStart);
  // It ends (13:05 UTC is 14 h 05 in Paris in November).
  await db.query(
    `update shops set import_state = null, last_import_at = '2026-11-13T13:05:00Z', last_import_error = null,
       last_import_seen = 962, last_import_created = 12, last_import_removed = 3 where id = $1`,
    [shop.id],
  );
  await expect(state).toHaveText("Terminé à 14 h 05 : 962 articles (12 nouveaux, 3 retirés)", { timeout: 15_000 });
  await expect(bar).toHaveCount(0);
  await expect(catalogue.getByRole("button", { name: "Importer maintenant" })).toBeEnabled();

  // A job dead for over 6 h is not « en cours » any more.
  await db.query(
    "update shops set import_state = 'running', import_started_at = now() - interval '7 hours' where id = $1",
    [shop.id],
  );
  await page.reload();
  await expect(state).toHaveText("Terminé à 14 h 05 : 962 articles (12 nouveaux, 3 retirés)");
  await page.goto(`/admin/boutiques?status=published`);
  await expect(listed).toBeVisible();
  await expect(listed.getByTestId("importing-tag")).toHaveCount(0);
});

test("« Shopify nous demande de ralentir » : l’alerte du tableau de bord et des fiches boutique Shopify", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  const other = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform) values ($1, $2, 'published', 'other') returning id`,
    [`Autre ${shop.tag}`, `e2e-admin-other-${shop.tag}`],
  );
  // A 429 from a Shopify shop an hour ago (the database is shared: the alert lives only for this test).
  const until = new Date(Date.now() + 5 * 3_600_000);
  await db.query(
    `insert into crawl_slowdowns (platform, level, since, until) values ('shopify', 'doubled', now(), $1)
     on conflict (platform) do update set level = 'doubled', since = now(), until = $1`,
    [until],
  );
  try {
    const date = new Intl.DateTimeFormat("fr", {
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    }).format(until);
    const text = `Shopify nous demande de ralentir : imports espacés jusqu’au ${date}`;
    await signInAsAdmin(page, request, db, userAgentTag);

    await page.goto("/admin");
    await expect(page.getByTestId("shopify-slowdown")).toHaveText(text);
    await axeLightAndDark(page);
    await page.goto(`/admin/boutiques/${shop.id}`);
    await expect(page.getByTestId("shopify-slowdown")).toHaveText(text);
    // A shop that is not on Shopify is not concerned.
    await page.goto(`/admin/boutiques/${other.rows[0]?.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("shopify-slowdown")).toHaveCount(0);

    // Over: no alert.
    await db.query("update crawl_slowdowns set until = now() - interval '1 minute' where platform = 'shopify'");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("shopify-slowdown")).toHaveCount(0);
  } finally {
    await db.query("delete from crawl_slowdowns where platform = 'shopify'");
  }
});

test("une admin importe tout le catalogue d’une boutique WooCommerce : l’avancement puis « Terminé »", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform, test_url) values ($1, $2, 'published', 'woocommerce', $3)
     returning id`,
    [`Boutique Woo ${tag}`, `e2e-admin-woo-${tag}`, `${setupValue("E2E_FAKE_SHOP_URL")}/produit/e2e-woo-7101/`],
  );
  const shopId = rows[0]?.id ?? "";
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto(`/admin/boutiques/${shopId}`);
  const catalogue = page.getByRole("region", { name: "Catalogue" });
  // A WooCommerce shop has the whole-catalogue import, like a Shopify one.
  await expect(catalogue.getByRole("checkbox", { name: /Importer tout le catalogue/ })).toBeVisible();
  const state = catalogue.getByTestId("import-state");
  await expect(state).toHaveText("Aucun import pour l’instant");
  await catalogue.getByRole("button", { name: "Importer maintenant" }).click();

  // The worker reads the shop's Store API (its listing answers after 2.5 s): « En attente », then under way.
  await expect(state).toHaveText(/^(En attente|Import en cours)/);
  await expect(catalogue.getByRole("progressbar", { name: "Avancement de l’import" })).toBeVisible();
  await expect(catalogue.getByRole("button", { name: "Importer maintenant" })).toBeDisabled();
  // Its two articles (new for the first device's run; the other devices find them taken by that shop).
  await expect(state).toHaveText(/^Terminé à \d{2} h \d{2} : 2 articles \(\d+ nouveaux?, 0 retiré\)$/, {
    timeout: 30_000,
  });
  await expect(catalogue.getByRole("button", { name: "Importer maintenant" })).toBeEnabled();
  const shop = await db.query<{ last_import_error: string | null; last_import_seen: number | null }>(
    "select last_import_error, last_import_seen from shops where id = $1",
    [shopId],
  );
  expect(shop.rows[0]).toEqual({ last_import_error: null, last_import_seen: 2 });
  await axeLightAndDark(page);
});

test("un nouvel import se mesure au total du précédent : une barre et « environ n articles »", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  await db.query(
    `update shops set import_state = 'running', import_started_at = now(), import_pages = 3, import_seen = 712,
       last_import_at = '2026-11-12T02:05:00Z', last_import_seen = 1900, last_import_created = 4,
       last_import_removed = 1 where id = $1`,
    [shop.id],
  );
  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto(`/admin/boutiques/${shop.id}`);
  const catalogue = page.getByRole("region", { name: "Catalogue" });
  const state = catalogue.getByTestId("import-state");
  // French grouping: a narrow no-break space in « 1 900 ».
  await expect(state).toHaveText("Import en cours : 712 / environ 1\u202f900 articles");
  const bar = catalogue.getByRole("progressbar", { name: "Avancement de l’import" });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("value", String(712 / 1900));
  await expect(bar).toHaveAttribute("aria-valuetext", "Import en cours : 712 / environ 1\u202f900 articles");
  await axeLightAndDark(page);

  // Past the previous total the bar stays just short of full until the end.
  await db.query("update shops set import_pages = 9, import_seen = 2100 where id = $1", [shop.id]);
  await expect(state).toHaveText("Import en cours : 2\u202f100 / environ 1\u202f900 articles", { timeout: 15_000 });
  await expect(bar).toHaveAttribute("value", "0.99");

  // « En attente »: indeterminate, whatever the previous total.
  await db.query("update shops set import_state = 'queued', import_pages = 0, import_seen = 0 where id = $1", [
    shop.id,
  ]);
  await expect(state).toHaveText("En attente", { timeout: 15_000 });
  await expect(bar).not.toHaveAttribute("value");

  await db.query(
    `update shops set import_state = null, last_import_at = '2026-11-13T13:05:00Z', last_import_seen = 2100,
       last_import_created = 200, last_import_removed = 0 where id = $1`,
    [shop.id],
  );
  await expect(state).toHaveText("Terminé à 14 h 05 : 2\u202f100 articles (200 nouveaux, 0 retiré)", {
    timeout: 15_000,
  });
  await expect(bar).toHaveCount(0);
});

test("un échec ponctuel du suivi d’import ne fait pas disparaître la fiche boutique", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  await db.query(
    "update shops set import_state = 'running', import_started_at = now(), import_pages = 1, import_seen = 100 where id = $1",
    [shop.id],
  );
  await signInAsAdmin(page, request, db, userAgentTag);
  let failed = false;
  await page.route("**/api/admin/shops/*/import-status", async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down" }) });
  });
  await page.goto(`/admin/boutiques/${shop.id}`);
  const catalogue = page.getByRole("region", { name: "Catalogue" });
  const state = catalogue.getByTestId("import-state");
  await expect(state).toHaveText("Import en cours : page 1, 100 articles lus");
  await expect.poll(() => failed, { timeout: 15_000 }).toBe(true);
  // The failed read changed nothing: the panel is still there, with the last state.
  await expect(state).toHaveText("Import en cours : page 1, 100 articles lus");
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  await db.query(
    `update shops set import_state = null, last_import_at = '2026-11-13T13:05:00Z', last_import_error = null,
       last_import_seen = 100, last_import_created = 5, last_import_removed = 0 where id = $1`,
    [shop.id],
  );
  await expect(state).toHaveText(/^Terminé à 14 h 05/, { timeout: 15_000 });
});

test("la barre et le menu de l’admin restent visibles quand la page défile", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto("/admin/catalogue/a-classer");
  await expect(page.getByRole("heading", { level: 1, name: "À classer" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navigation de l’administration" });
  // The current page's link is in view, even far along the phone's row; a fade shows that the row scrolls.
  await expect(nav.getByRole("link", { name: "À classer" })).toBeInViewport();
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(nav.getByTestId("nav-more-start").or(nav.getByTestId("nav-more-end")).first()).toBeAttached();
  } else {
    await expect(nav.getByTestId("nav-more-start")).toHaveCount(0);
    await expect(nav.getByTestId("nav-more-end")).toHaveCount(0);
  }
  // A page much taller than the window.
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "4000px";
    filler.dataset.testid = "filler";
    document.querySelector("#admin-content")?.append(filler);
  });
  await page.evaluate(() => window.scrollTo(0, 2500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(2000);

  const header = page.locator("header").first();
  const link = nav.getByRole("link", { name: "À classer" });
  await expect(link).toBeInViewport();
  const linkBox = await link.boundingBox();
  expect(linkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await tagAt(page, (linkBox?.x ?? 0) + 4, (linkBox?.y ?? 0) + (linkBox?.height ?? 0) / 2)).toBe("NAV");
  // Everywhere: the bar, one line high (its theme switch is an icon, its words only its name), stays at the top and
  // the menu right under it, never under it.
  const headerBox = await header.boundingBox();
  expect(headerBox?.y).toBe(0);
  expect(headerBox?.height ?? 0).toBeLessThanOrEqual(65);
  expect(linkBox?.y ?? 0).toBeGreaterThanOrEqual(headerBox?.height ?? 0);
  expect(await tagAt(page, (headerBox?.width ?? 0) / 2, (headerBox?.height ?? 0) / 2)).toBe("HEADER");
  const theme = header.getByRole("button", { name: /^Thème : .*Changer de thème$/ });
  await expect(theme).toBeVisible();
  await expect(theme).not.toContainText("Thème");
  if ((page.viewportSize()?.width ?? 0) < 768) {
    // Phone: the menu row is pinned right under the bar.
    expect(Math.round((await nav.boundingBox())?.y ?? -1)).toBe(Math.round(headerBox?.height ?? 0));
  }
  await nav.getByRole("link", { name: "Boutiques" }).click();
  await expect(page).toHaveURL(/\/admin\/boutiques$/);
});

test("une admin voit la plateforme des boutiques, filtre dessus et marque une « Grande enseigne »", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  await db.query("update shops set platform = 'prestashop' where id = $1", [shop.id]);
  // The settings form asks for at least one domain.
  await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [
    `enseigne-${shop.tag}.e2e.test`,
    shop.id,
  ]);
  const productId = await seedProduct(db, shop.id, `Robe enseigne ${shop.tag}`);
  await signInAsAdmin(page, request, db, userAgentTag);
  // Its article is in « Découvrir » until the shop is a « grande enseigne ».
  expect((await page.request.get(`/api/catalog/${productId}`)).status()).toBe(200);

  await page.goto("/admin/boutiques");
  await expect(page.getByRole("columnheader", { name: "Plateforme" })).toBeVisible();
  const filters = page.getByRole("form", { name: "Filtres" });
  await filters.getByRole("combobox", { name: "Plateforme" }).selectOption({ label: "PrestaShop" });
  await filters.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/[?&]platform=prestashop(&|$)/);
  const rows = page.getByRole("row").filter({ has: page.getByRole("link", { name: shop.name }) });
  await expect(rows).toHaveCount(1);
  await expect(rows.getByTestId("shop-platform")).toHaveText("PrestaShop");
  // Every row of the filtered list is on PrestaShop.
  const platforms = await page.getByRole("table").getByTestId("shop-platform").allTextContents();
  expect(new Set(platforms)).toEqual(new Set(["PrestaShop"]));
  await expect(rows.getByTestId("major-brand-tag")).toHaveCount(0);
  await axeLightAndDark(page);

  await rows.getByRole("link", { name: shop.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: shop.name })).toBeVisible();
  const settings = page.getByRole("region", { name: "Réglages" });
  await expect(settings.getByText("PrestaShop", { exact: true })).toBeVisible();
  const major = settings.getByRole("checkbox", { name: "Grande enseigne" });
  await expect(major).toHaveAccessibleDescription(
    "Ses articles restent utilisables (envies, listes, liens) mais n’apparaissent pas dans « Découvrir ».",
  );
  await major.check();
  await settings.getByRole("button", { name: "Enregistrer" }).click();
  await expect(settings.getByText("Réglages enregistrés.")).toBeVisible();
  await expect(major).toBeChecked();
  await expect(page.getByRole("region", { name: "Validation" })).toContainText(
    "Boutique publiée, grande enseigne : ses articles restent utilisables mais n’apparaissent pas dans « Découvrir ».",
  );
  const feature = page.getByRole("region", { name: "Boutique de la semaine" });
  await expect(feature).toContainText("Grande enseigne : elle ne va jamais en une.");
  await expect(feature.getByRole("button")).toHaveCount(0);
  const saved = await db.query("select is_major_brand from shops where id = $1", [shop.id]);
  expect(saved.rows).toEqual([{ is_major_brand: true }]);
  // « Articles dans Découvrir » (shown for a Shopify shop only) drops to 0.
  const detail = await page.request.get(`/api/admin/shops/${shop.id}`);
  expect(((await detail.json()) as { catalogueProducts: number }).catalogueProducts).toBe(0);
  await axeLightAndDark(page);

  // Out of « Découvrir »: its sheet answers 404; the list shows the tag.
  expect((await page.request.get(`/api/catalog/${productId}`)).status()).toBe(404);
  await page.goto("/admin/boutiques?platform=prestashop");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: shop.name }) })
      .getByTestId("major-brand-tag"),
  ).toHaveText("Grande enseigne");
  const audit = await db.query<{ action: string; details: unknown }>(
    "select action, details from admin_audit_log where target = $1 order by created_at",
    [`shop:${shop.id}`],
  );
  expect(audit.rows.map((r) => r.action)).toEqual(["shop.update"]);
});

test("une admin saisit la date de mise en ligne d’un article, puis revient à la date automatique", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const shop = await seedShop(db, "published");
  const name = `Article sans date ${shop.tag}`;
  // Already on sale at the shop's first import: no date (`unknown`).
  const product = await seedProduct(db, shop.id, name);
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto(`/admin/fiches/${product}`);
  const dates = page.getByRole("region", { name: "Dates" });
  await expect(dates).toContainText("Inconnue (déjà en boutique au premier import)");
  const field = dates.getByLabel("Date de mise en ligne");
  await expect(field).toHaveValue("");
  // Only a date set by hand can go back to automatic.
  await expect(dates.getByRole("button", { name: "Revenir à la date automatique" })).toHaveCount(0);
  await axeLightAndDark(page);
  // The date shown, unchanged: nothing is sent.
  await dates.getByRole("button", { name: "Enregistrer la date" }).click();
  await expect(dates.getByText("Date inchangée : rien n’est enregistré.")).toBeVisible();

  await field.fill("2026-11-02");
  await dates.getByRole("button", { name: "Enregistrer la date" }).click();
  await expect(dates.getByText("Date de mise en ligne enregistrée.")).toBeVisible();
  await expect(dates).toContainText("Saisie dans l’admin");
  const saved = await db.query<{ published_at: Date; published_source: string }>(
    "select published_at, published_source from products where id = $1",
    [product],
  );
  expect(saved.rows.map((r) => [r.published_at.toISOString(), r.published_source])).toEqual([
    ["2026-11-02T00:00:00.000Z", "admin"],
  ]);
  const audit = await db.query("select 1 from admin_audit_log where action = 'product.published_at' and target = $1", [
    `product:${product}`,
  ]);
  expect(audit.rowCount).toBe(1);
  await expect(field).toHaveValue("2026-11-02");

  // Back to automatic (no date until the shop gives one); the field follows the reloaded sheet.
  await dates.getByRole("button", { name: "Revenir à la date automatique" }).click();
  await expect(dates.getByText("Date automatique rétablie.")).toBeVisible();
  await expect(dates).toContainText("Inconnue (déjà en boutique au premier import)");
  await expect(field).toHaveValue("");
  await expect(dates.getByRole("button", { name: "Revenir à la date automatique" })).toHaveCount(0);
});
