import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { readCode, signInAsAdmin, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// Comptes visibles (docs/specs/2026-11-14-comptes-visibles.md): « Se connecter » always in the band for a guest, a
// banner on Home, and the admin « Utilisatrices » screen.

const BANNER = "Crée ton compte pour garder tes articles sur tous tes appareils";

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

/** Signs in on /connexion with a code read from the test mailbox. */
async function signInOnPage(page: Page, request: Parameters<typeof readCode>[0], email: string) {
  await page.getByLabel("Ton e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await page.getByLabel("Code à 6 chiffres").fill(await readCode(request, email));
  await page.getByRole("button", { name: "Me connecter" }).click();
}

test("une invitée voit « Se connecter » dans la barre, se connecte et revient sur la page avec ses données", async ({
  page,
  request,
}) => {
  // No session at all yet: still a guest.
  await page.goto("/articles");
  const band = page.locator("header");
  const signIn = band.getByRole("link", { name: "Se connecter ou créer un compte" });
  await expect(signIn).toBeVisible();
  await expect(band.getByLabel("Profil")).toHaveCount(0);
  const box = await signIn.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);

  // A guest who kept something: a profile of her own, made before signing in.
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const created = await page.evaluate(async () => {
    const res = await fetch("/api/me/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Léa", audience: "child", color: "sage" }),
    });
    return res.status;
  });
  expect(created).toBe(201);
  await page.reload();
  await expect(signIn).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  await signIn.click();
  await expect(page).toHaveURL(/\/connexion\?next=%2Farticles$/);
  await signInOnPage(page, request, uniqueEmail());
  await page.waitForURL((url) => url.pathname === "/articles");

  // An account: the profile switcher is back, « Se connecter » is gone, and her guest profile followed her.
  await expect(band.getByLabel("Profil")).toBeVisible();
  await expect(signIn).toHaveCount(0);
  await expect(band.getByLabel("Profil").locator("option", { hasText: "Léa" })).toHaveCount(1);
});

test("l’accueil propose un compte à une invitée, et se tait 30 jours une fois fermé", async ({ page, request }) => {
  await page.goto("/");
  const banner = page.getByRole("region", { name: "Créer un compte" });
  await expect(banner).toContainText(BANNER);
  expect(await seriousViolations(page)).toEqual([]);
  await expect(banner.getByRole("link", { name: "Créer mon compte" })).toHaveAttribute("href", "/connexion");

  await banner.getByRole("button", { name: "Fermer" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // 31 days later it comes back.
  await page.evaluate(() =>
    localStorage.setItem(
      "closyria.homeAccountBanner.dismissedAt",
      new Date(Date.now() - 31 * 86_400_000).toISOString(),
    ),
  );
  await page.reload();
  await expect(banner).toBeVisible();

  // Never for an account.
  await banner.getByRole("link", { name: "Créer mon compte" }).click();
  await signInOnPage(page, request, uniqueEmail());
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator("header").getByLabel("Profil")).toBeVisible();
  await expect(banner).toHaveCount(0);
});

test("l’admin retrouve une utilisatrice, voit ses nombres sans son contenu, puis supprime son compte", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  // A person with a profile, a list and a guest beside her.
  const id = `e2e-${randomUUID()}`;
  const email = `${id}@example.com`;
  const guestId = `e2e-guest-${randomUUID()}`;
  await db.query(
    `insert into "user" (id, name, email, email_verified, is_anonymous, created_at, updated_at)
     values ($1, $1, $2, true, false, now(), now()), ($3, $3, $4, false, true, now(), now())`,
    [id, email, guestId, `${guestId}@anon.example.com`],
  );
  await db.query(`insert into profiles (user_id, name, audience, color) values ($1, 'Moi', 'women', 'plum')`, [id]);
  await db.query(`insert into wishlists (user_id, name) values ($1, 'Liste secrète')`, [id]);

  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto("/admin");
  await page
    .getByRole("navigation", { name: "Navigation de l’administration" })
    .getByRole("link", { name: "Utilisatrices" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Utilisatrices" })).toBeVisible();

  // « Sans compte »: the guest is there, without her generated address.
  await page.getByLabel("Type").selectOption({ label: "Sans compte" });
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page).toHaveURL(/kind=guests/);
  await expect(page.locator(`a[href="/admin/utilisatrices/${guestId}"]`)).toHaveText("Sans compte");

  await page.getByLabel("Rechercher par e-mail").fill(id);
  await page.getByLabel("Type").selectOption({ label: "Tous" });
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page.getByRole("row")).toHaveCount(2);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("link", { name: email }).click();
  await expect(page.getByRole("heading", { level: 1, name: email })).toBeVisible();
  await expect(page.getByText("Code par e-mail")).toBeVisible();
  // Counts only: her list is counted, never named.
  await expect(page.getByText("Liste secrète")).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);

  await page.getByRole("button", { name: "Supprimer ce compte" }).click();
  const confirm = page.getByRole("button", { name: "Supprimer définitivement" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Pour confirmer, tape son e-mail : ${email}`).fill(email);
  await confirm.click();
  await page.waitForURL((url) => url.pathname === "/admin/utilisatrices");

  const { rowCount } = await db.query(`select 1 from "user" where id = $1`, [id]);
  expect(rowCount).toBe(0);
  const lists = await db.query(`select 1 from wishlists where user_id = $1`, [id]);
  expect(lists.rowCount).toBe(0);
  const audit = await db.query(`select action from admin_audit_log where target = $1`, [`user:${id}`]);
  expect(audit.rows).toEqual([{ action: "user.delete" }]);
  await db.query(`delete from "user" where id = $1`, [guestId]);
});
