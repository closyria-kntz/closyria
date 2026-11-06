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
    await page.getByRole("button", { name: "Ajouter une photo" }).click();
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

// Chantier 2a, task 7: the « Ajouter une photo » window.

const addButton = (page: Page) => page.getByRole("button", { name: "Ajouter une photo" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Ajouter une photo" });

async function keepItem(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
}

/** Pastes (or drops) something on the window's zone, as the browser would. */
async function transfer(
  page: Page,
  type: "paste" | "drop",
  data: { text?: string; file?: { name: string; mime: string; base64: string } },
): Promise<void> {
  await dialog(page)
    .getByTestId("photo-drop-zone")
    .evaluate(
      (el, { type, data }) => {
        const dt = new DataTransfer();
        if (data.text) dt.setData("text/plain", data.text);
        if (data.file) {
          const bytes = Uint8Array.from(atob(data.file.base64), (c) => c.charCodeAt(0));
          dt.items.add(new File([bytes], data.file.name, { type: data.file.mime }));
        }
        const event =
          type === "paste"
            ? new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
            : new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(event);
      },
      { type, data },
    );
}

const PIXEL_FILE = {
  name: "p.png",
  mime: "image/png",
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
};

test("coller une image ajoute la photo et ferme la fenêtre", async ({ page }) => {
  await keepItem(page);
  await addButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await transfer(page, "paste", { file: PIXEL_FILE });
  await expect(dialog(page)).toBeHidden();
  await expect(mine(page).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Notifications" })).toContainText("Photo ajoutée");
});

test("coller tout de suite après l'ouverture, le focus étant sur « Fermer », ajoute la photo", async ({ page }) => {
  await keepItem(page);
  await addButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.evaluate((file) => {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: file.mime }));
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PIXEL_FILE);
  await expect(dialog(page)).toBeHidden();
  await expect(mine(page).getByRole("listitem")).toHaveCount(1);
});

test("déposer un fichier ajoute la photo", async ({ page }) => {
  await keepItem(page);
  await addButton(page).click();
  await transfer(page, "drop", { file: PIXEL_FILE });
  await expect(dialog(page)).toBeHidden();
  await expect(mine(page).getByRole("listitem")).toHaveCount(1);
});

test("un texte qui n'est pas une adresse donne un message, sans rien ajouter", async ({ page }) => {
  await keepItem(page);
  await addButton(page).click();
  await transfer(page, "paste", { text: "bonjour" });
  await expect(dialog(page).getByRole("alert")).toHaveText("Colle une image ou un lien vers une image.");
  await dialog(page).getByLabel("Lien vers une image").fill("pas une adresse");
  await dialog(page).getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText("Colle une image ou un lien vers une image.");
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
});

test("« Prendre une photo » n'existe que sur écran tactile", async ({ page }, testInfo) => {
  await keepItem(page);
  await addButton(page).click();
  const camera = dialog(page).getByRole("button", { name: "Prendre une photo" });
  if (testInfo.project.name === "Desktop Chrome") await expect(camera).toHaveCount(0);
  else {
    await expect(camera).toBeVisible();
    await expect(dialog(page).getByTestId("photo-camera")).toHaveAttribute("capture", "environment");
  }
});

test("une adresse collée lance l'import par lien, puis la photo apparaît", async ({ page }) => {
  await keepItem(page);
  await addButton(page).click();
  await transfer(page, "paste", { file: PIXEL_FILE });
  await expect(mine(page).getByRole("listitem")).toHaveCount(1);

  // The worker refuses local addresses by design, so the two import routes are stubbed; the real fetch path is
  // covered by the worker's own tests. `attached` carries the page's current item plus one more photo.
  const { items } = (await (await page.request.get("/api/me/items")).json()) as {
    items: { photos: { id: string; url: string; width: number; height: number; source: string }[] }[];
  };
  const current = items[0];
  if (!current) throw new Error("no item");
  const first = current.photos[0];
  if (!first) throw new Error("no photo");
  const importId = "00000000-0000-4000-8000-0000000000aa";
  const attached = {
    status: "attached",
    item: { ...current, photos: [...current.photos, { ...first, id: "00000000-0000-4000-8000-0000000000bb" }] },
  };
  let polls = 0;
  await page.route("**/api/me/items/*/media/imports", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ importId }) }),
  );
  await page.route(`**/api/me/items/*/media/imports/${importId}`, (route) => {
    polls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(polls === 1 ? { status: "queued" } : attached),
    });
  });

  await addButton(page).click();
  await transfer(page, "paste", { text: "  https://photos.test/robe.jpg " });
  await expect(dialog(page).getByRole("status")).toHaveText("Ajout…");
  await expect(dialog(page)).toBeHidden();
  await expect(mine(page).getByRole("listitem")).toHaveCount(2);
  expect(polls).toBeGreaterThanOrEqual(2);
});

test("un import refusé affiche son message", async ({ page }) => {
  await keepItem(page);
  const importId = "00000000-0000-4000-8000-0000000000aa";
  await page.route("**/api/me/items/*/media/imports", (route) =>
    route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ importId }) }),
  );
  await page.route(`**/api/me/items/*/media/imports/${importId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "failed", error: "blocked" }),
    }),
  );
  await addButton(page).click();
  await dialog(page).getByLabel("Lien vers une image").fill("https://photos.test/robe.jpg");
  await dialog(page).getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toHaveText(
    "Ce site ne laisse pas récupérer l’image. Enregistre-la puis ajoute le fichier.",
  );
});

test("à 10 photos, le bouton « Ajouter une photo » disparaît", async ({ page }) => {
  await keepWithPhotos(page, 10);
  await expect(addButton(page)).toHaveCount(0);
});
