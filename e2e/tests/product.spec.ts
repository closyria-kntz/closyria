import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { autoProductUrl, keepWish, MANUAL_SHOP, manualProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte « Cocon lumineux », task 13 and palier 3 bis: the product sheet is a gallery in shape C and separate blocks,
// with the price curve.

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const DAY_MS = 86_400_000;

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const gallery = (page: Page) => page.getByTestId("product-gallery");
const wish = (page: Page) => page.getByRole("region", { name: "Ton envie" });

async function axe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
}

/** Pastes a fresh address of the fake shop's product and waits for its sheet; returns the product id. */
async function openSheet(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  const id = /\/produits\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`no product id in ${page.url()}`);
  return id;
}

/** Kept, with one photo of her own on top of the shop's: the gallery has at least two photos. */
async function keptWithPhoto(page: Page): Promise<string> {
  const id = await openSheet(page);
  await keepWish(page);
  await page.getByRole("button", { name: "Ajouter une photo" }).click();
  await page.getByTestId("photo-input").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: PIXEL });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("listitem")).toHaveCount(1);
  return id;
}

/** Earlier captures of the product, `days` ago, at `cents` (the capture of today is already there, at 23 €). */
async function seedHistory(db: import("pg").Pool, productId: string, rows: [days: number, cents: number][]) {
  for (const [days, cents] of rows) {
    await db.query(
      `insert into product_history (product_id, seen_at, price_cents, sizes)
       values ($1, now() - make_interval(days => $2), $3, '{}'::jsonb)`,
      [productId, days, cents],
    );
  }
}

const weekdayAgo = (days: number) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.now() - days * DAY_MS));

