import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Navigation (docs/plans/2026-11-12-navigation-compte.md): « Moi » becomes « Compte » (/compte, /moi leads there),
// with no article on it; every place the old « Moi » listed stays reachable from « Compte » or « Mes articles »; the
// band's switcher says the chosen profile's first name, and the band's avatar is gone.

const menu = (page: Page) => page.getByRole("navigation", { name: "Menu principal" });
const main = (page: Page) => page.getByRole("main");

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

async function pasteAndWish(page: Page) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
}

test("/moi mène à « Compte » en gardant l'adresse", async ({ page }) => {
  await page.goto("/moi?profil=00000000-0000-4000-8000-000000000001#apparence");
  await expect(page).toHaveURL(/\/compte\?profil=00000000-0000-4000-8000-000000000001#apparence$/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Compte" })).toBeVisible();
});

test("« Compte » : profil, profils, apparence, réglages, aide — et aucun article", async ({ page }) => {
  await page.goto("/");
  await menu(page).getByRole("link", { name: "Compte" }).click();
  await expect(page).toHaveURL(/\/compte$/);
  await expect(menu(page).getByRole("link", { name: "Compte" })).toHaveAttribute("aria-current", "page");
  await expect(main(page).getByRole("heading", { level: 1, name: "Compte" })).toBeVisible();
  await expect(main(page).getByRole("heading", { level: 2 })).toHaveText([
    "Mon profil",
    "Profils de la famille",
    "Apparence",
    "Réglages",
    "Aide",
  ]);

  const rows: [string | RegExp, RegExp][] = [
    [/^Prénom, e-mail et connexion/, /\/reglages\/compte$/],
    [/^Gérer les profils/, /\/reglages\/profils$/],
    ["Mes niveaux", /\/reglages\/niveaux$/],
    ["Étiquettes", /\/reglages\/etiquettes$/],
    ["Corbeille", /\/reglages\/corbeille$/],
    [/^Ajouter depuis ton téléphone/, /\/aide\/telephone$/],
  ];
  for (const [name, href] of rows) {
    const link = main(page).getByRole("link", { name, exact: typeof name === "string" });
    await expect(link).toHaveAttribute("href", href);
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // Who is signed in, said on « Mon profil ».
  await expect(main(page).getByRole("link", { name: /^Prénom, e-mail et connexion/ })).toContainText("Sans compte");

  // Clair / sombre / comme l'appareil, right here.
  await expect(main(page).getByRole("radio", { name: /Automatique/ })).toBeChecked();
  await main(page)
    .getByRole("radio", { name: /Sombre/ })
    .check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "boudoir-dark");
  await main(page)
    .getByRole("radio", { name: /Automatique/ })
    .check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");

  // No article here any more: no tiles, no « Mon dressing », no « Toutes mes pages ».
  await expect(main(page).getByRole("region", { name: "En un coup d’œil" })).toHaveCount(0);
  await expect(main(page).getByRole("region", { name: "Mon dressing" })).toHaveCount(0);
  await expect(main(page).getByRole("navigation", { name: "Mes pages" })).toHaveCount(0);
  await expect(main(page).getByRole("link", { name: "Mes envies" })).toHaveCount(0);
  await axeLightAndDark(page);
});

test("chaque page de l'ancien « Moi » reste atteignable, depuis « Mes articles » ou « Compte »", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/articles");
  const steps = main(page).getByRole("navigation", { name: "Étapes" });
  const sections = main(page).getByRole("navigation", { name: "Rubriques de Mes articles" });
  const fromArticles: [ReturnType<Page["getByRole"]>, RegExp][] = [
    [steps.getByRole("link", { name: /^Envies/ }), /\/articles\?etape=envie$/],
    [steps.getByRole("link", { name: /^Commandés/ }), /\/articles\?etape=commande$/],
    [steps.getByRole("link", { name: /^Dans mon dressing/ }), /\/articles\?etape=dressing$/],
    [steps.getByRole("link", { name: /^À vendre/ }), /\/articles\?etape=a-vendre$/],
    [sections.getByRole("link", { name: /^Listes/ }), /\/listes$/],
  ];
  for (const [link, href] of fromArticles) await expect(link).toHaveAttribute("href", href);
  // The budget sits at the top of the wishes, as before.
  await steps.getByRole("link", { name: /^Envies/ }).click();
  await expect(page).toHaveURL(/\/articles\?etape=envie$/);
  await expect(main(page).getByRole("button", { name: "Ajouter un budget" })).toBeVisible();

  await menu(page).getByRole("link", { name: "Compte" }).click();
  await main(page).getByRole("link", { name: "Mes niveaux" }).click();
  await expect(page).toHaveURL(/\/reglages\/niveaux$/);
  await expect(menu(page).getByRole("link", { name: "Compte" })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await main(page)
    .getByRole("link", { name: /^Prénom, e-mail et connexion/ })
    .click();
  await expect(page).toHaveURL(/\/reglages\/compte$/);
  await expect(main(page).getByRole("heading", { level: 2, name: "Mon compte" })).toBeVisible();
  await page.goBack();
  await main(page)
    .getByRole("link", { name: /^Ajouter depuis ton téléphone/ })
    .click();
  await expect(page).toHaveURL(/\/aide\/telephone$/);
  await expect(page.getByRole("link", { name: "← Compte" })).toHaveAttribute("href", "/compte");
});

test("le bandeau dit le prénom du profil choisi, sans avatar en double", async ({ page, db, userAgentTag }) => {
  await pasteAndWish(page);
  await page.goto("/articles");
  const switcher = page.getByLabel("Profil", { exact: true }).filter({ visible: true });
  const shown = () => switcher.evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text ?? "");
  // A guest has no first name: « Moi ».
  await expect.poll(shown).toBe("Moi");

  const [session] = await sessionsOf(db, userAgentTag);
  await db.query(`update "user" set name = 'Camille Durand', is_anonymous = false where id = $1`, [session?.userId]);
  await page.goto("/articles");
  await expect.poll(shown).toBe("Camille");
  // The band has no « Mon compte » avatar any more: « Compte » is in the menu.
  await expect(page.getByRole("banner").getByRole("link", { name: /^Mon compte/ })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: /^Compte/ })).toHaveCount(
    (page.viewportSize()?.width ?? 0) >= 768 ? 1 : 0,
  );

  // Another profile: its own name.
  const created = await page.request.post("/api/me/profiles", {
    data: { name: "Léa", audience: "women", color: "sage" },
  });
  expect(created.ok()).toBe(true);
  await page.reload();
  await switcher.selectOption({ label: "Léa" });
  await expect(page).toHaveURL(/profil=/);
  await expect.poll(shown).toBe("Léa");
  await switcher.selectOption({ label: "Camille" });
  await expect(page).not.toHaveURL(/profil=/);
});
