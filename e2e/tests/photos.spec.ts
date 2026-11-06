import { deflateSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 5: the photo viewer (full-screen dialog) on the kept item's photos.

/** A solid grey PNG, big enough to overflow any of the three screens at its natural size. */
function bigPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width + 1)] = 0; // filter: none
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function keepWithPhotos(page: Page, count: number): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  const png = bigPng(3000, 2000);
  for (let n = 1; n <= count; n++) {
    await page.getByTestId("photo-input").setInputFiles({ name: `p${n}.png`, mimeType: "image/png", buffer: png });
    await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("listitem")).toHaveCount(n);
  }
}

const mine = (page: Page) => page.getByRole("list", { name: "Mes photos" });

test("la visionneuse s'ouvre sur la photo cliquée, navigue, zoome et rend le focus", async ({ page }, testInfo) => {
  await keepWithPhotos(page, 3);
  const opener = mine(page).getByRole("button", { name: "Agrandir la photo 2" });
  await opener.click();

  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("2 / 3")).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);

  await viewer.getByRole("button", { name: "Photo suivante" }).click();
  await expect(viewer.getByText("3 / 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("2 / 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("1 / 3")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("2 / 3")).toBeVisible();

  if (testInfo.project.name === "iPhone 15") {
    // The swipe is the native scroll-snap of the track: scroll it by one screen, as a finger would.
    await viewer.getByTestId("viewer-track").evaluate((el) => el.scrollBy({ left: el.clientWidth }));
    await expect(viewer.getByText("3 / 3")).toBeVisible();
    await viewer.getByTestId("viewer-track").evaluate((el) => el.scrollBy({ left: -el.clientWidth }));
    await expect(viewer.getByText("2 / 3")).toBeVisible();
  }

  const track = viewer.getByTestId("viewer-track");
  const photo = viewer.getByRole("img").nth(1);
  await expect(viewer).toHaveAttribute("data-zoom", "fit");
  await photo.click();
  await expect(viewer).toHaveAttribute("data-zoom", "actual");
  const slide = viewer.getByTestId("viewer-slide").nth(1);
  await expect.poll(() => slide.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await track.getByRole("img").nth(1).click();
  await expect(viewer).toHaveAttribute("data-zoom", "fit");

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(opener).toBeFocused();
});

test("avec une seule photo, ni flèches ni compteur", async ({ page }) => {
  await keepWithPhotos(page, 1);
  await mine(page).getByRole("button", { name: "Agrandir la photo 1" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Photo suivante" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Photo précédente" })).toHaveCount(0);
  await expect(viewer.getByText(/\d \/ \d/)).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Fermer" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
});

test("la fiche d'un article pas encore gardé ouvre aussi les photos de la boutique", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  const opener = page.getByRole("button", { name: "Agrandir la photo 1" });
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});
