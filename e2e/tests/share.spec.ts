import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { AUTO_SHOP, autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 9: one « Partager » window for the product, a shared list and a group order's message
// (copy, WhatsApp, SMS, e-mail, Messenger on a touch screen, « Autres applis… » with a share menu); « Coller le lien
// copié » in « + Ajouter » on a touch screen; `/partager` takes an unencoded link; the iPhone help.

const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
};
const setTheme = (page: Page, theme: "light" | "dark") =>
  page.evaluate((id) => {
    document.documentElement.dataset.theme = id;
  }, theme);
async function axeLightAndDark(page: Page): Promise<void> {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await axe(page);
  }
}

/** A finger rather than a mouse: the phone and tablet profiles. */
const touchOf = (testInfo: TestInfo) => Boolean(testInfo.project.use.hasTouch);
/** Apple's phone and tablet profiles (their user agent). */
const appleOf = (testInfo: TestInfo) => /iPhone|iPad/.test(testInfo.project.use.userAgent ?? "");

/** The browser's share menu: absent, or recorded in `window.shareCalls` (and refused with `window.shareOutcome`). */
async function shareMenu(page: Page, present: boolean): Promise<void> {
  await page.addInitScript((has) => {
    const calls: unknown[] = [];
    (window as unknown as { shareCalls: unknown[] }).shareCalls = calls;
    Object.defineProperty(Navigator.prototype, "share", {
      configurable: true,
      value: has
        ? (data: unknown) => {
            const outcome = (window as unknown as { shareOutcome?: string }).shareOutcome;
            if (outcome) return Promise.reject(new DOMException("no", outcome));
            calls.push(data);
            return Promise.resolve();
          }
        : undefined,
    });
  }, present);
}

const sheetOf = (page: Page) => page.getByRole("dialog", { name: "Partager" });
const choicesOf = (sheet: Locator) => sheet.getByRole("list", { name: "Partager avec" }).getByRole("listitem");

/** The choices in order: Messenger on a touch screen, « Autres applis… » with a share menu. */
const expectedChoices = (first: string, touch: boolean, more: boolean) => [
  first,
  "WhatsApp",
  "SMS",
  "E-mail",
  ...(touch ? ["Messenger"] : []),
  ...(more ? ["Autres applis…"] : []),
];

/** The app links carry the text then the link, encoded (Messenger: the link only). */
async function expectAppLinks(sheet: Locator, message: string, url: string, subject: string): Promise<void> {
  const body = encodeURIComponent(message);
  await expect(sheet.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", `https://wa.me/?text=${body}`);
  await expect(sheet.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("target", "_blank");
  await expect(sheet.getByRole("link", { name: "SMS" })).toHaveAttribute("href", `sms:?&body=${body}`);
  await expect(sheet.getByRole("link", { name: "E-mail" })).toHaveAttribute(
    "href",
    `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`,
  );
  const messenger = sheet.getByRole("link", { name: "Messenger" });
  if ((await messenger.count()) > 0) {
    await expect(messenger).toHaveAttribute("href", `fb-messenger://share/?link=${encodeURIComponent(url)}`);
  }
}

/** « Copier … » copies `value` and says « Copié ✓ »; refused, the text shows, selected, to copy by hand. */
async function expectCopy(page: Page, sheet: Locator, label: string, value: string): Promise<void> {
  const copy = sheet.getByRole("button", { name: new RegExp(`^${label}|^Copié ✓`) });
  await copy.click();
  await expect(copy).toHaveText("Copié ✓");
  await expect(sheet.getByRole("status")).toHaveText("Copié ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  await expect(copy).toHaveText(label, { timeout: 5_000 });
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("refused"));
  });
  await copy.click();
  const fallback = sheet.getByRole("textbox", { name: "Copie impossible ici : copie-le à la main." });
  await expect(fallback).toHaveValue(value);
  await expect(fallback).toBeFocused();
}

