import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 13: the shell and the pages adapt to the screen (spec §4, « Adaptation aux écrans »).
const REM = 16;

async function openSheet(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
  await expect(page.getByRole("img", { name: PRODUCT.name }).first()).toBeVisible();
}

async function box(page: Page, selector: string) {
  const found = await page.locator(selector).first().boundingBox();
  if (!found) throw new Error(`no box for ${selector}`);
  return found;
}

test.describe("1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("la fiche a deux colonnes, le menu latéral et un contenu large", async ({ page }) => {
    await openSheet(page);

    const side = page.getByRole("navigation", { name: "Menu principal" });
    await expect(side).toBeVisible();
    await expect(side.getByRole("link")).toHaveText([
      "Accueil",
      "Envies",
      "Commandé",
      "Dressing",
      "À vendre",
      "Listes",
      "Réglages",
    ]);
    // The product sheet is not one of the menu's places: no entry claims to be the current page.
    await expect(side.locator("[aria-current=page]")).toHaveCount(0);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();

    const gallery = await box(page, "[data-testid=product-gallery]");
    const info = await box(page, "[data-testid=product-info]");
    expect(info.x).toBeGreaterThan(gallery.x + gallery.width - 1);
    expect(Math.abs(info.y - gallery.y)).toBeLessThan(2 * REM);
    // The sheet itself (gallery + information columns) uses the width, it is not a narrow strip in the middle.
    expect(info.x + info.width - gallery.x).toBeGreaterThan(60 * REM);
  });

  test("« + Ajouter » ouvre le champ « Coller un lien », Échap le ferme et rend le focus au bouton", async ({
    page,
  }) => {
    await openSheet(page);
    const button = page.getByRole("button", { name: "+ Ajouter" });
    await button.click();
    const field = page.getByLabel("Coller un lien");
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("« Aller au contenu » est le premier arrêt au clavier et mène au contenu", async ({ page }) => {
    await openSheet(page);
    // On arrival on a page: the home page now shares the shell, so the sheet is loaded afresh.
    await page.reload();
    await page.locator("body").press("Tab");
    const skip = page.getByRole("link", { name: "Aller au contenu" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#app-content")).toBeFocused();
  });

  test("?profil=<id> choisit ce profil dans le sélecteur", async ({ page }) => {
    await openSheet(page);
    const created = await page.request.post("/api/me/profiles", {
      data: { name: "Léa", audience: "women", color: "rose" },
    });
    expect(created.ok()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    const summary = (await (await page.request.get("/api/me/summary")).json()) as { profiles: { id: string }[] };
    const first = summary.profiles[0]?.id;
    expect(summary.profiles.length).toBeGreaterThanOrEqual(2);

    const switcher = page.getByRole("combobox", { name: "Profil" });
    await page.goto(`${page.url()}&profil=${id}`);
    await expect(switcher).toHaveValue(id);
    await page.goto(page.url().replace(/&profil=[^&]+/, ""));
    await expect(switcher).toHaveValue(first ?? "");
  });

  test("l'accueil a le menu, « Accueil » y est la page courante et y ramène depuis une autre page", async ({
    page,
  }) => {
    await page.goto("/");
    const side = page.getByRole("navigation", { name: "Menu principal" });
    await expect(side.getByRole("link", { name: "Accueil" })).toHaveAttribute("aria-current", "page");
    // The paste field is on the page itself: no « + Ajouter » in the header.
    await expect(page.getByRole("button", { name: "+ Ajouter" })).toHaveCount(0);
    await side.getByRole("link", { name: "Envies" }).click();
    await expect(page).toHaveURL(/\/envies$/);
    await side.getByRole("link", { name: "Accueil" }).click();
    await expect(page.getByLabel("Coller un lien")).toBeVisible();
  });

  test("la page d'accueil donne un champ confortable sur ordinateur", async ({ page }) => {
    await page.goto("/");
    const field = await page.getByLabel("Coller un lien").boundingBox();
    expect(field?.width ?? 0).toBeGreaterThan(32 * REM);
  });
});

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("la barre d'onglets est en bas, la fiche sur une colonne", async ({ page }) => {
    await openSheet(page);

    const bar = page.getByRole("navigation", { name: "Onglets" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link")).toHaveText(["Accueil", "Envies", "Commandé", "Dressing"]);
    await expect(bar.getByRole("button", { name: "Plus" })).toBeVisible();
    await expect(bar.locator("[aria-current=page]")).toHaveCount(0);
    const barBox = await box(page, "[data-testid=app-nav-bottom]");
    expect(barBox.y + barBox.height).toBeGreaterThan(844 - 2);
    for (const target of await bar.locator("a, button").all()) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The five tabs fit side by side, even on a narrow phone (360 px).
    await page.setViewportSize({ width: 360, height: 844 });
    for (const target of await bar.locator("a, button").all()) {
      const tab = await target.boundingBox();
      expect(tab ? tab.x + tab.width : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(360);
      expect(await target.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    const gallery = await box(page, "[data-testid=product-gallery]");
    const info = await box(page, "[data-testid=product-info]");
    expect(info.y).toBeGreaterThan(gallery.y + gallery.height - 1);

    await bar.getByRole("button", { name: "Plus" }).click();
    await expect(page.getByRole("link", { name: "À vendre" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Listes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Réglages" })).toBeVisible();
  });

  test("tout en bas de la page, le dernier élément reste visible au-dessus de la barre, « Plus » ouvert ou non", async ({
    page,
  }) => {
    await openSheet(page);
    const last = page.locator("[data-testid=product-info] > :last-child");
    const bar = page.getByTestId("app-nav-bottom");

    const expectLastAboveBar = async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY + window.innerHeight)).toBeGreaterThan(0);
      const lastBox = await last.boundingBox();
      const barBox = await bar.boundingBox();
      expect(lastBox && barBox ? lastBox.y + lastBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
        barBox?.y ?? 0,
      );
    };

    await expectLastAboveBar();
    await bar.getByRole("button", { name: "Plus" }).click();
    await expect(page.getByRole("link", { name: "Listes" })).toBeVisible();
    await expectLastAboveBar();
  });
});

test.describe("820 px", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("les onglets sont en haut", async ({ page }) => {
    await openSheet(page);

    const tabs = page.getByRole("navigation", { name: "Onglets" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveCount(7);
    expect((await box(page, "[data-testid=app-nav-top]")).y).toBeLessThan(6 * REM);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeHidden();
  });
});

// Chantier 2a, task 8: the sheet has three parts, in this order.
test.describe("structure de la fiche", () => {
  const verticalOrder = async (page: Page, selectors: string[]) => {
    const ys: number[] = [];
    for (const selector of selectors) ys.push((await box(page, selector)).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  };

  test("fiche gardée : en-tête, Mon article, La fiche de la boutique, Autres actions", async ({ page }) => {
    await openSheet(page);
    const created = await page.request.post("/api/me/profiles", {
      data: { name: "Léa", audience: "women", color: "rose" },
    });
    expect(created.ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "Favori" }).click();
    const mine = page.getByRole("region", { name: "Mon article" });
    await expect(mine).toBeVisible();

    const header = page.getByTestId("product-header");
    await expect(header.getByRole("link", { name: /Voir chez/ })).toBeVisible();
    await expect(header.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
    const shop = page.getByRole("region", { name: "La fiche de la boutique" });
    await expect(shop.getByRole("region", { name: "Tailles" })).toBeVisible();
    // Its parts (sizes, traits, description) are h3 under the part's own h2.
    await expect(shop.getByRole("heading", { level: 3, name: "Tailles" })).toBeVisible();
    await expect(shop.getByRole("heading", { level: 2 })).toHaveText(["La fiche de la boutique"]);
    await expect(shop.getByText(/Mis à jour le/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Voir chez/ })).toHaveCount(1);
    const more = page.getByRole("region", { name: "Autres actions" });
    await expect(more.getByRole("button", { name: "Déplacer" })).toBeVisible();
    await expect(more.getByRole("button", { name: "Supprimer" })).toBeVisible();
    // Her item keeps its own controls inside the first box, not in the shop's part.
    await expect(mine.getByRole("button", { name: /Passer à/ }).first()).toBeVisible();
    await expect(mine.getByLabel("Taille", { exact: true })).toBeVisible();
    await expect(shop.getByLabel("Taille", { exact: true })).toHaveCount(0);

    await verticalOrder(page, [
      "[data-testid=product-header]",
      "section[aria-labelledby=mine-title]",
      "section[aria-labelledby=shop-title]",
      "section[aria-labelledby=more-title]",
    ]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("fiche non gardée : en-tête, Garder cet article, La fiche de la boutique", async ({ page }) => {
    await openSheet(page);
    await expect(page.getByRole("heading", { name: "Garder cet article" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Favori" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Mon article" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Autres actions" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "La fiche de la boutique" }).getByRole("region", { name: "Tailles" }),
    ).toBeVisible();
    await verticalOrder(page, [
      "[data-testid=product-header]",
      "section[aria-labelledby=keep-title]",
      "section[aria-labelledby=shop-title]",
    ]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test.describe("360 px", () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("pas de défilement horizontal, gardée ou non", async ({ page }) => {
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await openSheet(page);
      expect(await overflow()).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: "Favori" }).click();
      await expect(page.getByRole("region", { name: "Mon article" })).toBeVisible();
      expect(await overflow()).toBeLessThanOrEqual(0);
    });
  });
});
