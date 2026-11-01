import { signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// Spec §8, ruling R15: without the admin role the admin area does not exist (404, nothing revealed).

test("/admin n'existe pas sans session", async ({ page }) => {
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("/admin n'existe pas pour une visiteuse anonyme", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("/admin n'existe pas pour une utilisatrice connectée", async ({ page, request }) => {
  await page.goto("/");
  await signInWithEmailCode(page, request, uniqueEmail());
  for (const path of ["/admin", "/admin/audit", "/admin/passkey-required"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page).not.toHaveTitle(/admin/i);
  }
});
