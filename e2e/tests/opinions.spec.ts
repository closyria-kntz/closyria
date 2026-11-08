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
  // Her account name (« Mon compte »): the link shows its first word.
  const [session] = await sessionsOf(db, userAgentTag);
  await db.query(`update "user" set name = 'Camille Durand' where id = $1`, [session?.userId]);

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
  await toast.getByRole("button", { name: "Annuler" }).click();
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
  await expect(otherSheet.getByText("Une Léa a déjà donné son avis sur cette liste. C'est toi ?")).toBeVisible();
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
  await otherToast.getByRole("button", { name: "Annuler" }).click();
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
  await page.getByRole("button", { name: "Arrêter le partage" }).click();
  await expect(appToast(page)).toContainText("Partage arrêté");
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
  await expect(opinions.first().getByText("nouveau", { exact: true })).toBeVisible();
  // Seen once the page shows them: the mark stays for this visit.
  expect((await seen).status()).toBe(204);
  await expect(opinions.first().getByText("nouveau", { exact: true })).toBeVisible();
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
  await expect(opinions.first().getByText("nouveau", { exact: true })).toHaveCount(0);

  // « Effacer » → « Avis de Léa effacé · Annuler »; « Annuler » puts it back.
  await opinions.first().getByRole("button", { name: "Effacer l'avis de Léa" }).click();
  await expect(appToast(page)).toContainText("Avis de Léa effacé");
  await expect(opinions).toHaveCount(0);
  await appToast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(opinions).toHaveCount(1);
  await expect(opinions.first()).toContainText("elle t'irait trop bien");
  await lea.reload();
  await expect(
    lea.getByRole("list", { name: "Articles" }).getByRole("list", { name: "Avis des amies" }).getByRole("listitem"),
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
});
