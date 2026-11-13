import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import type pg from "pg";
import { sessionsOf } from "../fixtures/auth";
import { setupValue } from "../fixtures/paths";
import { expect, test } from "../fixtures/test";

// Catalogue « Découvrir », task 5: the une, the catalogue's grid (search, every filter, sort, pages), « Je le veux »,
// the sheet of an article (sizes, « Aimé par », close pieces, same shop, same style, the written actions), « Signaler »
// and the back button that keeps the filters and the place. The database is shared by the whole suite: every test
// brings its own shops and articles under a unique tag, and searches that tag.

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
const DAY = 86_400_000;

type ShopValue = "made_in_france" | "second_hand" | "eco" | "free_returns";

/** A published shop of its own, with its domain (« Découvrir » lists the shops by their domain). */
async function seedShop(db: pg.Pool, tag: string, label: string, values: ShopValue[] = []) {
  const slug = `e2e-catalogue-${label.toLowerCase().replace(/\W+/g, "-")}-${tag}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform, capture_mode, values)
     values ($1, $2, 'published', 'shopify', 'manual', $3::text[]) returning id`,
    [`${label} ${tag}`, slug, values],
  );
  const id = rows[0]?.id ?? "";
  await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [`${slug}.e2e.test`, id]);
  return { id, name: `${label} ${tag}` };
}

type ProductSeed = {
  name: string;
  priceCents?: number;
  compareAtCents?: number | null;
  categoryId?: string | null;
  colorId?: string | null;
  sizes?: [string, boolean][];
  /** How long ago Closyria first saw it (« Nouveautés »: less than 7 days). */
  ageDays?: number;
};

/** A visible catalogue article: name, price, a photo (on disk, served by the API) and its sizes. */
async function seedProduct(db: pg.Pool, shopId: string, seed: ProductSeed): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into products (shop_id, canonical_url, name, price_cents, compare_at_cents, currency, category_id, color_id,
       created_at)
     values ($1, $2, $3, $4, $5, 'EUR', $6, $7, $8) returning id`,
    [
      shopId,
      `https://catalogue.e2e.test/products/${randomUUID()}`,
      seed.name,
      seed.priceCents ?? 4900,
      seed.compareAtCents ?? null,
      seed.categoryId ?? null,
      seed.colorId ?? null,
      new Date(Date.now() - (seed.ageDays ?? 1) * DAY),
    ],
  );
  const id = rows[0]?.id ?? "";
  const key = `products/${id}/0.webp`;
  await mkdir(dirname(join(setupValue("E2E_STORAGE_DIR"), key)), { recursive: true });
  await writeFile(join(setupValue("E2E_STORAGE_DIR"), key), TINY_WEBP);
  await db.query(
    `insert into product_images (product_id, position, key, width, height, source_hash) values ($1, 0, $2, 1, 1, $3)`,
    [id, key, `h-${id}`],
  );
  for (const [position, [label, available]] of (seed.sizes ?? []).entries()) {
    await db.query("insert into product_sizes (product_id, label, position, available) values ($1, $2, $3, $4)", [
      id,
      label,
      position,
      available,
    ]);
  }
  return id;
}

/** A category of a kind « Ma taille en stock » knows (`hauts`, `jupes`…), shared by the suite. */
async function sharedCategory(db: pg.Pool, slug: string, name: string): Promise<string> {
  await db.query("insert into categories (slug, name) values ($1, $2) on conflict (slug) do nothing", [slug, name]);
  const { rows } = await db.query<{ id: string }>("select id from categories where slug = $1", [slug]);
  return rows[0]?.id ?? "";
}

async function ownColor(db: pg.Pool, tag: string, name: string): Promise<{ id: string; name: string }> {
  const { rows } = await db.query<{ id: string }>(
    "insert into colors (slug, name, hex) values ($1, $2, '#8A1C3B') returning id",
    [`e2e-${tag}-${name.toLowerCase()}`, `${name} ${tag}`],
  );
  return { id: rows[0]?.id ?? "", name: `${name} ${tag}` };
}

