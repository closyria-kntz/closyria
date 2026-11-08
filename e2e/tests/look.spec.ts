import type { Page } from "@playwright/test";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte « Cocon lumineux », task 3: frosted glass, aurora behind the page, flat buttons.

async function oneWish(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card").first()).toBeVisible();
}

test("aucun bouton visible de /envies n'a d'ombre", async ({ page }) => {
  await oneWish(page);
  const shadows = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== "hidden")
      .map((b) => ({
        name: b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "",
        shadow: getComputedStyle(b).boxShadow,
      }))
      .filter((b) => b.shadow !== "none"),
  );
  expect(shadows).toEqual([]);
  // The pills and the « … » trigger sit in cards: they are spans/buttons, none carries a shadow either.
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll("[data-testid=item-card] *")]
      .filter((e) => /rounded-full/.test(e.getAttribute("class") ?? ""))
      .filter((e) => getComputedStyle(e).boxShadow !== "none")
      .map((e) => e.getAttribute("class")),
  );
  expect(chips).toEqual([]);
});

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });
  test("l'aurore ne bouge plus", async ({ page }) => {
    await page.goto("/envies");
    const name = await page.evaluate(() => getComputedStyle(document.body, "::before").animationName);
    expect(name).toBe("none");
  });
});

test("l'aurore bouge sinon, derrière le contenu", async ({ page }) => {
  await page.goto("/envies");
  const style = await page.evaluate(() => {
    const s = getComputedStyle(document.body, "::before");
    return { name: s.animationName, position: s.position, events: s.pointerEvents, image: s.backgroundImage };
  });
  expect(style.name).toBe("aurora-drift");
  expect(style.position).toBe("fixed");
  expect(style.events).toBe("none");
  expect(style.image.match(/radial-gradient/g)).toHaveLength(3);
});

test("sans backdrop-filter, la barre du haut est opaque", async ({ page }) => {
  await page.goto("/envies");
  const glass = page.locator(".glass").first();
  await expect(glass).toBeVisible();
  const alpha = async () =>
    glass.evaluate((el) => {
      const c = document.createElement("canvas").getContext("2d");
      if (!c) throw new Error("no canvas");
      c.clearRect(0, 0, 1, 1);
      c.fillStyle = getComputedStyle(el).backgroundColor;
      c.fillRect(0, 0, 1, 1);
      return c.getImageData(0, 0, 1, 1).data[3];
    });
  expect(await alpha()).toBeLessThan(255);
  await page.evaluate(() => document.documentElement.classList.add("no-backdrop"));
  expect(await alpha()).toBe(255);
  expect(await glass.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe("none");
});
