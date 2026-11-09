import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Avis des amies, task 7: on the shared link, a friend sees the owner's opinion and gives her own (spec §3).

const appToast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};
const setTheme = (page: Page, theme: string) =>
  page.evaluate((id) => {
    document.documentElement.dataset.theme = id;
  }, theme);

/** The owner keeps the product with 🔥 and « Pour le mariage », puts it in a new list « Mariage », shares it. */
async function sharedList(page: Page, db: Parameters<typeof sessionsOf>[0], userAgentTag: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  // Her account name (« Mon compte »): the link shows its first word. A guest's never shows (« Anonymous »).
  const [session] = await sessionsOf(db, userAgentTag);
  await db.query(`update "user" set name = 'Camille Durand', is_anonymous = false where id = $1`, [session?.userId]);

  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  const menu = page.getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` });
  await card.getByRole("button", { name: "Plus d’actions" }).click();
  await menu.getByRole("button", { name: "En feu" }).click();
  await expect(appToast(page)).toContainText("En feu");
  await card.getByRole("button", { name: "Plus d’actions" }).click();
  await menu.getByRole("button", { name: "Mon avis" }).click();
  const why = page.getByRole("dialog", { name: "Mon avis" });
  await why.getByLabel("Pourquoi ?").fill("Pour le mariage");
  await why.getByRole("button", { name: "Enregistrer" }).click();
  await expect(appToast(page)).toContainText("Avis enregistré");

  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Mariage");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(appToast(page)).toContainText("Liste « Mariage » créée");
  await page.goto("/envies");
  await card.getByRole("button", { name: "Plus d’actions" }).click();
  await menu.getByRole("button", { name: "Ajouter à une liste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mariage" }).click();
  await expect(appToast(page)).toContainText("Ajouté à Mariage");

  await page.goto("/listes");
  await page.getByRole("link", { name: /Mariage/ }).click();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  return field.inputValue();
}

/** A friend's own browser: no session, her own address. */
async function friend(browser: Browser, baseURL: string | undefined, address: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: address },
  });
  return context.newPage();
}

test("une amie donne son avis", async ({ page, browser, baseURL, db, userAgentTag }, testInfo) => {
  test.slow();
  const shareUrl = await sharedList(page, db, userAgentTag);
  // A long name of her own for one level: it must read in full on the friend's sheet.
  const [session] = await sessionsOf(db, userAgentTag);
  await db.query(
    `insert into love_levels (user_id, level, emoji, label)
     values ($1, 1, '😕', 'Bof'), ($1, 2, '🤍', 'Franchement canon'), ($1, 3, '🥰', 'Mims'), ($1, 4, '🔥', 'En feu')`,
    [session?.userId],
  );

  const lea = await friend(browser, baseURL, `10.201.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await expect(lea.getByText("La liste de Camille", { exact: true })).toBeVisible();
  await expect(lea.getByRole("heading", { level: 1, name: "Mariage" })).toBeVisible();
  await expect(lea.getByText("Dis-lui ce que tu en penses 💬")).toBeVisible();
  const item = lea.getByRole("list", { name: "Articles" }).getByRole("listitem").first();
  const owner = item.getByTestId("owner-opinion");
  await expect(owner).toContainText("Camille");
  await expect(owner).toContainText("🔥 En feu");
  await expect(owner).toContainText("« Pour le mariage »");
  await axe(lea);

  // First opinion: her name is asked once.
  await item.getByRole("button", { name: "Donner mon avis" }).click();
  const sheet = lea.getByRole("dialog", { name: `Ton avis sur ${PRODUCT.name}` });
  await expect(sheet).toBeVisible();
  // The four levels read in full, on a phone too (two by two there).
  const longLabel = sheet.locator("button[aria-pressed] span:last-child").filter({ hasText: "Franchement canon" });
  await expect(longLabel).toHaveCount(1);
  const clipped = await longLabel.evaluateAll(
    (labels) => labels.filter((label) => label.scrollWidth > label.clientWidth).length,
  );
  expect(clipped).toBe(0);
  await sheet.screenshot({ path: testInfo.outputPath("sheet-levels.png") });
  // A web address is refused in the name too.
  await sheet.getByLabel("Ton prénom").fill("zara.com");
  await sheet.getByRole("button", { name: "En feu" }).click();
  await sheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Les liens ne sont pas acceptés dans les avis.");
  await sheet.getByLabel("Ton prénom").fill("Léa");
  await sheet.getByRole("button", { name: "En feu" }).click();
  await expect(sheet.getByRole("button", { name: "En feu" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByLabel("Un petit mot").fill("elle t'irait trop bien");
  await expect(sheet.getByText("Visible par toutes celles qui ont le lien.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Envoyer mon avis" })).toBeInViewport();
  await lea.screenshot({ path: testInfo.outputPath("sheet-light.png") });
  await axe(lea);
  await sheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  const toast = lea.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Avis envoyé");
  await expect(toast.getByRole("button", { name: "Annuler" })).toBeVisible();
  await expect(sheet).toBeHidden();
  const opinions = item.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("Léa");
  await expect(opinions.first()).toContainText("En feu");
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  await lea.screenshot({ path: testInfo.outputPath("page-light.png"), fullPage: true });

  // Back later: her name is remembered on this device.
  await lea.reload();
  await expect(item.getByRole("button", { name: "Donner mon avis" })).toHaveCount(0);
  await item.getByRole("button", { name: "Modifier mon avis" }).click();
  await expect(sheet.getByLabel("Ton prénom")).toHaveCount(0);
  await expect(sheet.getByText("Léa", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Ce n'est pas moi" })).toBeVisible();
  await expect(sheet.getByLabel("Un petit mot")).toHaveValue("elle t'irait trop bien");

  // A web address is refused.
  await sheet.getByLabel("Un petit mot").fill("www.zara.com");
  await sheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Les liens ne sont pas acceptés dans les avis.");
  await sheet.getByLabel("Un petit mot").fill("elle t'irait trop bien");

  // Dark: the page and the sheet read well.
  await setTheme(lea, "equilibre-dark");
  await lea.screenshot({ path: testInfo.outputPath("sheet-dark.png") });
  await axe(lea);

  // « Effacer mon avis », then « Annuler » puts it back.
  await sheet.getByRole("button", { name: "Effacer mon avis" }).click();
  await expect(toast).toContainText("Avis effacé");
  await expect(opinions).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Donner mon avis" })).toBeVisible();
  await toast.getByRole("button", { name: "Annuler" }).last().click();
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  await expect(item.getByRole("button", { name: "Modifier mon avis" })).toBeVisible();
  await lea.screenshot({ path: testInfo.outputPath("page-dark.png"), fullPage: true });
  await axe(lea);

  // « Ce n'est pas moi »: someone else on this device starts blank and cannot erase Léa's opinion.
  await item.getByRole("button", { name: "Modifier mon avis" }).click();
  await sheet.getByRole("button", { name: "Ce n'est pas moi" }).click();
  await expect(sheet.getByLabel("Ton prénom")).toBeFocused();
  await expect(sheet.getByLabel("Ton prénom")).toHaveValue("");
  await expect(sheet.getByLabel("Un petit mot")).toHaveValue("");
  await expect(sheet.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Effacer mon avis" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Fermer" }).click();
  await expect(sheet).toBeHidden();

  // Another device with the same name (any case): « C'est toi ? », « Non » proposes « Léa M. ».
  const other = await friend(browser, baseURL, `10.202.${testInfo.workerIndex % 250}.1`);
  await other.goto(shareUrl);
  const otherItem = other.getByRole("list", { name: "Articles" }).getByRole("listitem").first();
  await otherItem.getByRole("button", { name: "Donner mon avis" }).click();
  const otherSheet = other.getByRole("dialog", { name: `Ton avis sur ${PRODUCT.name}` });
  await otherSheet.getByLabel("Ton prénom").fill("léa");
  await otherSheet.getByRole("button", { name: "Mims" }).click();
  await otherSheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(otherSheet.getByText("Une Léa est déjà passée sur cette liste. C'est toi ?")).toBeVisible();
  // The question is announced and takes the focus from the send button it replaces.
  await expect(otherSheet.getByRole("alert")).toContainText("C'est toi ?");
  await expect(otherSheet.getByRole("button", { name: "Oui, c'est moi" })).toBeFocused();
  await otherSheet.getByRole("button", { name: "Non", exact: true }).click();
  await expect(otherSheet.getByLabel("Ton prénom")).toHaveValue("Léa M.");
  await otherSheet.getByLabel("Ton prénom").fill("Léa Martin");
  await otherSheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  const otherToast = other.getByRole("status", { name: "Notifications" });
  await expect(otherToast).toContainText("Avis envoyé");
  const otherOpinions = otherItem.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(otherOpinions).toHaveCount(2);
  // « Annuler » right after a first opinion takes it back.
  await otherToast.getByRole("button", { name: "Annuler" }).last().click();
  await expect(otherOpinions).toHaveCount(1);
  await expect(otherOpinions.first()).toContainText("Léa");

  // « Oui, c'est moi »: a third device takes the name; Léa's opinion is replaced, not doubled.
  const again = await friend(browser, baseURL, `10.203.${testInfo.workerIndex % 250}.1`);
  await again.goto(shareUrl);
  const againItem = again.getByRole("list", { name: "Articles" }).getByRole("listitem").first();
  await againItem.getByRole("button", { name: "Donner mon avis" }).click();
  const againSheet = again.getByRole("dialog", { name: `Ton avis sur ${PRODUCT.name}` });
  await againSheet.getByLabel("Ton prénom").fill("Léa");
  await againSheet.getByRole("button", { name: "Mims" }).click();
  await againSheet.getByLabel("Un petit mot").fill("finalement plutôt Mims");
  await againSheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(againSheet.getByRole("button", { name: "Oui, c'est moi" })).toBeFocused();
  await againSheet.getByRole("button", { name: "Oui, c'est moi" }).click();
  await expect(again.getByRole("status", { name: "Notifications" })).toContainText("Avis envoyé");
  const againOpinions = againItem.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(againOpinions).toHaveCount(1);
  await expect(againOpinions.first()).toContainText("Léa");
  await expect(againOpinions.first()).toContainText("Mims");
  await expect(againOpinions.first()).toContainText("finalement plutôt Mims");
  await expect(againOpinions.first()).not.toContainText("elle t'irait trop bien");
  await expect(againItem.getByRole("button", { name: "Modifier mon avis" })).toBeVisible();

  // The owner stops sharing while the page is open: sending shows that the link no longer works.
  await stopSharing(page);
  await againItem.getByRole("button", { name: "Modifier mon avis" }).click();
  await againSheet.getByLabel("Un petit mot").fill("toujours Mims");
  await againSheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(again.getByRole("heading", { level: 1, name: "Ce lien ne marche plus" })).toBeFocused();
  await expect(again.getByText("La personne a arrêté de partager cette liste")).toBeVisible();
  await expect(againSheet).toHaveCount(0);
  await axe(again);

  await lea.context().close();
  await other.context().close();
  await again.context().close();
});

// Avis des amies, task 8: what the owner sees in the app (spec §4.1, §4.2).

/** A friend on the link gives her opinion on the first item. */
async function giveOpinion(friendPage: Page, name: string, level: string, note: string): Promise<void> {
  const item = friendPage.getByRole("list", { name: "Articles" }).getByRole("listitem").first();
  await item.getByRole("button", { name: "Donner mon avis" }).click();
  const sheet = friendPage.getByRole("dialog", { name: `Ton avis sur ${PRODUCT.name}` });
  await sheet.getByLabel("Ton prénom").fill(name);
  await sheet.getByRole("button", { name: level }).click();
  await sheet.getByLabel("Un petit mot").fill(note);
  await sheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(friendPage.getByRole("status", { name: "Notifications" })).toContainText("Avis envoyé");
}

/** « Arrêter le partage », then « Arrêter » in the question it asks. */
async function stopSharing(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Arrêter le partage" }).click();
  await page
    .getByRole("dialog", { name: "Arrêter le partage ?" })
    .getByRole("button", { name: "Arrêter", exact: true })
    .click();
  await expect(appToast(page)).toContainText("Partage arrêté");
}

/** Flips one of the list's sharing settings and waits until it is saved. */
async function flip(page: Page, name: string, to: boolean): Promise<void> {
  const toggle = page.getByRole("switch", { name });
  await expect(toggle).toHaveAttribute("aria-checked", String(!to));
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && /\/api\/me\/wishlists\/[^/]+$/.test(response.url()),
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", String(to));
  expect((await saved).status()).toBe(200);
}

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });

  test("l'avis nouveau s'affiche d'emblée, sans animation", async ({
    page,
    browser,
    baseURL,
    db,
    userAgentTag,
  }, testInfo) => {
    test.slow();
    const shareUrl = await sharedList(page, db, userAgentTag);
    const lea = await friend(browser, baseURL, `10.208.${testInfo.workerIndex % 250}.1`);
    await lea.goto(shareUrl);
    await giveOpinion(lea, "Léa", "En feu", "elle t'irait trop bien");
    await page.goto("/listes");
    await page.getByRole("link", { name: /Mariage/ }).click();
    const bubble = page
      .getByTestId("item-card")
      .first()
      .getByRole("list", { name: "Avis des amies" })
      .getByRole("listitem");
    await expect(bubble).toHaveCount(1);
    expect(await bubble.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await bubble.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});

test("la fondatrice voit la pastille, l'avis « nouveau », l'efface et l'annule", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const shareUrl = await sharedList(page, db, userAgentTag);
  const lea = await friend(browser, baseURL, `10.204.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await giveOpinion(lea, "Léa", "En feu", "elle t'irait trop bien");

  // « Listes »: the list shows « 1 nouvel avis ».
  await page.goto("/listes");
  const row = page.getByTestId("wishlist-row").filter({ hasText: "Mariage" });
  await expect(row.getByText("1 nouvel avis")).toBeVisible();
  await axe(page);

  // The list: the opinion under its item, marked « nouveau ».
  const seen = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/opinions/seen"));
  await page.getByRole("link", { name: /Mariage/ }).click();
  const card = page.getByTestId("item-card").first();
  const opinions = card.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("Léa");
  await expect(opinions.first()).toContainText("🔥 En feu");
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  // A bubble that rises in (new this visit) and a still « 1 nouveau » pill: no endless animation.
  await expect(opinions.first().locator(".bubble.bubble-new")).toHaveCount(1);
  const pill = card.getByText("1 nouveau", { exact: true });
  await expect(pill).toBeVisible();
  expect(await pill.evaluate((el) => getComputedStyle(el).animationIterationCount)).not.toBe("infinite");
  expect(await pill.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  // Seen once the page shows them: the mark stays for this visit.
  expect((await seen).status()).toBe(204);
  await expect(pill).toBeVisible();
  await expect(page.getByLabel("Lien de partage")).toHaveValue(shareUrl);
  const sharePanel = page.getByRole("region", { name: "Partage" });
  await page.screenshot({ path: testInfo.outputPath("owner-list-light.png") });
  await sharePanel.screenshot({ path: testInfo.outputPath("owner-share-light.png") });
  await card.screenshot({ path: testInfo.outputPath("owner-opinions-light.png") });
  await axe(page);
  await setTheme(page, "equilibre-dark");
  await sharePanel.screenshot({ path: testInfo.outputPath("owner-share-dark.png") });
  await card.screenshot({ path: testInfo.outputPath("owner-opinions-dark.png") });
  await axe(page);
  await setTheme(page, "equilibre");

  // Back on « Listes »: no badge any more; the next visit has no « nouveau ».
  await page.goto("/listes");
  await expect(row).toBeVisible();
  await expect(row.getByText(/nouvel/)).toHaveCount(0);
  await page.getByRole("link", { name: /Mariage/ }).click();
  await expect(opinions).toHaveCount(1);
  await expect(card.getByText(/nouveau/)).toHaveCount(0);
  await expect(opinions.first().locator(".bubble-new")).toHaveCount(0);

  // « Effacer » → « Avis de Léa effacé · Annuler »; « Annuler » puts it back.
  await opinions.first().getByRole("button", { name: "Effacer l'avis de Léa" }).click();
  await expect(appToast(page)).toContainText("Avis de Léa effacé");
  await expect(opinions).toHaveCount(0);
  await appToast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  await lea.reload();
  await expect(
    lea.getByRole("list", { name: "Articles" }).getByRole("list", { name: "Avis des amies" }).getByRole("listitem"),
  ).toHaveCount(1);

  // Stopping the share keeps the opinions: still on the page, and after a reload.
  await stopSharing(page);
  await expect(card.getByRole("list", { name: "Avis des amies" }).getByRole("listitem")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Avis des amies" }).getByRole("listitem").filter({ hasText: "Léa" }),
  ).toHaveCount(1);
  await lea.context().close();
});

test("les réglages du partage changent ce que voit le lien", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const shareUrl = await sharedList(page, db, userAgentTag);
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  const budget = page.getByRole("dialog", { name: "Budget de la liste" });
  await budget.getByLabel("Montant (en euros)").fill("150");
  await budget.getByRole("radio", { name: "Sans période" }).check();
  await budget.getByRole("button", { name: "Enregistrer" }).click();
  await expect(budget).toHaveCount(0);

  // The defaults: opinions open, her name and her opinions shown, the budget hidden.
  const switches = page.getByRole("switch");
  await expect(switches).toHaveText([
    "Autoriser les avis",
    "Montrer mon prénom",
    "Montrer mes avis",
    "Montrer le budget",
    "Mes amies peuvent m'offrir des articles",
  ]);
  for (const [name, on] of [
    ["Autoriser les avis", true],
    ["Montrer mon prénom", true],
    ["Montrer mes avis", true],
    ["Montrer le budget", false],
  ] as const) {
    await expect(page.getByRole("switch", { name })).toHaveAttribute("aria-checked", String(on));
  }
  await expect(page.getByText(/Elle voit aussi ton prénom et tes avis/)).toBeVisible();
  await axe(page);

  const lea = await friend(browser, baseURL, `10.205.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await expect(lea.getByTestId("owner-opinion")).toBeVisible();
  await expect(lea.getByText(/Budget de la liste/)).toHaveCount(0);

  await flip(page, "Montrer mes avis", false);
  await lea.reload();
  await expect(lea.getByRole("heading", { level: 1, name: "Mariage" })).toBeVisible();
  await expect(lea.getByTestId("owner-opinion")).toHaveCount(0);

  await flip(page, "Montrer le budget", true);
  await expect(page.getByText(/le budget de la liste/)).toBeVisible();
  await lea.reload();
  await expect(lea.getByText(/^Budget de la liste : 150\s€$/)).toBeVisible();

  await flip(page, "Montrer mon prénom", false);
  await lea.reload();
  await expect(lea.getByRole("heading", { level: 1, name: "Mariage" })).toBeVisible();
  await expect(lea.getByText(/La liste de/)).toHaveCount(0);

  // A setting is kept: back on the page, it is as she left it.
  await page.reload();
  await expect(page.getByRole("switch", { name: "Montrer mon prénom" })).toHaveAttribute("aria-checked", "false");

  // Opinions closed while Léa's sheet is open: sending closes it, the buttons go, the page says so.
  const item = lea.getByRole("list", { name: "Articles" }).getByRole("listitem").first();
  await item.getByRole("button", { name: "Donner mon avis" }).click();
  const sheet = lea.getByRole("dialog", { name: `Ton avis sur ${PRODUCT.name}` });
  await sheet.getByLabel("Ton prénom").fill("Léa");
  await sheet.getByRole("button", { name: "Mims" }).click();
  await flip(page, "Autoriser les avis", false);
  await expect(page.getByText(/Elle ne peut pas donner son avis/)).toBeVisible();
  await sheet.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(sheet).toBeHidden();
  await expect(lea.getByRole("button", { name: /Donner mon avis|Modifier mon avis/ })).toHaveCount(0);
  await expect(lea.locator("header").getByText("Les avis sont fermés sur cette liste.")).toBeVisible();
  await lea.reload();
  await expect(lea.locator("header").getByText("Les avis sont fermés sur cette liste.")).toBeVisible();
  await expect(lea.getByRole("button", { name: "Donner mon avis" })).toHaveCount(0);
  await lea.context().close();
});

test("un réglage qui n'a pas pu être enregistré revient en arrière", async ({ page, db, userAgentTag }) => {
  await sharedList(page, db, userAgentTag);
  await page.route(/\/api\/me\/wishlists\/[^/]+$/, (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "{}" }) : route.fallback(),
  );
  const toggle = page.getByRole("switch", { name: "Montrer le budget" });
  await toggle.click();
  await expect(page.getByRole("alert").filter({ hasText: "Le réglage n’a pas pu être enregistré" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // The next save works: the message goes.
  await page.unrouteAll();
  await flip(page, "Montrer le budget", true);
  await expect(page.getByText("Le réglage n’a pas pu être enregistré", { exact: false })).toHaveCount(0);
});

test("deux réglages enregistrés coup sur coup : la réponse en retard ne défait pas l'autre", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  const shareUrl = await sharedList(page, db, userAgentTag);
  // The first save reaches the API at once, but its answer is held until the second one has answered.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route(/\/api\/me\/wishlists\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PATCH" || !first) return route.fallback();
    first = false;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  const budget = page.getByRole("switch", { name: "Montrer le budget" });
  const name = page.getByRole("switch", { name: "Montrer mon prénom" });
  await budget.click();
  const second = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && /\/api\/me\/wishlists\/[^/]+$/.test(response.url()),
  );
  await name.click();
  await second;
  const late = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && /\/api\/me\/wishlists\/[^/]+$/.test(response.url()),
  );
  release();
  await late;
  await expect(budget).toHaveAttribute("aria-checked", "true");
  await expect(name).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/Elle voit aussi tes avis/)).toBeVisible();
  await expect(page.getByText(/ton prénom/)).toHaveCount(0);

  // As the API kept them, and as the link shows them.
  await page.reload();
  await expect(budget).toHaveAttribute("aria-checked", "true");
  await expect(name).toHaveAttribute("aria-checked", "false");
  const lea = await friend(browser, baseURL, `10.206.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await expect(lea.getByRole("heading", { level: 1, name: "Mariage" })).toBeVisible();
  await expect(lea.getByText(/La liste de/)).toHaveCount(0);
  await lea.context().close();
});

// Avis des amies, task 9: the opinions on the item page and in the order preview (spec §4.3).

test("l'aperçu de commande et la fiche montrent « Avis des amies », avec le nom de la liste s'il y en a plusieurs", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const shareUrl = await sharedList(page, db, userAgentTag);
  const preview = page.getByRole("dialog", { name: `Aperçu de ${PRODUCT.name}` });
  const axeSheet = async (page: Page) => {
    // A new opinion's bubble rises in: axe reads the settled colours, not a half-faded frame.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    const { violations } = await new AxeBuilder({ page }).include("[data-testid=preview-body]").analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  };

  const section = (scope: Page | ReturnType<Page["getByRole"]>) =>
    scope.getByRole("heading", { name: "Avis des amies" });

  // No opinion yet: no section, no empty state.
  await page.goto("/envies/commande");
  await page.getByRole("button", { name: new RegExp(PRODUCT.name) }).click();
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("button", { name: "Fermer" })).toBeVisible();
  await expect(section(preview)).toHaveCount(0);

  const lea = await friend(browser, baseURL, `10.205.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await giveOpinion(lea, "Léa", "En feu", "elle t'irait trop bien");

  // One shared list: her opinion, no list name.
  await page.goto("/envies/commande");
  await page.getByRole("button", { name: new RegExp(PRODUCT.name) }).click();
  await expect(section(preview)).toBeVisible();
  const opinions = preview.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("Léa");
  await expect(opinions.first()).toContainText("🔥 En feu");
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  await expect(preview.getByText("Mariage", { exact: true })).toHaveCount(0);
  await expect(opinions.first().getByRole("button")).toHaveCount(0);
  // The section only: the sheet's photo strip has its own (older) scroll-focus finding.
  await axeSheet(page);
  await page.screenshot({ path: testInfo.outputPath("preview-opinions-light.png") });

  // The item page shows the same.
  await preview.getByRole("link", { name: "Ouvrir la fiche complète" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  await expect(section(page)).toBeVisible();
  const pageOpinions = page.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(pageOpinions).toHaveCount(1);
  await expect(pageOpinions.first()).toContainText("elle t'irait trop bien");
  await expect(page.getByText("Mariage", { exact: true }).first()).toBeVisible();

  // A second shared list with another friend's opinion: each list is named.
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Cadeaux");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(appToast(page)).toContainText("Liste « Cadeaux » créée");
  await page.goto("/envies");
  const card = page.getByTestId("item-card").first();
  await card.getByRole("button", { name: "Plus d’actions" }).click();
  await page
    .getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` })
    .getByRole("button", { name: "Ajouter à une liste" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Cadeaux" }).click();
  await expect(appToast(page)).toContainText("Ajouté à Cadeaux");
  await page.goto("/listes");
  await page.getByRole("link", { name: /Cadeaux/ }).click();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  const mia = await friend(browser, baseURL, `10.206.${testInfo.workerIndex % 250}.1`);
  await mia.goto(await field.inputValue());
  await giveOpinion(mia, "Mia", "Mims", "la couleur est parfaite");

  await page.goto("/envies/commande");
  await page.getByRole("button", { name: new RegExp(PRODUCT.name) }).click();
  await expect(preview.getByText("Mariage", { exact: true })).toBeVisible();
  await expect(preview.getByText("Cadeaux", { exact: true })).toBeVisible();
  await expect(preview.getByRole("list", { name: "Avis des amies" }).getByRole("listitem")).toHaveCount(2);
  await axeSheet(page);

  await lea.context().close();
  await mia.context().close();
});

test("la fiche ouverte se met à jour tout seul, et garde les avis déjà montrés si le rafraîchissement échoue", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const shareUrl = await sharedList(page, db, userAgentTag);
  // The item page (not the preview: the live poll waits while a sheet is open).
  await page.goto("/envies/commande");
  await page.getByRole("button", { name: new RegExp(PRODUCT.name) }).click();
  await page
    .getByRole("dialog", { name: `Aperçu de ${PRODUCT.name}` })
    .getByRole("link", { name: "Ouvrir la fiche complète" })
    .click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  // The first stamp read is the baseline: wait for it before the friend answers.
  await page.waitForResponse((r) => r.url().endsWith("/api/me/changes"), { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Avis des amies" })).toHaveCount(0);

  // A friend answers elsewhere: the open preview shows it without a reload (live poll).
  const lea = await friend(browser, baseURL, `10.207.${testInfo.workerIndex % 250}.1`);
  await lea.goto(shareUrl);
  await giveOpinion(lea, "Léa", "En feu", "elle t'irait trop bien");
  const opinions = page.getByRole("list", { name: "Avis des amies" }).getByRole("listitem");
  await expect(opinions).toHaveCount(1, { timeout: 40_000 });

  // The opinions request now fails: what is shown stays when a second opinion moves the stamp.
  await page.route("**/api/me/items/*/opinions", (route) => route.fulfill({ status: 500, body: "{}" }));
  const mia = await friend(browser, baseURL, `10.208.${testInfo.workerIndex % 250}.1`);
  await mia.goto(shareUrl);
  await giveOpinion(mia, "Mia", "Mims", "la couleur est parfaite");
  await page.waitForResponse((r) => r.url().includes("/opinions") && r.status() === 500, { timeout: 40_000 });
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("Léa");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

  await lea.context().close();
  await mia.context().close();
});
