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
