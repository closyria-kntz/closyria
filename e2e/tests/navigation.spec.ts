import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 2: one menu (Accueil · Découvrir · + · Mes articles · Moi), at the bottom on a phone and at
// the top from a tablet up; the + opens « Ajouter un article »; the old addresses lead to « Mes articles ».

const PHONE_MAX = 767;
const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) <= PHONE_MAX;
const menu = (page: Page) => page.getByRole("navigation", { name: "Menu principal" });

const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
};

/** The smallest side a finger can reach on `control`: its own box or its invisible hit area (`pseudo`). */
async function reach(control: Locator, pseudo: "::after" | "::before"): Promise<number> {
  return control.evaluate((el, which) => {
    const own = el.getBoundingClientRect();
    const hit = getComputedStyle(el, which);
    const width = Math.max(own.width, Number.parseFloat(hit.width) || 0);
    const height = Math.max(own.height, Number.parseFloat(hit.height) || 0);
    return Math.min(width, height);
  }, pseudo);
}

async function axeLightAndDark(page: Page) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(menu(page)).toBeVisible();
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
  await expect(menu(page)).toBeVisible();
  await axe(page);
}

test("un seul menu : cinq places en bas sur téléphone, quatre liens et « + Ajouter » en haut ailleurs", async ({
  page,
}) => {
  await page.goto("/");
  const nav = menu(page);
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  if (isPhone(page)) {
    await expect(nav).toHaveAttribute("data-testid", "app-nav-bottom");
    await expect(nav.locator("a, button")).toHaveText(["Accueil", "Découvrir", /Ajouter/, "Mes articles", "Moi"]);
    await expect(nav.getByRole("button", { name: "Ajouter un article" })).toBeVisible();
    // The bar sits at the bottom of the screen, every place reachable with a finger.
    const bar = await nav.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeGreaterThan(height - 2);
    for (const target of await nav.locator("a, button").all()) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The + is raised above the bar.
    const plus = await nav.getByRole("button", { name: "Ajouter un article" }).locator("[data-plus]").boundingBox();
    expect(plus?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(bar?.y ?? 0);
    await expect(page.getByTestId("app-nav-top")).toBeHidden();
  } else {
    await expect(nav).toHaveAttribute("data-testid", "app-nav-top");
    await expect(nav.getByRole("link")).toHaveText(["Accueil", "Découvrir", "Mes articles", "Moi"]);
    await expect(page.getByRole("banner").getByRole("button", { name: "Ajouter un article" })).toContainText(
      "+ Ajouter",
    );
    expect((await nav.boundingBox())?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(6 * 16);
    // Every control of the band is a finger wide: drawn smaller, its invisible hit area reaches 44 px.
    const band = page.getByRole("banner");
    const controls = [
      ...(await nav.getByRole("link").all()),
      band.getByRole("button", { name: "Ajouter un article" }),
      band.getByRole("link", { name: /^Mon compte/ }),
    ];
    for (const control of controls) expect(await reach(control, "::after")).toBeGreaterThanOrEqual(44);
    const search = band.getByRole("searchbox", { name: "Rechercher dans mes articles" });
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      // From 1024 px the search field shows in the band (the axe runs below include it).
      await expect(search).toBeVisible();
      expect(await reach(search.locator("xpath=.."), "::before")).toBeGreaterThanOrEqual(44);
    } else await expect(search).toBeHidden();
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();
  }
  await expect(nav.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
  await axeLightAndDark(page);
});

test("le + ouvre « Ajouter un article » et ses quatre façons d'ajouter", async ({ page }) => {
  await page.goto("/decouvrir");
  const opener = isPhone(page)
    ? menu(page).getByRole("button", { name: "Ajouter un article" })
    : page.getByRole("banner").getByRole("button", { name: "Ajouter un article" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter un article" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^(Coller|Prendre|Partager|Transférer)/ })).toHaveText([
    /Coller un lien/,
    /Prendre une photo/,
    /Partager depuis une boutique/,
    /Transférer un e-mail de commande/,
  ]);
  const mail = sheet.getByRole("button", { name: /Transférer un e-mail de commande/ });
  await expect(mail).toBeDisabled();
  await expect(mail).toContainText("Bientôt");
  await axe(page);

  // « Partager depuis une boutique » explains how, in words.
  await sheet.getByRole("button", { name: /^Partager depuis une boutique/ }).click();
  await expect(sheet.getByText(/« Partager »/).first()).toBeVisible();
  await sheet.getByRole("button", { name: "Retour" }).click();

  // « Coller un lien » shows the paste field, which adds the article.
  await sheet.getByRole("button", { name: /^Coller un lien/ }).click();
  const field = sheet.getByLabel("Coller un lien");
  await expect(field).toBeFocused();
  await field.fill(autoProductUrl());
  await sheet.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toBeHidden();

  // Escape closes it and gives the focus back.
  await opener.click();
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(opener).toBeFocused();

  // A link of the sheet closes it, even towards the page she is on.
  await page.goto("/articles");
  await opener.click();
  await sheet.getByRole("button", { name: /^Prendre une photo/ }).click();
  await sheet.getByRole("link", { name: "Ouvrir Mes articles" }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/articles$/);
});

test("les anciennes adresses mènent à « Mes articles », avec l'étape, la liste et les filtres", async ({ page }) => {
  // Pasting a link opens her (anonymous) session.
  await page.goto("/");
  await page.getByRole("main").getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("main").getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  const created = await page.request.post("/api/me/wishlists", { data: { name: "Anniversaire" } });
  expect(created.status()).toBe(201);
  const listId = ((await created.json()) as { id: string }).id;

  await page.goto(`/envies?liste=${listId}&prioritaire=1`);
  await expect(page).toHaveURL(new RegExp(`/articles\\?etape=envie&liste=${listId}&prioritaire=1$`));
  await expect(page.getByRole("heading", { level: 1, name: "Mes envies" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Anniversaire/ })).toHaveAttribute("aria-current", "true");
  await expect(menu(page).getByRole("link", { name: "Mes articles" })).toHaveAttribute("aria-current", "page");

  await page.goto("/dressing?prioritaire=1&tri=price_asc");
  await expect(page).toHaveURL(/\/articles\?etape=dressing&prioritaire=1&tri=price_asc$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dressing" })).toBeVisible();

  await page.goto("/a-vendre?prioritaire=1");
  await expect(page).toHaveURL(/\/articles\?etape=a-vendre&prioritaire=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "À vendre" })).toBeVisible();

  await page.goto("/commande?prioritaire=1");
  await expect(page).toHaveURL(/\/articles\?etape=commande&prioritaire=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "Commandé" })).toBeVisible();
  // « Préparer une commande » keeps its own address.
  await page.goto(`/envies/commande?liste=${listId}`);
  await expect(page).toHaveURL(new RegExp(`/envies/commande\\?liste=${listId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Préparer une commande" })).toBeVisible();

  // The old « Étape » filter (`etape=sold`) becomes `statut`, and a filter chosen on « Mes articles » keeps the step.
  await page.goto("/dressing?etape=sold");
  await expect(page).toHaveURL(/\/articles\?etape=dressing&statut=sold$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dressing" })).toBeVisible();
  await page.goto("/articles?etape=dressing");
  await page.getByRole("button", { name: "Filtres et tri" }).click();
  await page.getByLabel("Trier par").selectOption("price_asc");
  await expect(page).toHaveURL(/\/articles\?etape=dressing&tri=price_asc$/);
  await page.getByLabel("Étape").selectOption("sold");
  await expect(page).toHaveURL(/\/articles\?etape=dressing&tri=price_asc&statut=sold$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dressing" })).toBeVisible();
});

test("la bonne place est marquée sur les sous-pages, et Moi mène à tout ce que l'ancien menu donnait", async ({
  page,
}) => {
  await page.goto("/listes");
  await expect(menu(page).getByRole("link", { name: "Mes articles" })).toHaveAttribute("aria-current", "page");
  await page.goto("/reglages/profils");
  await expect(menu(page).getByRole("link", { name: "Moi" })).toHaveAttribute("aria-current", "page");
  await page.goto("/decouvrir");
  await expect(menu(page).getByRole("link", { name: "Découvrir" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Découvrir arrive bientôt : les boutiques que Closyria connaît.")).toBeVisible();

  await menu(page).getByRole("link", { name: "Moi" }).click();
  await expect(page).toHaveURL(/\/moi$/);
  await expect(menu(page).getByRole("link", { name: "Moi" })).toHaveAttribute("aria-current", "page");
  const places = page.getByRole("main").getByRole("navigation", { name: "Mes pages" });
  await expect(places.getByRole("link")).toHaveText([
    "Mes envies",
    "Commandé",
    "Mon dressing",
    "À vendre",
    "Mes listes",
    /^Mon budget/,
    "Réglages",
    /^Mon compte/,
    "Aide iPhone",
  ]);
  await expect(places.getByRole("link", { name: /^Mon compte/ })).toContainText("Sans compte");
  await places.getByRole("link", { name: "Mon dressing" }).click();
  await expect(page).toHaveURL(/\/articles\?etape=dressing$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dressing" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "Mes articles" })).toHaveAttribute("aria-current", "page");
  await axe(page);
});
