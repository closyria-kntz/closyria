import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../fixtures/test";

// Réglages → Apparence: Automatique (the device's choice), Clair or Sombre, kept on this device.

test("Apparence : Sombre puis Clair restent après un rechargement, Automatique suit l'appareil", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/reglages/apparence");
  const html = page.locator("html");
  await expect(page.getByRole("heading", { level: 2, name: "Apparence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Apparence" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("radio", { name: /Automatique/ })).toBeChecked();
  await expect(html).not.toHaveAttribute("data-theme");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("radio", { name: /Clair/ }).check();
  await expect(html).toHaveAttribute("data-theme", "boudoir-light");
  // Applied before the first paint on the next visits, on every page.
  await page.goto("/envies");
  await expect(html).toHaveAttribute("data-theme", "boudoir-light");

  await page.goto("/reglages/apparence");
  await expect(page.getByRole("radio", { name: /Clair/ })).toBeChecked();
  await page.getByRole("radio", { name: /Sombre/ }).check();
  await expect(html).toHaveAttribute("data-theme", "boudoir-dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "boudoir-dark");
  await expect(page.getByRole("radio", { name: /Sombre/ })).toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("radio", { name: /Automatique/ }).check();
  await expect(html).not.toHaveAttribute("data-theme");
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
});

test("« Compte » a le même choix d'apparence, gardé après un rechargement", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/compte");
  const html = page.locator("html");
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: /Sombre/ }).check();
  await expect(html).toHaveAttribute("data-theme", "boudoir-dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "boudoir-dark");
  await expect(main.getByRole("radio", { name: /Sombre/ })).toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Same storage as Réglages → Apparence.
  await page.goto("/reglages/apparence");
  await expect(page.getByRole("radio", { name: /Sombre/ })).toBeChecked();
  await page.getByRole("radio", { name: /Clair/ }).check();
  await page.goto("/compte");
  await expect(main.getByRole("radio", { name: /Clair/ })).toBeChecked();
  await expect(html).toHaveAttribute("data-theme", "boudoir-light");
});
