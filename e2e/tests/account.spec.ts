import AxeBuilder from "@axe-core/playwright";
import { signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// « Mon compte »: she always sees who is signed in, and can sign out (docs/specs/2026-11-07-mon-compte.md).

test.describe("sur ordinateur", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("sans compte : le menu le dit, la page propose de créer un compte, pas de déconnexion", async ({ page }) => {
    await page.goto("/");
    const menu = page.getByRole("navigation", { name: "Menu principal" });
    const link = menu.getByRole("link", { name: /Mon compte/ });
    await expect(link).toContainText("Sans compte");
    await link.click();
    await expect(page).toHaveURL(/\/reglages\/compte$/);
    await expect(page.getByRole("heading", { level: 2, name: "Mon compte" })).toBeVisible();
    await expect(page.getByText("Tu utilises Closyria sans compte.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Créer mon compte" })).toHaveAttribute(
      "href",
      "/connexion?next=%2Freglages%2Fcompte",
    );
    await expect(page.getByRole("button", { name: "Se déconnecter" })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("avec un compte : l'e-mail est affiché, « Se déconnecter » ramène à la connexion", async ({ page, request }) => {
    const email = uniqueEmail();
    await page.goto("/");
    await signInWithEmailCode(page, request, email);
    await page.goto("/reglages/compte");
    await expect(
      page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: /Mon compte/ }),
    ).toContainText(email);
    await expect(page.getByRole("main").getByText(email)).toBeVisible();
    await expect(page.getByText(/^Compte créé le \d{1,2} \S+ \d{4}$/)).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Se déconnecter" }).click();
    await expect(page).toHaveURL(/\/connexion$/);
    // Back in the app: a new visitor, without an account.
    await page.goto("/reglages/compte");
    await expect(page.getByText("Tu utilises Closyria sans compte.")).toBeVisible();
    await expect(page.getByText(email)).toHaveCount(0);
  });
});

test.describe("sur téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("le compte est dans « Plus »", async ({ page, request }) => {
    const email = uniqueEmail();
    await page.goto("/");
    await signInWithEmailCode(page, request, email);
    await page.goto("/envies");
    await page.getByRole("button", { name: "Plus" }).click();
    const link = page.getByRole("list", { name: "Autres pages" }).getByRole("link", { name: /Mon compte/ });
    await expect(link).toContainText(email);
    await link.click();
    await expect(page).toHaveURL(/\/reglages\/compte$/);
  });
});
