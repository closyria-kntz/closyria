import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Offrir, task 4: on a shared list open to gifts, friends reserve, join and leave (spec §3).

const appToast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};
const setTheme = (page: Page, theme: string) =>
  page.evaluate((id) => {
    document.documentElement.dataset.theme = id;
  }, theme);

const FIRST = "Robe Lina";
const SECOND = "Sac Mila";

type Owner = { shareUrl: string; listId: string; itemIds: [string, string] };

/**
 * The owner (« Camille ») keeps two products, puts them in a new list « Anniversaire », shares it and opens it to
 * gifts for « mon anniversaire » on 12 March. Her size is 38 on the first item, none on the second.
 */
async function giftList(page: Page, db: Parameters<typeof sessionsOf>[0], userAgentTag: string): Promise<Owner> {
  for (let i = 0; i < 2; i += 1) {
    await page.goto("/");
    await page.getByLabel("Coller un lien").fill(autoProductUrl());
    await page.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
    await keepWish(page);
  }
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId;
  await db.query(`update "user" set name = 'Camille Durand', is_anonymous = false where id = $1`, [userId]);
  const { rows } = await db.query<{ id: string; product_id: string }>(
    "select id, product_id from items where user_id = $1 order by created_at, id",
    [userId],
  );
  expect(rows).toHaveLength(2);
  const [first, second] = rows as [{ id: string; product_id: string }, { id: string; product_id: string }];
  // Each test pastes its own addresses: these products are its own.
  await db.query("update products set name = $2 where id = $1", [first.product_id, FIRST]);
  await db.query("update products set name = $2 where id = $1", [second.product_id, SECOND]);
  await db.query("update items set size_label = '38' where id = $1", [first.id]);

  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Anniversaire");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(appToast(page)).toContainText("Liste « Anniversaire » créée");
  const { rows: lists } = await db.query<{ id: string }>(
    "select id from wishlists where user_id = $1 and name = 'Anniversaire'",
    [userId],
  );
  const listId = lists[0]?.id ?? "";
  await db.query("insert into wishlist_items (wishlist_id, item_id, position) values ($1, $2, 0), ($1, $3, 1)", [
    listId,
    first.id,
    second.id,
  ]);

  await page.goto(`/listes/${listId}`);
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  const shareUrl = await field.inputValue();
  await setGifts(page, listId, { allowGifts: true, giftOccasion: "mon anniversaire", giftDate: "2027-03-12" });
  return { shareUrl, listId, itemIds: [first.id, second.id] };
}

async function setGifts(page: Page, listId: string, data: Record<string, unknown>): Promise<void> {
  const res = await page.request.patch(`/api/me/wishlists/${listId}`, { data });
  expect(res.status()).toBe(200);
}

/** A friend's own browser: no session, her own address. */
async function friend(browser: Browser, baseURL: string | undefined, address: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: address },
  });
  return context.newPage();
}

const itemOf = (page: Page, name: string) =>
  page
    .getByRole("list", { name: "Articles" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name }) });

