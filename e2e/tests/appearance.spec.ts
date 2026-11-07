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
  await expect(html).toHaveAttribute("data-theme", "equilibre-light");
  // Applied before the first paint on the next visits, on every page.
  await page.goto("/envies");
  await expect(html).toHaveAttribute("data-theme", "equilibre-light");

  await page.goto("/reglages/apparence");
  await expect(page.getByRole("radio", { name: /Clair/ })).toBeChecked();
  await page.getByRole("radio", { name: /Sombre/ }).check();
  await expect(html).toHaveAttribute("data-theme", "equilibre-dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "equilibre-dark");
  await expect(page.getByRole("radio", { name: /Sombre/ })).toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("radio", { name: /Automatique/ }).check();
  await expect(html).not.toHaveAttribute("data-theme");
  await page.reload();
  await expect(html).not.toHaveAttribute("data-theme");
});
