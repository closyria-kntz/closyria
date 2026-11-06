import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, manualProductUrl, PRODUCT } from "../fixtures/shops";
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

/** The app content is the only area that scrolls (Passe design §1). */
async function scrollContentToBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.getElementById("app-content");
    if (!main) throw new Error("no #app-content");
    main.scrollTop = main.scrollHeight;
    return main.scrollTop;
  });
}

const windowScroll = (page: Page) =>
  page.evaluate(() => ({
    y: window.scrollY,
    overflow: (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight,
  }));

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
    // The four stage places carry their count in their name (« Envies 0 article »).
    const names = await side.getByRole("link").evaluateAll((links) => links.map((a) => a.textContent ?? ""));
    expect(names.map((name) => name.replace(/\d+ articles?\d+$/, ""))).toEqual([
      "Accueil",
      "Envies",
      "Commandé",
      "Dressing",
      "À vendre",
      "Listes",
      "Réglages",
      "Aide",
    ]);
    // The product sheet is not one of the menu's places: no entry claims to be the current page.
    await expect(side.locator("[aria-current=page]")).toHaveCount(0);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();

    // Passe design §3: the main column and the side panel, side by side, using the width.
    const main = await box(page, "[data-testid=product-main]");
    const panel = await box(page, "[data-testid=product-side]");
    expect(panel.x).toBeGreaterThan(main.x + main.width - 1);
    expect(Math.abs(panel.y - main.y)).toBeLessThan(2 * REM);
    expect(panel.x + panel.width - main.x).toBeGreaterThan(60 * REM);
  });

  test("« + Ajouter » ouvre le champ « Coller un lien », Échap le ferme et rend le focus au bouton", async ({
    page,
  }) => {
    // From 1024 px the header has the field itself (Passe design §2): « + Ajouter » is for tablets and phones.
    await page.setViewportSize({ width: 820, height: 1180 });
    await openSheet(page);
    const button = page.getByRole("button", { name: "+ Ajouter" });
    await button.click();
    // The header's own field exists from 1024 px only (hidden here): by role, only the visible one.
    const field = page.getByRole("textbox", { name: "Coller un lien" });
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

  test("l'accueil demande quel article, puis résume le dressing (Passe design §4)", async ({ page }) => {
    await page.goto("/");
    const content = page.locator("#app-content");
    const title = content.getByRole("heading", { level: 1, name: "Quel article as-tu repéré ?" });
    await expect(title).toBeVisible();
    await expect(content.getByText("Closyria", { exact: true })).toHaveCount(0);
    await expect(content.getByText(/arrive bientôt/)).toHaveCount(0);
    // A comfortable but compact field, aligned with the title (no more centred text).
    const field = page.getByLabel("Coller un lien");
    const fieldBox = await field.boundingBox();
    const titleBox = await title.boundingBox();
    expect(fieldBox?.width ?? 0).toBeGreaterThan(30 * REM);
    expect(fieldBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(35 * REM);
    expect(Math.abs((fieldBox?.x ?? 0) - (titleBox?.x ?? -100))).toBeLessThanOrEqual(1);

    // A new account: the four places, at zero.
    const summary = page.getByRole("navigation", { name: "Mon dressing en bref" });
    for (const name of ["0 commandé en route", "0 envie", "0 dans ton dressing", "0 à vendre"]) {
      await expect(summary.getByRole("link", { name, exact: true })).toBeVisible();
    }

    await field.fill(autoProductUrl());
    await page.getByRole("button", { name: "Ajouter" }).click();
    await page.getByRole("button", { name: "Favori" }).click();
    await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
    await page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Accueil" }).click();
    const wishes = summary.getByRole("link", { name: "1 envie", exact: true });
    await expect(wishes).toBeVisible();
    await wishes.click();
    await expect(page).toHaveURL(/\/envies$/);
  });
});

// Passe design §2: counts beside the places, « Aide » at the bottom of the side menu, the paste field in the header.
test.describe("menu et en-tête, ordinateur", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("le menu latéral montre les compteurs du profil courant et Aide en bas", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("button", { name: "Favori" }).click();
    await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
    const side = page.getByRole("navigation", { name: "Menu principal" });
    await expect(side.getByRole("link", { name: "Envies 1 article", exact: true })).toBeVisible();
    await expect(side.getByRole("link", { name: "Commandé 0 article", exact: true })).toBeVisible();
    await expect(page.locator("aside a").last()).toHaveText("Aide");
    // Inside the « Menu principal » landmark, for those who move by landmarks.
    await expect(side.getByRole("link", { name: "Aide", exact: true })).toBeVisible();
  });

  test("changer de profil met à jour les compteurs, sans recharger", async ({ page }) => {
    await openSheet(page);
    await page.getByRole("button", { name: "Favori" }).click();
    await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
    const created = await page.request.post("/api/me/profiles", {
      data: { name: "Léa", audience: "women", color: "rose" },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto("/envies");
    const side = page.getByRole("navigation", { name: "Menu principal" });
    await expect(side.getByRole("link", { name: "Envies 1 article", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Profil" }).selectOption(id);
    await expect(side.getByRole("link", { name: "Envies 0 article", exact: true })).toBeVisible();
  });

  test("le champ de l'en-tête ajoute un lien, puis un autre", async ({ page }) => {
    await page.goto("/dressing");
    for (let round = 0; round < 2; round++) {
      const field = page.locator("header").getByLabel("Coller un lien");
      await expect(field).toHaveValue("");
      await field.fill(autoProductUrl());
      await page.locator("header").getByRole("button", { name: "Ajouter" }).click();
      await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
      // A click in the menu: the shell (and its header field) stays mounted, as in real use.
      if (round === 0) {
        await page
          .getByRole("navigation", { name: "Menu principal" })
          .getByRole("link", { name: /^Envies/ })
          .click();
        await expect(page).toHaveURL(/\/envies$/);
      }
    }
  });

  test("l'en-tête a le champ Coller un lien hors de l'accueil", async ({ page }) => {
    await page.goto("/dressing");
    await expect(page.locator("header").getByLabel("Coller un lien")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Ajouter" })).toBeHidden();
    await page.goto("/");
    await expect(page.locator("header").getByLabel("Coller un lien")).toHaveCount(0);
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
    const info = await box(page, "[data-testid=product-header]");
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
    const last = page.locator("#app-content article > :last-child");
    const bar = page.getByTestId("app-nav-bottom");

    const expectLastAboveBar = async () => {
      await scrollContentToBottom(page);
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

  const keep = async (page: Page) => {
    await page.getByRole("button", { name: "Favori" }).click();
    await expect(page.getByRole("region", { name: "Mon article" })).toBeVisible();
  };

  test("fiche gardée, 1440 px : la boutique au centre, Mon article à droite qui défile seul", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSheet(page);
    const created = await page.request.post("/api/me/profiles", {
      data: { name: "Léa", audience: "women", color: "rose" },
    });
    expect(created.ok()).toBe(true);
    await page.reload();
    await keep(page);

    const header = page.getByTestId("product-header");
    await expect(header.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
    await expect(page.getByRole("link", { name: /Voir chez/ })).toHaveCount(1);
    // Her stage, at a glance under the price (Passe design §3).
    await expect(page.getByTestId("item-summary")).toContainText("Repéré");

    const shop = page.getByRole("region", { name: "La fiche de la boutique" });
    await expect(shop.getByRole("heading", { level: 3, name: "Tailles" })).toBeVisible();
    await expect(shop.getByRole("heading", { level: 2 })).toHaveText(["La fiche de la boutique"]);
    await expect(shop.getByLabel("Taille", { exact: true })).toHaveCount(0);

    const side = page.getByTestId("product-side");
    const mine = side.getByRole("region", { name: "Mon article" });
    await expect(mine.getByRole("button", { name: /Passer à/ }).first()).toBeVisible();
    await expect(mine.getByLabel("Taille", { exact: true })).toBeVisible();
    const more = side.getByRole("region", { name: "Autres actions" });
    await expect(more.getByRole("button", { name: "Déplacer" })).toBeVisible();

    const shopBox = await box(page, "section[aria-labelledby=shop-title]");
    const mineBox = await box(page, "section[aria-labelledby=mine-title]");
    expect(mineBox.x).toBeGreaterThan(shopBox.x + shopBox.width - 1);
    expect(mineBox.y).toBeLessThan(shopBox.y + shopBox.height);
    expect(await side.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  for (const width of [1100, 390]) {
    test(`fiche gardée, ${width} px : une colonne, photos, en-tête, boutique, Mon article, Autres actions`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openSheet(page);
      await keep(page);
      await expect(page.getByTestId("item-summary")).toContainText("Repéré");
      await verticalOrder(page, [
        "[data-testid=product-gallery]",
        "[data-testid=product-header]",
        "section[aria-labelledby=shop-title]",
        "section[aria-labelledby=mine-title]",
        "section[aria-labelledby=more-title]",
      ]);
    });
  }

  test("390 px, fiche gardée : la boutique précède Mon article aussi pour le clavier et les lecteurs d'écran", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSheet(page);
    await keep(page);
    const shopFirst = await page.evaluate(() => {
      const shop = document.querySelector("section[aria-labelledby=shop-title]");
      const mine = document.querySelector("section[aria-labelledby=mine-title]");
      return Boolean(shop && mine && shop.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(shopFirst).toBe(true);
  });

  test("1440 px : l'avis « déjà dans le profil » vient sous l'en-tête, pas au-dessus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSheet(page);
    await keep(page);
    const created = await page.request.post("/api/me/profiles", {
      data: { name: "Léa", audience: "women", color: "rose" },
    });
    const { id } = (await created.json()) as { id: string };
    await page.goto(`${page.url().split("?")[0]}?profil=${id}`);
    const notice = page.getByRole("status").filter({ hasText: /Moi/ });
    await expect(notice).toBeVisible();
    const header = await box(page, "[data-testid=product-header]");
    const noticeBox = await notice.boundingBox();
    expect(noticeBox?.y ?? 0).toBeGreaterThan(header.y + header.height - 1);
  });

  test("1440 px, boutique à compléter à la main : pas de panneau vide, le formulaire prend la largeur", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByLabel("Coller un lien").fill(manualProductUrl());
    await page.getByRole("button", { name: "Ajouter" }).click();
    const name = page.getByLabel("Nom de l’article");
    await expect(name).toBeVisible();
    const main = await box(page, "[data-testid=product-main]");
    const content = await box(page, "#app-content article");
    expect(main.width).toBeGreaterThan(content.width - 1);
  });

  test("les étapes passées se reconnaissent sans la couleur : un ✓ et « étape passée » dans le nom", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSheet(page);
    await keep(page);
    const productId = /\/produits\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
    const found = (await (await page.request.get(`/api/me/items?product=${productId}`)).json()) as {
      items: { id: string }[];
    };
    const moved = await page.request.post(`/api/me/items/${found.items[0]?.id}/stage`, {
      data: { stage: "ordered", at: new Date().toISOString() },
    });
    expect(moved.ok()).toBe(true);
    await page.reload();
    const passed = page.getByRole("button", { name: "Passer à « Repéré » (étape passée)", exact: true });
    await expect(passed).toBeVisible();
    await expect(passed).toContainText("✓");
    await expect(page.getByRole("button", { name: "Passer à « Reçu »", exact: true })).toBeVisible();
  });

  test("fiche non gardée, 1440 px : les boutons pour garder sont dans le panneau de droite", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openSheet(page);
    const side = page.getByTestId("product-side");
    await expect(side.getByRole("button", { name: "Favori" })).toBeVisible();
    await expect(side.getByRole("region", { name: "La fiche de la boutique" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Mon article" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("fiche non gardée, 390 px : photos, en-tête, garder, boutique", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSheet(page);
    await expect(page.getByRole("heading", { name: "Garder cet article" })).toBeAttached();
    await expect(page.getByRole("region", { name: "Autres actions" })).toHaveCount(0);
    await verticalOrder(page, [
      "[data-testid=product-gallery]",
      "[data-testid=product-header]",
      "section[aria-labelledby=keep-title]",
      "section[aria-labelledby=shop-title]",
    ]);
  });

  test("1440 px, fenêtre basse : le panneau défile seul jusqu'à « Supprimer », la page ne bouge pas", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 500 });
    await openSheet(page);
    await keep(page);
    const remove = page.getByTestId("product-side").getByRole("button", { name: "Supprimer" });
    await remove.scrollIntoViewIfNeeded();
    const removeBox = await remove.boundingBox();
    expect(removeBox ? removeBox.y + removeBox.height : Number.POSITIVE_INFINITY).toBeLessThanOrEqual(500);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("1440 px : la visionneuse s'ouvre par-dessus le cadre, Échap la ferme, le contenu n'a pas bougé", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await openSheet(page);
    const contentTop = () => page.evaluate(() => document.getElementById("app-content")?.scrollTop ?? -1);
    const opener = page.getByTestId("product-gallery").getByRole("button").first();
    // Playwright scrolls the photo into view before clicking: the position to keep is the one after that.
    await opener.scrollIntoViewIfNeeded();
    const before = await contentTop();
    await opener.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await contentTop()).toBe(before);
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

// Passe design §1: the frame stays, only the content scrolls.
test.describe("cadre fixe", () => {
  test("ordinateur : le menu et l'en-tête restent en place quand le contenu défile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    await openSheet(page);
    const aside = await box(page, "aside");
    const header = await box(page, "header");
    expect(await scrollContentToBottom(page)).toBeGreaterThan(0);
    expect(await windowScroll(page)).toEqual({ y: 0, overflow: 0 });
    expect(await box(page, "aside")).toEqual(aside);
    expect(await box(page, "header")).toEqual(header);
  });

  test("téléphone : les onglets restent en bas et le contenu défile seul", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await openSheet(page);
    const bottom = async () => {
      const bar = await box(page, "[data-testid=app-nav-bottom]");
      return bar.y + bar.height;
    };
    expect(await bottom()).toBeGreaterThan(600 - 2);
    expect(await scrollContentToBottom(page)).toBeGreaterThan(0);
    expect(await bottom()).toBeGreaterThan(600 - 2);
    expect(await windowScroll(page)).toEqual({ y: 0, overflow: 0 });
  });

  test("une nouvelle page commence en haut, et aussi au retour arrière", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await openSheet(page);
    const contentTop = () => page.evaluate(() => document.getElementById("app-content")?.scrollTop ?? -1);
    expect(await scrollContentToBottom(page)).toBeGreaterThan(0);
    await page.getByRole("navigation", { name: "Onglets" }).getByRole("link", { name: "Envies" }).click();
    await expect(page).toHaveURL(/\/envies/);
    await expect.poll(contentTop).toBe(0);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
    await expect.poll(contentTop).toBe(0);
  });
});