/** Her user and first profile (« Moi », created as her profiles are read), once the page opened her session. */
async function herProfile(
  page: Page,
  db: pg.Pool,
  userAgentTag: string,
): Promise<{ userId: string; profileId: string }> {
  expect(await page.evaluate(() => fetch("/api/me/profiles").then((r) => r.status))).toBe(200);
  let found: { userId: string; profileId: string } | undefined;
  await expect
    .poll(async () => {
      const userId = (await sessionsOf(db, userAgentTag)).at(-1)?.userId;
      if (!userId) return false;
      const { rows } = await db.query<{ id: string }>(
        "select id from profiles where user_id = $1 order by position, created_at limit 1",
        [userId],
      );
      if (rows[0]) found = { userId, profileId: rows[0].id };
      return Boolean(found);
    })
    .toBe(true);
  if (!found) throw new Error("no profile");
  return found;
}

const grid = (page: Page) => page.getByRole("list", { name: "Les articles" });
const cards = (page: Page) => grid(page).getByTestId("catalogue-card");
const card = (page: Page, name: string) => cards(page).filter({ hasText: name });
const filtersButton = (page: Page) => page.getByRole("button", { name: /^Filtres et tri/ });
const panel = (page: Page) => page.getByRole("region", { name: "Filtres et tri" });

async function openFilters(page: Page): Promise<Locator> {
  if ((await filtersButton(page).getAttribute("aria-expanded")) !== "true") await filtersButton(page).click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

async function closeFilters(page: Page) {
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
}

/** How far the app's content area is scrolled (it scrolls, not the window). */
const scrollTop = (page: Page) => page.evaluate(() => document.getElementById("app-content")?.scrollTop ?? 0);

const names = async (page: Page) => await cards(page).getByTestId("card-name").allTextContents();

test("la une des nouveautés, la grille, la recherche et les pages de 24", async ({ page, db }) => {
  const tag = randomUUID().slice(0, 8);
  const shop = await seedShop(db, tag, "Maison Iris");
  for (let i = 0; i < 30; i++) {
    await seedProduct(db, shop.id, {
      name: `Robe ${tag} ${String(i).padStart(2, "0")}`,
      priceCents: 3000 + i * 100,
      ageDays: 1 + i / 100,
    });
  }
  // No shop of the week for this page (another test may put one forward): the une is « Nouveautés de la semaine ».
  await page.route("**/api/shops", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { featured: unknown; shops: unknown[] };
    await route.fulfill({ response, json: { ...body, featured: null } });
  });

  await page.goto("/decouvrir");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const une = page.getByRole("article", { name: "Les derniers arrivés" });
  await expect(une).toContainText("Nouveautés de la semaine");
  await expect(cards(page).first()).toBeVisible();
  // Lower down: the row of shops, still there.
  await expect(page.getByRole("region", { name: "Toutes les boutiques" })).toBeVisible();
  await axeLightAndDark(page);

  // « Voir les nouveautés »: the filter, in the address.
  await une.getByRole("button", { name: "Voir les nouveautés" }).click();
  await expect(page).toHaveURL(/nouveautes=1/);
  await expect(page.getByRole("button", { name: "Retirer le filtre Nouveautés" })).toBeVisible();
  // While a filter is on, no une.
  await expect(page.getByRole("article", { name: "Les derniers arrivés" })).toHaveCount(0);

  await page.goto("/decouvrir");
  await page.getByRole("searchbox", { name: "Rechercher un article ou une boutique" }).fill(tag);
  await expect(page).toHaveURL(new RegExp(`recherche=${tag}`));
  await expect(cards(page)).toHaveCount(24);
  const first = card(page, `Robe ${tag} 00`);
  await expect(first).toContainText(shop.name);
  await expect(first.getByTestId("price-tag")).toHaveText(/30,00\s€/);
  await expect(first.getByRole("button", { name: `Je le veux : Robe ${tag} 00` })).toBeVisible();
  await expect(first.getByRole("link")).toHaveAttribute("href", /^\/decouvrir\/[0-9a-f-]{36}$/);
  await axeLightAndDark(page);

  await page.getByRole("button", { name: "Voir plus d’articles" }).click();
  await expect(cards(page)).toHaveCount(30);
  await expect(page.getByRole("button", { name: "Voir plus d’articles" })).toHaveCount(0);
  // Newest first: no article twice, none missing.
  expect(new Set(await names(page)).size).toBe(30);
});