/** « Je lui offre » or « Je participe » on an item, then her name if asked, then the sheet's confirmation. */
async function give(page: Page, itemName: string, button: string, name?: string): Promise<void> {
  await itemOf(page, itemName).getByRole("button", { name: button }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  if (name) await sheet.getByLabel("Ton prénom").fill(name);
  await sheet.getByRole("button", { name: button }).click();
  await expect(sheet).toBeHidden();
}

test("des amies offrent des articles de la liste", async ({ page, browser, baseURL, db, userAgentTag }, testInfo) => {
  test.slow();
  const owner = await giftList(page, db, userAgentTag);
  const lea = await friend(browser, baseURL, `10.211.${testInfo.workerIndex % 250}.1`);
  const ines = await friend(browser, baseURL, `10.212.${testInfo.workerIndex % 250}.1`);

  // The occasion, and her size on each item.
  await lea.goto(owner.shareUrl);
  await expect(lea.getByText("Pour mon anniversaire de Camille, le 12 mars 🎁")).toBeVisible();
  const leaFirst = itemOf(lea, FIRST);
  await expect(leaFirst.getByText("Sa taille : 38")).toBeVisible();
  await expect(itemOf(lea, SECOND).getByText("Taille non précisée")).toBeVisible();
  await expect(itemOf(lea, SECOND).getByRole("button", { name: "Je lui offre" })).toBeVisible();
  await axe(lea);

  // Léa reserves the first item: her name is asked once.
  await leaFirst.getByRole("button", { name: "Je lui offre" }).click();
  const sheet = lea.getByRole("dialog");
  await expect(sheet.getByLabel("Ton prénom")).toBeVisible();
  await sheet.getByLabel("Ton prénom").fill("Léa");
  await lea.screenshot({ path: testInfo.outputPath("sheet-light.png") });
  await axe(lea);
  await sheet.getByRole("button", { name: "Je lui offre" }).click();
  await expect(sheet).toBeHidden();
  await expect(leaFirst.getByText("Tu lui offres")).toBeVisible();
  await expect(leaFirst.getByRole("button", { name: "Me retirer" })).toBeVisible();
  await expect(leaFirst.getByRole("button", { name: "Je lui offre" })).toHaveCount(0);
  // Still hers after a reload (the page reads it again with her device).
  await lea.reload();
  await expect(leaFirst.getByText("Tu lui offres")).toBeVisible();
  await lea.screenshot({ path: testInfo.outputPath("page-light.png"), fullPage: true });
  await setTheme(lea, "equilibre-dark");
  await lea.screenshot({ path: testInfo.outputPath("page-dark.png"), fullPage: true });
  await axe(lea);

  // Inès sees who reserved and joins.
  await ines.goto(owner.shareUrl);
  const inesFirst = itemOf(ines, FIRST);
  await expect(inesFirst.getByText("Réservé par Léa")).toBeVisible();
  await expect(inesFirst.getByRole("button", { name: "Je lui offre" })).toHaveCount(0);
  await ines.screenshot({ path: testInfo.outputPath("reserved-light.png"), fullPage: true });
  await setTheme(ines, "equilibre-dark");
  await ines.screenshot({ path: testInfo.outputPath("reserved-dark.png"), fullPage: true });
  await axe(ines);
  await give(ines, FIRST, "Je participe", "Inès");
  await expect(inesFirst.getByText("Tu participes")).toBeVisible();
  await expect(inesFirst.getByRole("button", { name: "Me retirer" })).toBeVisible();
  await lea.reload();
  await expect(leaFirst.getByText("Offert par Léa et Inès")).toBeVisible();
  await expect(leaFirst.getByText("Tu lui offres")).toBeVisible();

  // Léa leaves, « Annuler » puts her back, she leaves again: Inès reserves.
  await leaFirst.getByRole("button", { name: "Me retirer" }).click();
  const toast = appToast(lea);
  await expect(toast).toContainText("Tu t'es retirée");
  await expect(leaFirst.getByRole("button", { name: "Me retirer" })).toHaveCount(0);
  await toast.getByRole("button", { name: "Annuler" }).click();
  await expect(leaFirst.getByRole("button", { name: "Me retirer" })).toBeVisible();
  await expect(leaFirst.getByText("Offert par Inès et Léa")).toBeVisible();
  await leaFirst.getByRole("button", { name: "Me retirer" }).click();
  await expect(toast).toContainText("Tu t'es retirée");
  await ines.reload();
  await expect(inesFirst.getByText("Réservé par Inès")).toBeVisible();
  await expect(inesFirst.getByText("Tu lui offres")).toBeVisible();

  // A race: Inès reserves the second item while Léa's page still shows it free.
  await expect(itemOf(lea, SECOND).getByRole("button", { name: "Je lui offre" })).toBeVisible();
  await give(ines, SECOND, "Je lui offre");
  await expect(itemOf(ines, SECOND).getByText("Tu lui offres")).toBeVisible();
  await itemOf(lea, SECOND).getByRole("button", { name: "Je lui offre" }).click();
  await expect(sheet.getByLabel("Ton prénom")).toHaveCount(0);
  await expect(sheet.getByText("Léa", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Je lui offre" }).click();
  await expect(sheet.getByRole("alert")).toHaveText("Inès vient de le réserver");
  await expect(sheet.getByRole("button", { name: "Je lui offre" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Je participe" }).click();
  await expect(sheet).toBeHidden();
  await expect(itemOf(lea, SECOND).getByText("Tu participes")).toBeVisible();
  await axe(lea);

  // Received as a gift: it leaves the items to offer, « Déjà offerts » lists it.
  const received = await page.request.post(`/api/me/items/${owner.itemIds[0]}/received-as-gift`, { data: {} });
  expect(received.status()).toBe(200);
  await ines.reload();
  await expect(itemOf(ines, FIRST)).toHaveCount(0);
  const given = ines.getByRole("region", { name: "Déjà offerts" });
  await expect(given.getByText(`${FIRST} — Offert ✓`)).toBeVisible();
  await axe(ines);

  // Closed to gifts: no button, no occasion, no « Déjà offerts ».
  await setGifts(page, owner.listId, { allowGifts: false });
  await ines.reload();
  await expect(itemOf(ines, SECOND)).toBeVisible();
  await expect(ines.getByRole("button", { name: /Je lui offre|Je participe|Me retirer/ })).toHaveCount(0);
  await expect(ines.getByText(/🎁/)).toHaveCount(0);
  await expect(ines.getByText("Sa taille", { exact: false })).toHaveCount(0);
  await expect(ines.getByRole("region", { name: "Déjà offerts" })).toHaveCount(0);

  await lea.context().close();
  await ines.context().close();
});

test("le prénom de la fondatrice caché : « Je l'offre »", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const owner = await giftList(page, db, userAgentTag);
  await db.query("update wishlists set show_owner_name = false where id = $1", [owner.listId]);
  await setGifts(page, owner.listId, { giftOccasion: null });
  const zoe = await friend(browser, baseURL, `10.213.${testInfo.workerIndex % 250}.1`);
  await zoe.goto(owner.shareUrl);
  await expect(zoe.getByText("Pour le 12 mars 🎁")).toBeVisible();
  await expect(itemOf(zoe, FIRST).getByRole("button", { name: "Je l'offre" })).toBeVisible();
  await give(zoe, FIRST, "Je l'offre", "Zoé");
  await expect(itemOf(zoe, FIRST).getByText("Tu l'offres")).toBeVisible();
  await setGifts(page, owner.listId, { giftDate: null });
  await zoe.reload();
  await expect(zoe.getByText("Tu peux offrir un article de cette liste 🎁")).toBeVisible();
  await zoe.context().close();
});