/** Pastes a fresh address of the fake shop's product and waits for its sheet; returns that address. */
async function openProduct(page: Page): Promise<string> {
  const url = autoProductUrl();
  await page.goto("/");
  await page.getByRole("main").getByLabel("Coller un lien").fill(url);
  await page.getByRole("main").getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  return url;
}

test("fiche : « Partager » ouvre la fenêtre, ses choix dans l'ordre, la copie et les liens des applis", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  await shareMenu(page, false);
  await openProduct(page);
  const shopUrl = await page.getByRole("link", { name: `Voir chez ${AUTO_SHOP.name}` }).getAttribute("href");
  if (!shopUrl) throw new Error("no shop link");
  await page.getByTestId("product-actions").getByRole("button", { name: "Partager" }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText(PRODUCT.name)).toBeVisible();
  // No share menu here: no « Autres applis… »; Messenger on a touch screen only.
  await expect(choicesOf(sheet)).toHaveText(expectedChoices("Copier le lien", touchOf(testInfo), false));
  await expect(sheet.getByRole("link", { name: "Messenger" })).toHaveCount(touchOf(testInfo) ? 1 : 0);
  const text = `${PRODUCT.name} chez ${AUTO_SHOP.name}`;
  await expectAppLinks(sheet, `${text} ${shopUrl}`, shopUrl, text);
  for (const choice of await choicesOf(sheet).locator("a, button").all()) {
    expect((await choice.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await axeLightAndDark(page);
  await setTheme(page, "light");
  await expectCopy(page, sheet, "Copier le lien", shopUrl);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("« Autres applis… » n'apparaît qu'avec un menu de partage, et lui passe le texte et le lien", async ({ page }) => {
  await shareMenu(page, true);
  await openProduct(page);
  const shopUrl = await page.getByRole("link", { name: `Voir chez ${AUTO_SHOP.name}` }).getAttribute("href");
  await page.getByTestId("product-actions").getByRole("button", { name: "Partager" }).click();
  const sheet = sheetOf(page);
  await expect(choicesOf(sheet).last()).toHaveText("Autres applis…");
  // Closed without sending: nothing said, the window stays.
  await page.evaluate(() => {
    (window as unknown as { shareOutcome?: string }).shareOutcome = "AbortError";
  });
  await sheet.getByRole("button", { name: "Autres applis…" }).click();
  await expect(sheet.getByRole("textbox")).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await page.evaluate(() => {
    delete (window as unknown as { shareOutcome?: string }).shareOutcome;
  });
  await sheet.getByRole("button", { name: "Autres applis…" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shareCalls: unknown[] }).shareCalls))
    .toEqual([{ title: PRODUCT.name, text: `${PRODUCT.name} chez ${AUTO_SHOP.name}`, url: shopUrl }]);
  await expect(sheet).toBeHidden();
});

test("liste partagée : « Partager » ouvre la même fenêtre avec le lien de la liste", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  await shareMenu(page, true);
  await openProduct(page);
  await keepWish(page);
  const created = await page.request.post("/api/me/wishlists", { data: { name: "Noël & co" } });
  expect(created.status()).toBe(201);
  const listId = ((await created.json()) as { id: string }).id;
  await page.goto(`/listes/${listId}`);
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  const shareUrl = await field.inputValue();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const sheet = sheetOf(page);
  await expect(choicesOf(sheet)).toHaveText(expectedChoices("Copier le lien", touchOf(testInfo), true));
  await expectAppLinks(sheet, `Noël & co ${shareUrl}`, shareUrl, "Noël & co");
  await axeLightAndDark(page);
  await setTheme(page, "light");
  await expectCopy(page, sheet, "Copier le lien", shareUrl);
});

test("commande groupée : « Partager le message » ouvre la fenêtre, le message entier à copier et à envoyer", async ({
  page,
  context,
  baseURL,
  db,
}, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  await shareMenu(page, false);
  await openProduct(page);
  await keepWish(page);
  const productId = /\/produits\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  const { rows } = await db.query<{ id: string; shop_id: string }>(
    "select i.id, p.shop_id from items i join products p on p.id = i.product_id where p.id = $1",
    [productId],
  );
  const [item] = rows;
  if (!item) throw new Error("no item");
  const created = await page.request.post("/api/me/wishlists", { data: { name: "Anniversaire" } });
  const listId = ((await created.json()) as { id: string }).id;
  await db.query("insert into wishlist_items (wishlist_id, item_id, position) values ($1, $2, 0)", [listId, item.id]);
  await page.goto(`/listes/${listId}`);
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  const shareUrl = await field.inputValue();
  const opened = await page.request.post(`/api/me/wishlists/${listId}/group-order`, {
    data: {
      shopId: item.shop_id,
      shipping: { label: "Colissimo", shippingCents: 690, freeFromCents: 8000 },
      deadline: "2027-03-12",
    },
  });
  expect(opened.status()).toBe(201);

  await page.goto(`/listes/${listId}/commande-groupee`);
  await page.getByRole("button", { name: "Partager le message" }).click();
  const sheet = sheetOf(page);
  await expect(choicesOf(sheet)).toHaveText(expectedChoices("Copier le message", touchOf(testInfo), false));
  const message = `Commande groupée chez ${AUTO_SHOP.name} jusqu'au 12\u00a0mars : ajoute tes articles ici 👉 ${shareUrl}`;
  await expectAppLinks(sheet, message, shareUrl, message);
  await axeLightAndDark(page);
  await setTheme(page, "light");
  await expectCopy(page, sheet, "Copier le message", message);
});

/** The clipboard as the tap reads it: `window.copied`, or refused when it is null. */
async function fakeClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "readText", {
      configurable: true,
      value: () => {
        const copied = (window as unknown as { copied?: string | null }).copied;
        return copied === null || copied === undefined
          ? Promise.reject(new DOMException("no", "NotAllowedError"))
          : Promise.resolve(copied);
      },
    });
  });
}
const setCopied = (page: Page, value: string | null) =>
  page.evaluate((copied) => {
    (window as unknown as { copied?: string | null }).copied = copied;
  }, value);

