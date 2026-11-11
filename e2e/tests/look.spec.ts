import type { Page } from "@playwright/test";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte « Cocon lumineux », task 3: frosted glass and flat buttons (the aurora went with Boudoir).

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
  test("les cartes sont toutes visibles d'un coup, sans cascade", async ({ page }) => {
    await oneWish(page);
    const seen = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid=item-card]")].map((card) => {
        const style = getComputedStyle(card);
        return { opacity: style.opacity, duration: style.animationDuration, delay: style.animationDelay };
      }),
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const card of seen) expect(card).toEqual({ opacity: "1", duration: "0s", delay: "0s" });
  });
});

test("sans mouvement réduit, les cartes arrivent en cascade et finissent visibles", async ({ page }) => {
  await oneWish(page);
  const name = await page
    .getByTestId("item-card")
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(name).toBe("card-rise");
  await expect(page.getByTestId("item-card").first()).toHaveCSS("opacity", "1");
});

// Boudoir: the « Cocon » aurora is gone, the page is the plain surface colour.
test("le fond de la page est uni, sans aurore", async ({ page }) => {
  await page.goto("/envies");
  const seen = await page.evaluate(() => ({
    before: getComputedStyle(document.body, "::before").backgroundImage,
    body: getComputedStyle(document.body).backgroundColor,
  }));
  expect(seen.before).toBe("none");
  expect(seen.body).toBe("rgb(251, 247, 244)");
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

test("« Je le prends » : le bandeau est là aussitôt, une petite photo y vole puis disparaît", async ({ page }) => {
  await oneWish(page);
  await page.getByTestId("item-card").first().hover();
  await page.getByTestId("card-take").first().click();
  await expect(page.getByTestId("order-band")).toBeVisible();
  // Right after the take: the photo shape flies and nothing else moves (one effect per moment).
  const right = await page.evaluate(() => ({
    arches: document.querySelectorAll(".fly-photo").length,
    // Shape C, like the thumbnails: round top, small bottom corners.
    shape: [...document.querySelectorAll(".fly-photo")].map((el) => {
      const style = getComputedStyle(el);
      return [style.borderTopLeftRadius, style.borderBottomLeftRadius];
    }),
    running: document
      .getAnimations()
      .map((a) => (a as CSSAnimation).animationName)
      .filter((n) => n === "count-roll" || n === "chip-check-draw"),
  }));
  expect(right).toEqual({ arches: 1, shape: [["20px", "8px"]], running: [] });
  await expect(page.locator(".fly-photo")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("card-take").first()).toHaveAttribute("aria-pressed", "true");
});

test.describe("mouvement réduit, prendre un article", () => {
  test.use({ reducedMotion: "reduce" });
  test("aucune petite photo n'est créée", async ({ page }) => {
    await oneWish(page);
    await page.evaluate(() => {
      (window as unknown as { __arches: number }).__arches = 0;
      new MutationObserver((records) => {
        for (const r of records)
          for (const n of r.addedNodes)
            if (n instanceof HTMLElement && n.classList.contains("fly-photo"))
              (window as unknown as { __arches: number }).__arches++;
      }).observe(document.body, { childList: true });
    });
    await page.getByTestId("item-card").first().hover();
    await page.getByTestId("card-take").first().click();
    await expect(page.getByTestId("order-band")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __arches: number }).__arches)).toBe(0);
  });
});
