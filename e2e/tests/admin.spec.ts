import { signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// Spec §8, ruling R15, comptes visibles 2026-11-14: a visitor not signed in to an account is sent to the sign-in page
// (back to the admin address afterwards); for a signed-in account without the admin role the area does not exist (404).

test("/admin sans session renvoie à la connexion, avec retour à l’adresse demandée", async ({ page }) => {
  await page.goto("/admin/utilisatrices?kind=guests");
  await expect(page).toHaveURL(/\/connexion\?next=%2Fadmin%2Futilisatrices%3Fkind%3Dguests$/);
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  await expect(page).not.toHaveTitle(/admin/i);
});

test("/admin renvoie aussi une visiteuse anonyme à la connexion", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/connexion\?next=%2Fadmin$/);
});

test("/admin n'existe pas pour une utilisatrice connectée", async ({ page, request }) => {
  await page.goto("/");
  await signInWithEmailCode(page, request, uniqueEmail());
  for (const path of ["/admin", "/admin/audit", "/admin/utilisatrices", "/admin/passkey-required"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page).not.toHaveTitle(/admin/i);
  }
});