/** The colour a token resolves to, as computed styles report it. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const boxOf = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("no box");
  return found;
};

test("la galerie : une grande photo en forme C, des vignettes de même forme dessous, des points qui s'étirent", async ({
  page,
}) => {
  await keptWithPhoto(page);
  const main = gallery(page).getByTestId("gallery-main");
  await expect(main).toHaveCSS("border-top-left-radius", "44px");
  await expect(main).toHaveCSS("border-bottom-right-radius", "14px");
  await expect(gallery(page).getByTestId("gallery-photo").locator("img")).toHaveCSS("object-fit", "cover");
  const thumbs = gallery(page).getByTestId("gallery-thumbs").getByRole("button");
  const count = await thumbs.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (const thumb of await thumbs.all()) {
    await expect(thumb).toHaveCSS("border-top-left-radius", "20px");
    await expect(thumb).toHaveCSS("border-bottom-left-radius", "8px");
  }
  // Below the big photo, not beside it.
  const mainBox = await boxOf(main);
  expect((await boxOf(thumbs.first())).y).toBeGreaterThan(mainBox.y + mainBox.height - 1);

  const dots = gallery(page).getByTestId("gallery-dots").locator("[data-dot]");
  await expect(dots).toHaveCount(count);
  await expect(dots.first()).toHaveAttribute("data-current", "true");
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await boxOf(dots.first())).width).toBeGreaterThan((await boxOf(dots.nth(1))).width);

  // Thumbnails change photo without a motion of their own: the dot is the one that moves.
  await expect(thumbs.first()).toHaveCSS("transform", "none");
  await gallery(page).getByRole("button", { name: "Photo suivante" }).click();
  await expect(dots.nth(1)).toHaveAttribute("data-current", "true");
  await expect(dots.first()).toHaveAttribute("data-current", "false");
  await expect(thumbs.nth(1)).toHaveAttribute("aria-pressed", "true");
  await gallery(page).getByRole("button", { name: "Photo précédente" }).click();
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await thumbs.nth(1).click();
  await expect(dots.nth(1)).toHaveAttribute("data-current", "true");

  // Her level is the emoji alone on the photo; every target is a finger wide.
  await expect(gallery(page).getByRole("button", { name: /niveau : J’aime/ })).toBeVisible();
  for (const target of await gallery(page).getByRole("button").all()) {
    const box = await boxOf(target);
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
  await axe(page);
});

test("la photo qu'elle vient d'ajouter s'affiche en grand", async ({ page }) => {
  await keptWithPhoto(page);
  const photo = gallery(page).getByTestId("gallery-photo");
  await expect(photo).toHaveAccessibleName("Agrandir ta photo 1");
  await gallery(page).getByRole("button", { name: "Voir la photo 1 de la boutique" }).click();
  await expect(photo).toHaveAccessibleName("Agrandir la photo 1 de la boutique");
  await page.getByRole("button", { name: "Ajouter une photo" }).click();
  await page.getByTestId("photo-input").setInputFiles({ name: "p2.png", mimeType: "image/png", buffer: PIXEL });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("listitem")).toHaveCount(2);
  await expect(photo).toHaveAccessibleName("Agrandir ta photo 2");
  await expect(gallery(page).getByRole("button", { name: "Voir ta photo 2" })).toHaveAttribute("aria-pressed", "true");
});

test("un clic sur la grande photo l'agrandit ; un double-tap ouvre les 4 niveaux sur le niveau actuel", async ({
  page,
}) => {
  await keptWithPhoto(page);
  const photo = gallery(page).getByTestId("gallery-photo");
  await photo.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  await photo.dblclick();
  const bubble = page.getByRole("radiogroup", { name: `Ton niveau d’envie pour ${PRODUCT.name}` });
  await expect(bubble).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Not forced to the highest level: the bubble opens on hers, nothing changed yet.
  await expect(bubble.getByRole("radio", { checked: true })).toHaveAccessibleName("J’aime");
  await expect(wish(page).getByRole("button", { name: "J’aime" })).toHaveAttribute("aria-pressed", "true");
  await bubble.getByRole("radio", { name: "Mims" }).click();
  await expect(bubble).toBeHidden();
  await expect(toast(page)).toContainText("Mims");
  await expect(wish(page).getByRole("button", { name: "Mims" })).toHaveAttribute("aria-pressed", "true");
});

test("l'article : une seule mention de baisse et la courbe des 3 mois", async ({ page, db }) => {
  const id = await openSheet(page);
  await seedHistory(db, id, [
    [85, 2500],
    [40, 2600],
    [3, 2300],
  ]);
  await page.reload();
  const header = page.getByTestId("product-header");
  await expect(header.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
  const curve = header.getByRole("img", { name: /^Prix sur 3 mois : de 25\s€ à 23\s€$/ });
  await expect(curve).toBeVisible();
  const line = new RegExp(`^−3\\s€ depuis ${weekdayAgo(3)}, le plus bas depuis 2 mois$`);
  await expect(page.getByText(line)).toHaveCount(1);
  await expect(page.getByText(/depuis/)).toHaveCount(1);
  await expect(page.getByText(/plus bas de tous les temps|jamais vu/i)).toHaveCount(0);
  // The line in champagne, the end point in green.
  await expect(curve.locator("polyline")).toHaveCSS("stroke", await tokenColor(page, "--color-detail"));
  await expect(curve.locator("circle")).toHaveCSS("fill", await tokenColor(page, "--color-success"));
  await axe(page);
});

test("une baisse récente sans recul de 30 jours ne dit pas « le plus bas »", async ({ page, db }) => {
  const id = await openSheet(page);
  await seedHistory(db, id, [
    [10, 2300],
    [5, 2600],
  ]);
  await page.reload();
  await expect(page.getByRole("img", { name: /^Prix sur 3 mois/ })).toBeVisible();
  await expect(page.getByText(/^−3\s€ depuis aujourd’hui$/)).toBeVisible();
  await expect(page.getByText(/le plus bas/)).toHaveCount(0);
});

test("sans historique, ni courbe ni mention de baisse", async ({ page }) => {
  await openSheet(page);
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
  await expect(page.getByText(PRODUCT.price)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Prix sur 3 mois/ })).toHaveCount(0);
  await expect(page.getByText(/depuis/)).toHaveCount(0);
});

test("ton envie : niveaux en tuiles, « Prioritaire » en petite pastille cochée, pourquoi en citation", async ({
  page,
}) => {
  await openSheet(page);
  await keepWish(page);
  const levels = wish(page).getByRole("group", { name: "Tu l’aimes comment ?" });
  const chosen = levels.getByRole("button", { name: "J’aime" });
  await expect(chosen).toHaveAttribute("aria-pressed", "true");
  await expect(chosen).toHaveCSS("border-top-color", await tokenColor(page, "--color-accent"));
  await expect(chosen).toHaveCSS("background-color", await tokenColor(page, "--color-hint"));
  const other = levels.getByRole("button", { name: "Mims" });
  await expect(other).toHaveCSS("background-color", await tokenColor(page, "--color-surface-raised"));

  const priority = wish(page).getByRole("button", { name: "Prioritaire" });
  await expect(priority).toHaveAttribute("aria-pressed", "false");
  await expect(priority.locator("svg")).toHaveCount(0);
  await priority.click();
  await expect(priority).toHaveAttribute("aria-pressed", "true");
  await expect(priority.locator("svg path")).toHaveCount(1);
  // A small pill beside the title, its button still a finger high.
  const title = await boxOf(wish(page).getByRole("heading", { name: "Ton envie" }));
  const pill = await boxOf(priority);
  expect(pill.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(pill.y + pill.height / 2 - (title.y + title.height / 2))).toBeLessThan(8);
  await expect(priority.locator("span").first()).toHaveCSS("background-color", await tokenColor(page, "--color-hint"));

  // No field until she asks for it; once saved, the « pourquoi » is a quote in italic Gloock.
  await expect(wish(page).getByLabel("Pourquoi ? (facultatif)")).toHaveCount(0);
  await wish(page).getByRole("button", { name: "Dire pourquoi" }).click();
  const why = wish(page).getByLabel("Pourquoi ? (facultatif)");
  await expect(why).toBeFocused();
  await expect(why).toHaveCSS("font-style", "italic");
  await why.fill("Pour le mariage de Claire");
  await wish(page).getByRole("button", { name: "Enregistrer l’avis" }).click();
  await expect(toast(page)).toContainText("Avis enregistré");
  const quote = wish(page).getByTestId("item-why");
  await expect(quote).toHaveText("« Pour le mariage de Claire »");
  await expect(quote).toHaveCSS("font-style", "italic");
  expect(await quote.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Gloock/i);
  await expect(wish(page).getByLabel("Pourquoi ? (facultatif)")).toHaveCount(0);
  // « Modifier », then Escape: the field goes, nothing changed.
  await wish(page).getByRole("button", { name: "Modifier le pourquoi" }).click();
  await expect(why).toHaveValue("Pour le mariage de Claire");
  await page.keyboard.press("Escape");
  await expect(quote).toHaveText("« Pour le mariage de Claire »");
  await axe(page);
});

test("« Voir chez », « Je le prends » et « Partager » (l'adresse de la boutique, copiée)", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  // No share menu (a computer): « Partager » copies.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", { value: undefined, configurable: true });
  });
  await openSheet(page);
  // Not kept yet: no order to take it in, the shop and « Partager » are there.
  await expect(page.getByRole("button", { name: "Je le prends" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Voir chez Fausse boutique" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Partager" })).toBeVisible();
  await keepWish(page);

  const actions = page.getByTestId("product-actions");
  const shopLink = actions.getByRole("link", { name: "Voir chez Fausse boutique" });
  await expect(shopLink).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: /Voir chez/ })).toHaveCount(1);
  // « Je le prends », « Voir chez … », « Partager », in this order, on one row once there is room for it.
  await expect(actions.locator("a, button")).toHaveText(["Je le prends", "Voir chez Fausse boutique", "Partager"]);
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    const tops = await Promise.all((await actions.locator("a, button").all()).map(async (el) => (await boxOf(el)).y));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(2);
  }

  const take = actions.getByRole("button", { name: "Je le prends" });
  await expect(take).toHaveAttribute("aria-pressed", "false");
  await take.click();
  await expect(take).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page)).toContainText("Ajouté à ma commande");
  await expect
    .poll(async () => {
      const { items } = (await (await page.request.get("/api/me/items")).json()) as {
        items: { inOrderDraft: boolean }[];
      };
      return items[0]?.inOrderDraft;
    })
    .toBe(true);
  await toast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(take).toHaveAttribute("aria-pressed", "false");

  // The sheet needs an account: a friend gets the shop's page, never /produits/….
  await actions.getByRole("button", { name: "Partager" }).click();
  await expect(actions.getByText("Lien de la boutique copié")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(await shopLink.getAttribute("href"));
  expect(copied).not.toContain("/produits/");
  for (const target of await actions.locator("a, button").all()) {
    expect((await boxOf(target)).height).toBeGreaterThanOrEqual(44);
  }
  await axe(page);
});

test("« Partager » ouvre le menu de partage du téléphone quand il existe ; le fermer ne dit rien", async ({ page }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { shareCalls: unknown[] }).shareCalls = calls;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: (data: unknown) => {
        calls.push(data);
        return calls.length === 1 ? Promise.resolve() : Promise.reject(new DOMException("closed", "AbortError"));
      },
    });
  });
  await openSheet(page);
  const href = await page.getByRole("link", { name: "Voir chez Fausse boutique" }).getAttribute("href");
  const share = page.getByRole("button", { name: "Partager" });
  await share.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shareCalls: unknown[] }).shareCalls))
    .toEqual([{ title: PRODUCT.name, url: href }]);
  await share.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shareCalls: unknown[] }).shareCalls.length))
    .toBe(2);
  await expect(page.getByText(/copié|Copie impossible/)).toHaveCount(0);
});

test("fiche d'une boutique non lisible, pas encore remplie : « Voir chez » reste là, pas de « Partager »", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(manualProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByLabel("Nom de l’article")).toBeVisible();
  const link = page.getByRole("link", { name: `Voir chez ${MANUAL_SHOP.name}` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /^http:\/\/manuelle\.e2e\.test\//);
  await expect(page.getByRole("button", { name: "Partager" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Je le prends" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /^Prix sur 3 mois/ })).toHaveCount(0);
});

test("boutique non lisible, fiche remplie : phrase claire, tailles à la main, pas de courbe, carte « Prix noté à la main »", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(manualProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Nom de l’article").fill("Robe en lin");
  await page.getByLabel("Prix (en euros)").fill("49,90");
  await page.getByLabel("Tailles").fill("S, M");
  await page.getByRole("button", { name: "Enregistrer la fiche" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Robe en lin" })).toBeVisible();
  const today = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date());
  const note = page.getByTestId("manual-shop-note");
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    `${MANUAL_SHOP.name} ne permet pas la lecture automatique : prix et tailles notés à la main, mis à jour le ${today}. Closyria ne peut donc pas suivre le stock ni les baisses de prix de cette boutique.`,
  );
  await expect(page.getByText("notées à la main, stock non suivi")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Prix sur 3 mois/ })).toHaveCount(0);
  await axe(page);

  await keepWish(page);
  await page.goto("/envies");
  const card = page.getByTestId("item-card").filter({ hasText: "Robe en lin" });
  await expect(card.getByText("Prix noté à la main")).toBeVisible();
});

test("boutique lisible : aucune phrase « à la main » ni sur la fiche ni sur la carte", async ({ page }) => {
  await openSheet(page);
  await expect(page.getByTestId("manual-shop-note")).toHaveCount(0);
  await keepWish(page);
  await page.goto("/envies");
  await expect(page.getByText("Prix noté à la main")).toHaveCount(0);
});

test("téléphone ou ordinateur : la galerie puis les blocs, ou côte à côte", async ({ page }) => {
  await openSheet(page);
  await keepWish(page);
  const galleryBox = await boxOf(gallery(page));
  const infoBox = await boxOf(page.getByTestId("product-info"));
  const width = page.viewportSize()?.width ?? 0;
  if (width < 768) expect(infoBox.y).toBeGreaterThan(galleryBox.y + galleryBox.height - 1);
  else if (width >= 1024) expect(infoBox.x).toBeGreaterThan(galleryBox.x + galleryBox.width - 1);
  // Every block of the sheet is a glass card.
  const blocks = page.getByTestId("product-info").locator("[data-block]");
  for (const block of await blocks.all()) await expect(block).toHaveClass(/\bglass\b/);
  expect(await blocks.count()).toBeGreaterThanOrEqual(4);
});

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });

  test("la courbe est dessinée d'emblée et rien ne reste invisible", async ({ page, db }) => {
    const id = await openSheet(page);
    await seedHistory(db, id, [
      [85, 2500],
      [40, 2600],
    ]);
    await page.reload();
    await keepWish(page);
    const curve = page.getByRole("img", { name: /^Prix sur 3 mois/ });
    await expect(curve).toBeVisible();
    await expect(curve.locator("polyline")).toHaveCSS("stroke-dashoffset", "0px");
    const hidden = await page
      .getByRole("article")
      .evaluate((root) =>
        [...root.querySelectorAll("*")].filter((el) => getComputedStyle(el).opacity === "0").map((el) => el.outerHTML),
      );
    expect(hidden).toEqual([]);
  });
});
