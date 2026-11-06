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
      "Envies",
      "Commandé",
      "Dressing",
      "À vendre",
      "Listes",
      "Réglages",
    ]);
    // The product sheet is not one of the six places: no entry claims to be the current page.
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
    await expect(bar.getByRole("link")).toHaveText(["Envies", "Commandé", "Dressing"]);
    await expect(bar.getByRole("button", { name: "Plus" })).toBeVisible();
    await expect(bar.locator("[aria-current=page]")).toHaveCount(0);
    const barBox = await box(page, "[data-testid=app-nav-bottom]");
    expect(barBox.y + barBox.height).toBeGreaterThan(844 - 2);
    for (const target of await bar.locator("a, button").all()) {
      expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

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
    await expect(tabs.getByRole("link")).toHaveCount(6);
    expect((await box(page, "[data-testid=app-nav-top]")).y).toBeLessThan(6 * REM);
    await expect(page.getByTestId("app-nav-bottom")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeHidden();
  });
});