async function openAdd(page: Page): Promise<Locator> {
  const phone = (page.viewportSize()?.width ?? 0) <= 767;
  const opener = phone
    ? page.getByRole("navigation", { name: "Menu principal" }).getByRole("button", { name: "Ajouter un article" })
    : page.getByRole("banner").getByRole("button", { name: "Ajouter un article" });
  await opener.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter un article" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("« Coller le lien copié » en tête sur un écran tactile : le lien copié s'ajoute, sinon le champ s'ouvre", async ({
  page,
}, testInfo) => {
  await fakeClipboard(page);
  await page.goto("/decouvrir");
  let sheet = await openAdd(page);
  const options = sheet.getByRole("listitem");
  if (!touchOf(testInfo)) {
    await expect(sheet.getByRole("button", { name: /Coller le lien copié/ })).toHaveCount(0);
    await expect(options.first()).toContainText("Coller un lien");
    return;
  }
  await expect(options.first()).toContainText("Coller le lien copié");
  await axe(page);

  // Refused, then nothing usable: the message, and the paste field takes the focus.
  for (const copied of [null, "pas un lien"]) {
    await setCopied(page, copied);
    await sheet.getByRole("button", { name: /^Coller le lien copié/ }).click();
    await expect(sheet.getByRole("alert")).toHaveText("Copie d’abord le lien de l’article dans la boutique.");
    await expect(sheet.getByLabel("Coller un lien")).toBeFocused();
    await sheet.getByRole("button", { name: "Retour" }).click();
  }

  // A link copied in the shop (here inside a shared text): added like a pasted one.
  const url = autoProductUrl();
  await setCopied(page, `Regarde ${url}`);
  const capture = page.waitForRequest((request) => request.url().endsWith("/api/captures"));
  await sheet.getByRole("button", { name: /^Coller le lien copié/ }).click();
  expect((await capture).postDataJSON()).toEqual({ url });
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await expect(sheet).toBeHidden();
  // Added after « Découvrir » in the history, not instead of it.
  await page.goBack();
  await expect(page).toHaveURL(/\/decouvrir$/);
  sheet = await openAdd(page);
  await expect(sheet.getByRole("alert")).toHaveCount(0);
});

