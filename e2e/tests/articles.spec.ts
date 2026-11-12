import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 3: « Mes articles » opens on « Tout »; each card carries its step; chips with their numbers
// filter by step; tabs « Articles · Listes · Commandes groupées »; « Par étape » on a computer shows 4 columns.

type Db = Parameters<typeof sessionsOf>[0];
const DESKTOP_MIN = 1024;
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN;

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

/** One wish pasted from the fake shop: she has a session, a profile and a product to copy. */
async function firstWish(page: Page, db: Db, userAgentTag: string) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  const { rows } = await db.query<{ id: string; product_id: string; profile_id: string }>(
    "select id, product_id, profile_id from items where user_id = $1",
    [userId],
  );
  const [item] = rows;
  if (!item) throw new Error("no item");
  return { userId, ...item };
}

type Seed = { name: string; stage: string; ownedDaysAgo?: number };

/**
 * Her items, copies of the first product (same shop and photo, own name), newest first in the order given. An
 * `ownedDaysAgo` writes her move to « owned » that many days ago (« Reçu » under 30 days).
 */
async function seed(db: Db, first: { userId: string; product_id: string; profile_id: string }, items: Seed[]) {
  for (const [index, item] of items.entries()) {
    const { rows } = await db.query<{ id: string }>(
      `with copy as (
         insert into products (shop_id, canonical_url, name, currency, price_cents, capture_status, source)
         select shop_id, canonical_url || '#copy-' || gen_random_uuid(), $2, currency, price_cents, capture_status, source
         from products where id = $1 returning id
       ), photos as (
         insert into product_images (product_id, position, key, width, height, source_hash)
         select copy.id, i.position, i.key, i.width, i.height, i.source_hash
         from product_images i, copy where i.product_id = $1
       )
       insert into items (user_id, profile_id, product_id, stage, love_level, created_at)
       select $3, $4, copy.id, $5, 2, now() + make_interval(secs => $6) from copy returning id`,
      [first.product_id, item.name, first.userId, first.profile_id, item.stage, items.length - index],
    );
    const id = rows[0]?.id;
    if (item.ownedDaysAgo !== undefined) {
      await db.query(
        `insert into item_events (item_id, type, stage, at) values ($1, 'stage', 'owned', now() - make_interval(days => $2))`,
        [id, item.ownedDaysAgo],
      );
    }
  }
}

const SEEDS: Seed[] = [
  { name: "Robe Rozie", stage: "spotted" },
  { name: "Pull Rowan", stage: "ordered" },
  { name: "Jupe Yara", stage: "owned", ownedDaysAgo: 2 },
  { name: "Veste Lore", stage: "owned", ownedDaysAgo: 60 },
  { name: "Chemise Ama", stage: "owned" },
  { name: "Sac Elann", stage: "for_sale" },
  { name: "Top Vendu", stage: "sold" },
];

const chips = (page: Page) => page.getByRole("navigation", { name: "Étapes" });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Rubriques de Mes articles" });
const cards = (page: Page) => page.getByTestId("item-card");
const cardOf = (page: Page, name: string) => cards(page).filter({ hasText: name });