test("chaque filtre, le tri, « Ma taille en stock » sans tailles puis avec, et l’écran vide", async ({
  page,
  db,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const tops = await sharedCategory(db, "hauts", "Hauts");
  const skirts = await sharedCategory(db, "jupes", "Jupes");
  const red = await ownColor(db, tag, "Rouge");
  const plain = await seedShop(db, tag, "Atelier");
  const green = await seedShop(db, tag, "Verte", ["eco", "second_hand"]);
  await seedProduct(db, plain.id, {
    name: `Blouse ${tag}`,
    priceCents: 2500,
    compareAtCents: 4000,
    categoryId: tops,
    colorId: red.id,
    sizes: [
      ["S", true],
      ["M", true],
    ],
  });
  await seedProduct(db, plain.id, {
    name: `Chemise ${tag}`,
    priceCents: 4500,
    categoryId: tops,
    sizes: [
      ["M", false],
      ["L", true],
    ],
    ageDays: 30,
  });
  await seedProduct(db, green.id, { name: `Jupe ${tag}`, priceCents: 8000, categoryId: skirts, ageDays: 2 });
  await seedProduct(db, green.id, { name: `Manteau ${tag}`, priceCents: 15000, ageDays: 20 });

  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(cards(page)).toHaveCount(4);
  expect(await names(page)).toEqual([`Blouse ${tag}`, `Jupe ${tag}`, `Manteau ${tag}`, `Chemise ${tag}`]);

  // Without any of « Mes tailles »: the filter is greyed, and « Ajoute tes tailles » leads to them.
  let filters = await openFilters(page);
  await expect(filters.getByRole("button", { name: "Ma taille en stock" })).toBeDisabled();
  await expect(filters.getByRole("link", { name: "Ajoute tes tailles" })).toHaveAttribute("href", "/reglages/tailles");
  await axeLightAndDark(page);

  // En baisse.
  await filters.getByRole("button", { name: "En baisse" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(card(page, `Blouse ${tag}`).getByTestId("price-tag")).toContainText(/−15\s€/);
  await expect(page).toHaveURL(/en-baisse=1/);
  await filters.getByRole("button", { name: "En baisse" }).click();
  await expect(cards(page)).toHaveCount(4);
  // Nouveautés (less than 7 days).
  await filters.getByRole("button", { name: "Nouveautés" }).click();
  await expect(cards(page)).toHaveCount(2);
  await filters.getByRole("button", { name: "Nouveautés" }).click();
  // The shop's values.
  await filters.getByRole("button", { name: "Éco-responsable" }).click();
  await expect.poll(() => names(page)).toEqual([`Jupe ${tag}`, `Manteau ${tag}`]);
  await filters.getByRole("button", { name: "Seconde main" }).click();
  await expect(page).toHaveURL(/valeurs=second_hand,eco/);
  await expect(cards(page)).toHaveCount(2);
  await closeFilters(page);
  // The filters on, as chips: one tap takes one off.
  await page.getByRole("button", { name: "Retirer le filtre Éco-responsable" }).click();
  await page.getByRole("button", { name: "Retirer le filtre Seconde main" }).click();
  await expect(cards(page)).toHaveCount(4);

  filters = await openFilters(page);
  await filters.getByRole("combobox", { name: "Prix" }).selectOption({ label: "De 30 à 60 €" });
  await expect.poll(() => names(page)).toEqual([`Chemise ${tag}`]);
  await filters.getByRole("combobox", { name: "Prix" }).selectOption({ label: "Tous" });
  await filters.getByRole("combobox", { name: "Type" }).selectOption({ label: "Hauts" });
  await expect(cards(page)).toHaveCount(2);
  await filters.getByRole("combobox", { name: "Couleur" }).selectOption({ label: red.name });
  await expect.poll(() => names(page)).toEqual([`Blouse ${tag}`]);
  await filters.getByRole("combobox", { name: "Type" }).selectOption({ label: "Tous" });
  await filters.getByRole("combobox", { name: "Couleur" }).selectOption({ label: "Toutes" });
  await filters.getByRole("combobox", { name: "Boutique" }).selectOption({ label: green.name });
  await expect.poll(() => names(page)).toEqual([`Jupe ${tag}`, `Manteau ${tag}`]);
  await filters.getByRole("combobox", { name: "Boutique" }).selectOption({ label: "Toutes" });
  // Sorts.
  await filters.getByRole("combobox", { name: "Trier par" }).selectOption({ label: "Prix croissant" });
  await expect.poll(() => names(page)).toEqual([`Blouse ${tag}`, `Chemise ${tag}`, `Jupe ${tag}`, `Manteau ${tag}`]);
  await filters.getByRole("combobox", { name: "Trier par" }).selectOption({ label: "Prix décroissant" });
  await expect.poll(() => names(page)).toEqual([`Manteau ${tag}`, `Jupe ${tag}`, `Chemise ${tag}`, `Blouse ${tag}`]);

  // Too many filters: the screen says so, and « Effacer les filtres » takes them all off (the sort stays).
  await filters.getByRole("button", { name: "En baisse" }).click();
  await filters.getByRole("combobox", { name: "Boutique" }).selectOption({ label: green.name });
  await closeFilters(page);
  await expect(page.getByText("Aucun article avec ces filtres.")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await axeLightAndDark(page);
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(page).not.toHaveURL(/recherche=|en-baisse|boutique/);
  await expect(page).toHaveURL(/tri=price_desc/);
  await expect(cards(page).first()).toBeVisible();

  // With her sizes (« M » for tops): the filter works, the card says « Ta taille en stock ».
  const { profileId } = await herProfile(page, db, userAgentTag);
  await db.query("update profiles set size_top = '{M}' where id = $1", [profileId]);
  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(card(page, `Blouse ${tag}`).getByTestId("card-size")).toHaveText("Ta taille en stock");
  await expect(card(page, `Chemise ${tag}`).getByTestId("card-size")).toHaveCount(0);
  filters = await openFilters(page);
  await expect(filters.getByRole("link", { name: "Ajoute tes tailles" })).toHaveCount(0);
  await filters.getByRole("button", { name: "Ma taille en stock" }).click();
  await expect(page).toHaveURL(/ma-taille=1/);
  // Strict: the shirt is sold out in M; the skirt (no size of hers for skirts) and the unfiled coat are left out.
  await expect.poll(() => names(page)).toEqual([`Blouse ${tag}`]);
});

test("« Je le veux » sur une carte : le cœur se remplit et l’article est dans Mes articles", async ({ page, db }) => {
  const tag = randomUUID().slice(0, 8);
  const shop = await seedShop(db, tag, "Coeur");
  await seedProduct(db, shop.id, { name: `Robe voulue ${tag}` });

  await page.goto(`/decouvrir?recherche=${tag}`);
  const one = card(page, `Robe voulue ${tag}`);
  await one.getByRole("button", { name: `Je le veux : Robe voulue ${tag}` }).click();
  await expect(one.getByTestId("card-wanted")).toHaveText("Dans tes envies");
  await expect(one.getByRole("button", { name: /Je le veux/ })).toHaveCount(0);
  await expect(page.getByText("Ajouté à tes envies")).toBeVisible();
  await axeLightAndDark(page);

  // Read again: still in her wishes.
  await page.reload();
  await expect(card(page, `Robe voulue ${tag}`).getByTestId("card-wanted")).toBeVisible();
  await page.goto("/articles?etape=envie");
  await expect(page.getByTestId("item-card").filter({ hasText: `Robe voulue ${tag}` })).toBeVisible();
});

test("la fiche : tailles, « Aimé par », pièces proches, même boutique, même style et les actions écrites", async ({
  page,
  db,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const tops = await sharedCategory(db, "hauts", "Hauts");
  const red = await ownColor(db, tag, "Carmin");
  const shop = await seedShop(db, tag, "Fiche");
  const other = await seedShop(db, tag, "Ailleurs");
  const id = await seedProduct(db, shop.id, {
    name: `Blouse fiche ${tag}`,
    priceCents: 3900,
    compareAtCents: 5200,
    categoryId: tops,
    colorId: red.id,
    sizes: [
      ["S", false],
      ["M", true],
      ["L", true],
    ],
  });
  await seedProduct(db, shop.id, { name: `Sœur ${tag}` });
  await seedProduct(db, other.id, { name: `Cousine ${tag}`, categoryId: tops, colorId: red.id });
  // Three other people keep it (never named on the sheet).
  for (let i = 0; i < 3; i++) {
    const userId = randomUUID();
    await db.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
      userId,
      `Camille ${tag}`,
      `like-${userId}@example.com`,
    ]);
    const { rows } = await db.query<{ id: string }>(
      "insert into profiles (user_id, name, audience, color) values ($1, 'Moi', 'women', 'plum') returning id",
      [userId],
    );
    await db.query("insert into items (user_id, profile_id, product_id) values ($1, $2, $3)", [
      userId,
      rows[0]?.id,
      id,
    ]);
  }

  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(card(page, `Blouse fiche ${tag}`)).toBeVisible();
  // Her size and a close piece of her own dressing.
  const { userId, profileId } = await herProfile(page, db, userAgentTag);
  await db.query("update profiles set size_top = '{m}' where id = $1", [profileId]);
  const hidden = await seedShop(db, tag, "Ancienne");
  const ownProduct = await seedProduct(db, hidden.id, { name: `Ma blouse ${tag}`, categoryId: tops, colorId: red.id });
  await db.query("insert into items (user_id, profile_id, product_id, stage) values ($1, $2, $3, 'owned')", [
    userId,
    profileId,
    ownProduct,
  ]);

  await card(page, `Blouse fiche ${tag}`).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/decouvrir/${id}$`));
  await expect(page.getByRole("heading", { level: 1, name: `Blouse fiche ${tag}` })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(`Voir les articles de ${shop.name}`) })).toHaveAttribute(
    "href",
    `/decouvrir?boutique=${shop.id}`,
  );
  const info = page.getByTestId("product-info");
  await expect(info).toContainText("39,00");
  await expect(info).toContainText(/−13\s€/);
  await expect(info).toContainText("Ta taille en stock");
  await expect(page.getByTestId("likes")).toHaveText("Aimé par 3 personnes");
  await expect(page.getByText(`Camille ${tag}`)).toHaveCount(0);
  const sizes = page.getByRole("region", { name: "Ta taille" });
  await expect(sizes.getByRole("listitem")).toHaveText(["S (indisponible)", "M (ta taille)", "L"]);

  const close = page.getByRole("region", { name: "Tu as déjà quelque chose de proche" });
  await expect(close.getByRole("link", { name: new RegExp(`Ma blouse ${tag}`) })).toHaveAttribute(
    "href",
    `/produits/${ownProduct}`,
  );
  await expect(page.getByRole("region", { name: "De la même boutique" })).toContainText(`Sœur ${tag}`);
  await expect(page.getByRole("region", { name: "Dans le même style" })).toContainText(`Cousine ${tag}`);
  const actions = page.getByRole("region", { name: "Que veux-tu faire ?" });
  const shopLink = actions.getByRole("link", { name: `Voir chez ${shop.name}` });
  await expect(shopLink).toHaveAttribute("href", /^https:\/\/catalogue\.e2e\.test\/products\//);
  await expect(shopLink).toHaveAttribute("target", "_blank");
  await axeLightAndDark(page);

  // « Partager »: the share window, with the shop's address.
  await actions.getByRole("button", { name: "Partager" }).click();
  const share = page.getByRole("dialog", { name: "Partager" });
  await expect(share).toBeVisible();
  await share.getByRole("button", { name: "Fermer" }).first().click();
  await expect(share).toBeHidden();

  // « Ajouter à une liste »: a new list, the article kept in it.
  await actions.getByRole("button", { name: "Ajouter à une liste" }).click();
  const lists = page.getByRole("dialog", { name: "Ajouter à une liste" });
  await lists.getByLabel("Nouvelle liste").fill(`Liste ${tag}`);
  await lists.getByRole("button", { name: /Créer/ }).click();
  await expect(page.getByText(`Ajouté à la liste Liste ${tag}`)).toBeVisible();
  // Now hers: « Dans tes envies » and her own sheet.
  await expect(page.getByRole("status").filter({ hasText: "Dans tes envies" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Voir ma fiche" })).toHaveAttribute("href", `/produits/${id}`);
  await expect(actions.getByRole("button", { name: "Je le veux" })).toHaveCount(0);
  const { rows } = await db.query<{ n: number }>(
    "select count(*)::int as n from items where user_id = $1 and product_id = $2",
    [userId, id],
  );
  expect(rows[0]?.n).toBe(1);
});

test("« Je le veux » sur la fiche, puis « Signaler » : « Merci, on regarde. » à chaque fois", async ({
  page,
  db,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const shop = await seedShop(db, tag, "Signal");
  const id = await seedProduct(db, shop.id, { name: `Robe signalée ${tag}` });

  await page.goto(`/decouvrir/${id}`);
  const actions = page.getByRole("region", { name: "Que veux-tu faire ?" });
  await actions.getByRole("button", { name: "Je le veux" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dans tes envies" })).toBeVisible();
  await expect(actions.getByRole("link", { name: "Voir ma fiche" })).toBeVisible();

  await page.getByRole("button", { name: "Signaler" }).click();
  const dialog = page.getByRole("dialog", { name: "Signaler cet article" });
  await expect(dialog.getByRole("radio")).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Envoyer" })).toBeDisabled();
  await dialog.getByRole("radio", { name: "Contenu choquant" }).check();
  await axeLightAndDark(page);
  await dialog.getByRole("button", { name: "Envoyer" }).click();
  await expect(dialog.getByText("Merci, on regarde.")).toBeVisible();
  await dialog.getByRole("button", { name: "Fermer" }).click();

  // A second report: the same thanks, the first reason kept.
  await page.getByRole("button", { name: "Signaler" }).click();
  await dialog.getByRole("radio", { name: "Autre" }).check();
  await dialog.getByRole("button", { name: "Envoyer" }).click();
  await expect(dialog.getByText("Merci, on regarde.")).toBeVisible();
  const userId = (await sessionsOf(db, userAgentTag)).at(-1)?.userId;
  const { rows } = await db.query<{ reason: string }>(
    "select reason from product_reports where product_id = $1 and user_id = $2",
    [id, userId],
  );
  expect(rows).toEqual([{ reason: "shocking" }]);
});

test("« stocks frais » : la fiche relue à l’ouverture met tailles et prix à jour en silence, le retour reste en place", async ({
  page,
  db,
}) => {
  const tag = randomUUID().slice(0, 8);
  const shop = await seedShop(db, tag, "Frais");
  const name = `Gilet frais ${tag}`;
  const id = await seedProduct(db, shop.id, {
    name,
    priceCents: 4900,
    sizes: [
      ["S", false],
      ["M", true],
    ],
  });
  // The API's answers, as when the article was read 3 h ago and the shop's stock moved meanwhile: first « a read is
  // under way », then the fresh sizes and price (the worker's part is covered by the API and worker tests).
  const reads: string[] = [];
  await page.route(
    (url) => url.pathname === `/api/catalog/${id}`,
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      reads.push(route.request().url());
      const fresh =
        reads.length === 1
          ? { refreshing: true, checkedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }
          : {
              refreshing: false,
              checkedAt: new Date().toISOString(),
              priceCents: 3900,
              sizes: [
                { label: "S", available: true },
                { label: "M", available: false },
              ],
            };
      await route.fulfill({ response, json: { ...body, ...fresh } });
    },
  );

  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(cards(page)).toHaveCount(1);
  await card(page, name).getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const info = page.getByTestId("product-info");
  const checked = info.getByTestId("stock-checked");
  await expect(checked).toHaveText("Vérification du stock…");
  await expect(info.getByText(/49,00/)).toBeVisible();
  const sizes = info.locator('section[aria-labelledby="sizes-title"]');
  const size = (label: string) => sizes.getByRole("listitem").filter({ hasText: new RegExp(`^${label}`) });
  await expect(size("S")).toContainText("indisponible");

  // Read again 3 s after it opened: in place, without a reload nor a spinner.
  await expect(checked).toHaveText("Vérifié à l’instant", { timeout: 10_000 });
  await expect(info.getByText(/39,00/)).toBeVisible();
  await expect(size("S")).not.toContainText("indisponible");
  await expect(size("M")).toContainText("indisponible");
  // Read: no second try.
  await page.waitForTimeout(6_000);
  expect(reads).toHaveLength(2);
  await axeLightAndDark(page);

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`recherche=${tag}`));
  await expect(card(page, name)).toBeVisible();
});

test("le retour arrière depuis une fiche garde les filtres, les pages chargées et la position", async ({
  page,
  db,
}) => {
  const tag = randomUUID().slice(0, 8);
  const shop = await seedShop(db, tag, "Retour");
  for (let i = 0; i < 30; i++) {
    await seedProduct(db, shop.id, {
      name: `Pull ${tag} ${String(i).padStart(2, "0")}`,
      priceCents: 2000 + i * 100,
      ageDays: 1 + i / 100,
    });
  }

  await page.goto(`/decouvrir?recherche=${tag}&tri=price_asc`);
  await expect(cards(page)).toHaveCount(24);
  await page.getByRole("button", { name: "Voir plus d’articles" }).click();
  await expect(cards(page)).toHaveCount(30);
  const target = card(page, `Pull ${tag} 27`);
  await target.scrollIntoViewIfNeeded();
  const before = await scrollTop(page);
  expect(before).toBeGreaterThan(0);
  await target.getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1, name: `Pull ${tag} 27` })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`recherche=${tag}&tri=price_asc`));
  // The 30 articles at once (no « Voir plus » needed) and the same place.
  await expect(cards(page)).toHaveCount(30);
  await expect(page.getByRole("button", { name: "Voir plus d’articles" })).toHaveCount(0);
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(before - 80);
  expect(await scrollTop(page)).toBeLessThan(before + 80);
  await expect(card(page, `Pull ${tag} 27`)).toBeInViewport();
  // The filters too.
  await expect(page.getByRole("searchbox", { name: "Rechercher un article ou une boutique" })).toHaveValue(tag);
  await expect(filtersButton(page)).toHaveAccessibleName("Filtres et tri");

  // Opened again by its address (not the back button): the first page only.
  await page.goto(`/decouvrir?recherche=${tag}&tri=price_asc`);
  await expect(cards(page)).toHaveCount(24);
  await expect(page.getByRole("button", { name: "Voir plus d’articles" })).toBeVisible();
  expect(await scrollTop(page)).toBe(0);
});

test("« Mes tailles » : depuis Compte, par profil, puis « Ma taille en stock » s’active et la fiche met sa taille en avant", async ({
  page,
  db,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const tops = await sharedCategory(db, "hauts", "Hauts");
  const shop = await seedShop(db, tag, "Tailles");
  const id = await seedProduct(db, shop.id, {
    name: `Blouse tailles ${tag}`,
    categoryId: tops,
    sizes: [
      ["S", true],
      ["M", true],
      ["T38", true],
      ["L", false],
    ],
  });
  const shoes = await sharedCategory(db, "chaussures", "Chaussures");
  await seedProduct(db, shop.id, { name: `Sandale tailles ${tag}`, categoryId: shoes, sizes: [["EU 38,5", true]] });
  // « Taille unique » fits a sized kind (a top); an unfiled article never does, not even in « taille unique ».
  const poncho = await seedProduct(db, shop.id, {
    name: `Poncho tailles ${tag}`,
    categoryId: tops,
    sizes: [["Taille unique", true]],
  });
  await seedProduct(db, shop.id, { name: `Foulard tailles ${tag}`, sizes: [["Taille unique", true]] });
  await seedProduct(db, shop.id, { name: `Inconnu tailles ${tag}`, sizes: [["M", true]] });

  // Without sizes the filter is greyed; « Ajoute tes tailles » leads to the page, and so does Compte.
  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(cards(page)).toHaveCount(5);
  let filters = await openFilters(page);
  await expect(filters.getByRole("button", { name: "Ma taille en stock" })).toBeDisabled();
  await page.goto("/compte");
  const row = page.getByRole("main").getByRole("link", { name: "Mes tailles", exact: true });
  await expect(row).toHaveAttribute("href", "/reglages/tailles");
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await row.click();
  await expect(page).toHaveURL(/\/reglages\/tailles$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2, name: "Mes tailles" })).toBeVisible();
  await expect(main.getByText("Coche toutes les tailles qui te vont")).toBeVisible();

  const group = (name: string) => main.getByRole("group", { name });
  const top = group("Hauts");
  const bottom = group("Bas");
  const foot = group("Chaussures");
  const chip = (kind: typeof top, size: string) => kind.getByRole("button", { name: size, exact: true });
  const ticked = (kind: typeof top) =>
    kind.locator("button[aria-pressed=true]").evaluateAll((list) => list.map((b) => b.textContent?.trim() ?? ""));
  for (const kind of [top, bottom, foot]) expect(await ticked(kind)).toEqual([]);
  await expect(top.getByRole("button", { pressed: false })).toHaveText([
    ...["XS", "S", "M", "L", "XL", "XXL", "32", "34", "36", "38", "40", "42", "44", "46", "48"],
    "Une autre taille…",
  ]);
  await expect(chip(bottom, "W28")).toBeVisible();
  await expect(chip(foot, "38,5")).toBeVisible();
  await axeLightAndDark(page);

  // Several sizes per kind: M and 38 for tops, 38,5 for shoes, and a size of her own typed for bottoms.
  await chip(top, "M").click();
  await chip(top, "38").click();
  await chip(foot, "38,5").click();
  await bottom.getByRole("button", { name: "Une autre taille…" }).click();
  await main.getByRole("textbox", { name: "Bas : une autre taille" }).fill(" W27 L30 ");
  await main.getByRole("textbox", { name: "Bas : une autre taille" }).press("Enter");
  await expect(chip(bottom, "W27 L30")).toHaveAttribute("aria-pressed", "true");
  expect(await ticked(top)).toEqual(["M", "38"]);
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Tes tailles sont enregistrées.")).toBeVisible();
  const { profileId } = await herProfile(page, db, userAgentTag);
  await expect
    .poll(
      async () =>
        (await db.query("select size_top, size_bottom, size_shoes from profiles where id = $1", [profileId])).rows[0],
    )
    .toEqual({ size_top: ["M", "38"], size_bottom: ["W27 L30"], size_shoes: ["38,5"] });
  // Read back after a reload: her own size is a ticked chip too.
  await page.reload();
  await expect.poll(() => ticked(top)).toEqual(["M", "38"]);
  expect(await ticked(bottom)).toEqual(["W27 L30"]);
  expect(await ticked(foot)).toEqual(["38,5"]);

  // Another profile keeps its own sizes (none), and saving there leaves « Moi » alone.
  const lea = await page.evaluate(() =>
    fetch("/api/me/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Léa", audience: "women", color: "rose" }),
    }).then((r) => r.json() as Promise<{ id: string }>),
  );
  await page.goto(`/reglages/tailles?profil=${lea.id}`);
  await expect(main.getByRole("heading", { level: 2, name: "Mes tailles" })).toBeVisible();
  await expect.poll(() => ticked(top)).toEqual([]);
  await chip(top, "S").click();
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Tes tailles sont enregistrées.")).toBeVisible();
  const sizesOf = async (profile: string) =>
    (await db.query("select size_top from profiles where id = $1", [profile])).rows[0]?.size_top;
  await expect.poll(() => sizesOf(lea.id)).toEqual(["S"]);
  expect(await sizesOf(profileId)).toEqual(["M", "38"]);

  // « Ma taille en stock » is on offer now, and the sheet puts her size forward.
  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(card(page, `Blouse tailles ${tag}`).getByTestId("card-size")).toHaveText("Ta taille en stock");
  await expect(card(page, `Sandale tailles ${tag}`).getByTestId("card-size")).toHaveText("Ta taille en stock");
  await expect(card(page, `Poncho tailles ${tag}`).getByTestId("card-size")).toHaveText("Ta taille en stock");
  await expect(card(page, `Foulard tailles ${tag}`).getByTestId("card-size")).toHaveCount(0);
  await expect(card(page, `Inconnu tailles ${tag}`).getByTestId("card-size")).toHaveCount(0);
  filters = await openFilters(page);
  await expect(filters.getByRole("link", { name: "Ajoute tes tailles" })).toHaveCount(0);
  await filters.getByRole("button", { name: "Ma taille en stock" }).click();
  await expect(page).toHaveURL(/ma-taille=1/);
  // Strict: her sizes, or « taille unique » of a sized kind; never the unfiled articles (even the TU scarf).
  await expect
    .poll(async () => (await names(page)).sort())
    .toEqual([`Blouse tailles ${tag}`, `Poncho tailles ${tag}`, `Sandale tailles ${tag}`].sort());
  await page.goto(`/decouvrir/${id}`);
  await expect(page.getByTestId("product-info")).toContainText("Ta taille en stock");
  // Every one of her sizes is put forward (« T38 » is her 38).
  await expect(page.getByRole("region", { name: "Ta taille" }).getByRole("listitem")).toHaveText([
    "S",
    "M (ta taille)",
    "T38 (ta taille)",
    "L (indisponible)",
  ]);
  await page.goto(`/decouvrir/${poncho}`);
  await expect(page.getByTestId("product-info")).toContainText("Ta taille en stock");
  await expect(page.getByRole("region", { name: "Ta taille" }).getByRole("listitem")).toHaveText([
    "Taille unique (ta taille)",
  ]);

  // Unticking every size of a kind clears it (an empty list).
  await page.goto("/reglages/tailles");
  await expect.poll(() => ticked(top)).toEqual(["M", "38"]);
  await chip(top, "M").click();
  await chip(top, "38").click();
  await main.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Tes tailles sont enregistrées.")).toBeVisible();
  await expect
    .poll(async () => (await db.query("select size_top, size_shoes from profiles where id = $1", [profileId])).rows[0])
    .toEqual({ size_top: [], size_shoes: ["38,5"] });
});