test("« Partager depuis une boutique » mène à l'aide iPhone sur iPhone et iPad, l'explique ailleurs", async ({
  page,
}, testInfo) => {
  await page.goto("/decouvrir");
  const sheet = await openAdd(page);
  await sheet.getByRole(appleOf(testInfo) ? "link" : "button", { name: /^Partager depuis une boutique/ }).click();
  if (appleOf(testInfo)) {
    await expect(page).toHaveURL(/\/aide\/iphone$/);
    await expect(sheet).toBeHidden();
  } else {
    await expect(sheet.getByText(/« Partager »/).first()).toBeVisible();
  }
});

test("l'aide iPhone : installer le raccourci, sinon la phrase pour l'IA, sinon copier-coller en 2 gestes", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  await page.goto("/aide/iphone");
  await expect(page.getByRole("heading", { level: 1, name: "Ajouter un article depuis l’iPhone" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Closyria dans le menu Partager",
    "Ou demande à l’IA de ton iPhone",
    "Ou : Coller le lien copié",
  ]);
  // 1. The founder's shortcut, in a new tab.
  const install = page.getByRole("link", { name: "Installer le raccourci" });
  await expect(install).toHaveAttribute("href", "https://www.icloud.com/shortcuts/25fa594f43114b2ea534f076f50509b4");
  await expect(install).toHaveAttribute("target", "_blank");
  await expect(page.getByText("Ensuite, dans une boutique : Partager → Envoyer à Closyria.")).toBeVisible();
  // 2. The sentence for the iPhone's AI: copied in the click, « Copié ✓ »; refused, selected to copy by hand.
  const sentence =
    'Crée un raccourci "Envoyer à Closyria" qui apparaît dans le menu Partager et qui ouvre https://closyria.com/partager?url= suivi du lien partagé.';
  await expect(page.getByLabel("Phrase à donner à l’IA")).toHaveValue(sentence);
  const copy = page.getByRole("button", { name: /^Copier la phrase|^Copié ✓/ });
  await copy.click();
  await expect(copy).toHaveText("Copié ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentence);
  await expect(copy).toHaveText("Copier la phrase", { timeout: 5_000 });
  await page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error("refused"));
  });
  await copy.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Copie impossible ici : la phrase est sélectionnée, copie-la à la main." }),
  ).toBeVisible();
  await expect(page.getByLabel("Phrase à donner à l’IA")).toBeFocused();
  // 3. Copy, then paste: 2 gestures.
  const gestures = page.getByRole("list", { name: "Les 2 gestes" });
  await expect(gestures.getByRole("listitem")).toHaveCount(2);
  await expect(gestures).toContainText("Coller le lien copié");
  await axeLightAndDark(page);
});

test("/partager prend un lien non encodé : tout ce qui suit url=, avec ses ? et &", async ({ page }) => {
  const url = `${autoProductUrl()}&couleur=rouge&taille=M`;
  const capture = page.waitForRequest((request) => request.url().endsWith("/api/captures"));
  await page.goto(`/partager?url=${url}`);
  expect((await capture).postDataJSON()).toEqual({ url });
  await expect(page).toHaveURL(/\/produits\/[0-9a-f-]{36}\?capture=/);
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });

  // Encoded, as the share target sends it: still the whole link.
  const encoded = `${autoProductUrl()}&couleur=bleu`;
  const second = page.waitForRequest((request) => request.url().endsWith("/api/captures"));
  await page.goto(`/partager?url=${encodeURIComponent(encoded)}&title=Robe`);
  expect((await second).postDataJSON()).toEqual({ url: encoded });
  await expect(page).toHaveURL(/\/produits\/[0-9a-f-]{36}\?capture=/);
});