test("« Tout » montre chaque article avec son étape, les pastilles comptent juste et filtrent", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const first = await firstWish(page, db, userAgentTag);
  await seed(db, first, SEEDS);
  await page.goto("/articles");
  await expect(page.getByRole("heading", { level: 1, name: "Mes articles" })).toBeVisible();
  await expect(cards(page)).toHaveCount(7);
  await expect(cardOf(page, "Top Vendu")).toHaveCount(0);
  const labels: [string, string][] = [
    [PRODUCT.name, "Envie"],
    ["Robe Rozie", "Envie"],
    ["Pull Rowan", "Commandé"],
    ["Jupe Yara", "Reçu"],
    ["Veste Lore", "Dans mon dressing"],
    ["Chemise Ama", "Dans mon dressing"],
    ["Sac Elann", "À vendre"],
  ];
  for (const [name, step] of labels) {
    await expect(cardOf(page, name).getByTestId("card-step")).toHaveText(step);
  }
  // « Repéré » is gone from the screen.
  await expect(page.getByText("Repéré")).toHaveCount(0);

  await expect(chips(page).getByRole("link")).toHaveText([
    "Tout · 7",
    "Envies · 2",
    "Commandés · 1",
    "Reçus · 1",
    "Dans mon dressing · 2",
    "À vendre · 1",
  ]);
  await expect(chips(page).getByRole("link", { name: "Tout · 7" })).toHaveAttribute("aria-current", "page");
  for (const chip of await chips(page).getByRole("link").all()) {
    const box = await chip.evaluate((el) => {
      const own = el.getBoundingClientRect();
      const hit = getComputedStyle(el, "::after");
      return Math.max(own.height, Number.parseFloat(hit.height) || 0);
    });
    expect(box).toBeGreaterThanOrEqual(44);
  }
  // The card: 20 px corners, a 3:4 photo, the step as an ochre clothing tag, the price in a powder-pink tag.
  const yara = cardOf(page, "Jupe Yara");
  await expect(yara).toHaveCSS("border-top-left-radius", "20px");
  await expect(yara.getByTestId("price-tag")).toHaveText(/^23,00\s€$/);
  const photo = await yara.locator("[data-photo]").boundingBox();
  expect(Math.abs((photo?.width ?? 0) / (photo?.height ?? 1) - 3 / 4)).toBeLessThan(0.02);
  await page.screenshot({ path: testInfo.outputPath("tout.png"), fullPage: true });
  await axeLightAndDark(page);

  await chips(page).getByRole("link", { name: "Dans mon dressing · 2" }).click();
  await expect(page).toHaveURL(/\/articles\?etape=dressing$/);
  await expect(cards(page)).toHaveCount(2);
  await expect(cardOf(page, "Veste Lore")).toBeVisible();
  await expect(chips(page).getByRole("link", { name: "Dans mon dressing · 2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await chips(page).getByRole("link", { name: "Reçus · 1" }).click();
  await expect(page).toHaveURL(/etape=recu$/);
  await expect(cards(page)).toHaveText([/Jupe Yara/]);
  // The sold ones are still there, behind the « Étape » filter of « Dans mon dressing ».
  await page.goto("/articles?etape=dressing&statut=sold");
  await expect(cards(page)).toHaveText([/Top Vendu/]);
  await chips(page).getByRole("link", { name: "Tout · 7" }).click();
  await expect(page).toHaveURL(/\/articles$/);
  await expect(cards(page)).toHaveCount(7);
});

test("le filtre Envies garde la sélection, le budget et « Préparer une commande »", async ({
  page,
  db,
  userAgentTag,
}) => {
  const first = await firstWish(page, db, userAgentTag);
  await seed(db, first, SEEDS.slice(0, 2));
  await page.goto("/articles");
  // Order preparation belongs to the wishes.
  await expect(page.getByRole("link", { name: "Préparer une commande" })).toHaveCount(0);
  await chips(page).getByRole("link", { name: "Envies · 2" }).click();
  await expect(page).toHaveURL(/etape=envie$/);
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Budget" })).toBeVisible();
  await expect(cards(page).first().getByTestId("card-take")).toBeVisible();

  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await cards(page).first().getByRole("button").first().click();
  await expect(page.getByRole("region", { name: "Actions sur la sélection" })).toContainText("1 sélectionné");
  await page.getByRole("button", { name: "Terminé", exact: true }).click();

  await page.getByRole("link", { name: "Préparer une commande" }).click();
  await expect(page).toHaveURL(/\/envies\/commande/);
});

test("les onglets mènent aux Listes et aux Commandes groupées, et reviennent aux Articles", async ({
  page,
  db,
  userAgentTag,
}) => {
  await firstWish(page, db, userAgentTag);
  const created = await page.request.post("/api/me/wishlists", { data: { name: "Anniversaire" } });
  expect(created.status()).toBe(201);
  await page.goto("/articles");
  await expect(tabs(page).getByRole("link")).toHaveText(["Articles", "Listes · 1", "Commandes groupées"]);
  await expect(tabs(page).getByRole("link", { name: "Articles" })).toHaveAttribute("aria-current", "page");
  // A quiet row of text links (navigation 2026-11-12): no pill, the current one underlined, each a finger wide.
  const look = await tabs(page)
    .getByRole("link", { name: "Articles" })
    .evaluate((link) => {
      const style = getComputedStyle(link);
      const hit = getComputedStyle(link, "::after");
      const own = link.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        underline: style.textDecorationLine,
        reach: Math.min(
          Math.max(own.width, Number.parseFloat(hit.width) || 0),
          Math.max(own.height, Number.parseFloat(hit.height) || 0),
        ),
      };
    });
  expect(look.background).toBe("rgba(0, 0, 0, 0)");
  expect(look.underline).toBe("underline");
  expect(look.reach).toBeGreaterThanOrEqual(44);
  expect(
    await tabs(page).evaluate((nav) => getComputedStyle(nav).backgroundColor),
    "the row has no pill behind it",
  ).toBe("rgba(0, 0, 0, 0)");
  await expect(tabs(page).getByRole("link", { name: "Listes · 1" })).not.toHaveAttribute("aria-current");

  await tabs(page).getByRole("link", { name: "Listes · 1" }).click();
  await expect(page).toHaveURL(/\/listes$/);
  await expect(page.getByText("Anniversaire")).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Listes · 1" })).toHaveAttribute("aria-current", "page");

  await tabs(page).getByRole("link", { name: "Commandes groupées" }).click();
  await expect(page).toHaveURL(/\/articles\/commandes-groupees$/);
  await expect(page.getByRole("heading", { name: "Aucune commande groupée en cours" })).toBeVisible();
  await axeLightAndDark(page);

  await tabs(page).getByRole("link", { name: "Articles" }).click();
  await expect(page).toHaveURL(/\/articles$/);
  await expect(cards(page)).toHaveCount(1);
});

test("« Par étape » montre quatre colonnes sur ordinateur", async ({ page, db, userAgentTag }, testInfo) => {
  const first = await firstWish(page, db, userAgentTag);
  await seed(db, first, SEEDS);
  await page.goto("/articles");
  await expect(cards(page)).toHaveCount(7);
  const board = page.getByRole("button", { name: "Par étape" });
  if (!isDesktop(page)) {
    await expect(board).toHaveCount(0);
    return;
  }
  await expect(board).toHaveAttribute("aria-pressed", "false");
  // Only the step chips on the page, like the mockup (the levels wait in « Filtres et tri »).
  await expect(page.getByRole("button", { name: "J’aime", exact: true })).toHaveCount(0);
  // Under « Par étape » only the four columns are read, never the grid's « Tout » page.
  const gridReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/me/items?") && request.url().includes("stages=")) gridReads.push(request.url());
  });
  await board.click();
  await expect(board).toHaveAttribute("aria-pressed", "true");
  const columns = page.getByTestId("stage-column");
  await expect(columns.getByRole("heading", { level: 2 })).toHaveText([
    "Envies · 2",
    "Commandés · 1",
    "Reçus · 1",
    "Dans mon dressing · 2",
  ]);
  await expect(columns.nth(2)).toContainText("Jupe Yara");
  await expect(columns.nth(3)).toContainText("Veste Lore");
  // Side by side.
  const boxes = await Promise.all((await columns.all()).map((column) => column.boundingBox()));
  expect(new Set(boxes.map((box) => Math.round(box?.y ?? 0))).size).toBe(1);
  await page.reload();
  await expect(columns).toHaveCount(4);
  await expect(columns.nth(2)).toContainText("Jupe Yara");
  expect(gridReads).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("par-etape.png"), fullPage: true });
  await axeLightAndDark(page);
  await columns.nth(1).getByRole("link", { name: "Pull Rowan" }).click();
  await expect(page).toHaveURL(/\/produits\//);
  await page.goBack();
  await expect(page.getByRole("button", { name: "Par étape" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Par étape" }).click();
  await expect(cards(page)).toHaveCount(7);
});

test("sans aucun article, l'écran explique quoi faire", async ({ page }) => {
  await page.goto("/articles");
  await expect(page.getByRole("heading", { name: "Rien ici pour l’instant" })).toBeVisible();
  await expect(page.getByText("Colle le lien d’un vêtement que tu aimes")).toBeVisible();
  await expect(page.getByRole("link", { name: "Coller un lien" })).toBeVisible();
  await expect(chips(page).getByRole("link", { name: "Tout · 0" })).toBeVisible();
  await axeLightAndDark(page);
});

test("200 articles : les pastilles comptent tout et la page charge la suite en défilant", async ({
  page,
  db,
  userAgentTag,
}) => {
  test.slow();
  const first = await firstWish(page, db, userAgentTag);
  await db.query(
    `with copies as (
       insert into products (shop_id, canonical_url, name, currency, price_cents, capture_status, source)
       select p.shop_id, p.canonical_url || '#many-' || n, 'Article ' || n, p.currency, p.price_cents,
              p.capture_status, p.source
       from products p, generate_series(1, 200) n where p.id = $1 returning id, name
     )
     insert into items (user_id, profile_id, product_id, stage, created_at)
     select $2, $3, id, case when right(name, 1) in ('1', '2') then 'owned' else 'spotted' end, now()
     from copies`,
    [first.product_id, first.userId, first.profile_id],
  );
  await page.goto("/articles");
  // 40 of the 200 end in 1 or 2 (owned, never moved there: « Dans mon dressing »).
  await expect(chips(page).getByRole("link")).toHaveText([
    "Tout · 201",
    "Envies · 161",
    "Commandés · 0",
    "Reçus · 0",
    "Dans mon dressing · 40",
    "À vendre · 0",
  ]);
  await expect(cards(page)).toHaveCount(48);
  for (const expected of [96, 144, 192, 201]) {
    await cards(page).last().scrollIntoViewIfNeeded();
    await expect(cards(page)).toHaveCount(expected, { timeout: 10_000 });
  }
  const names = await cards(page).getByTestId("card-name").allTextContents();
  expect(new Set(names).size).toBe(201);
});
