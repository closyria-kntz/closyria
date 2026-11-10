import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { AUTO_SHOP, autoProductUrl, keepWish, manualProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Acheter ensemble, task 5: on a shared list with a group order, friends add their items, see the way to free
// shipping and their share, then the order closes, is ordered and paid (spec §3).

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

type Owner = { shareUrl: string; listId: string; orderId: string };

/**
 * The owner (« Camille ») keeps two products of the fake shop (23 € each), puts them in a shared list
 * « Anniversaire » and opens a group order there: delivery 6,90 €, free from 80 €, until 12 March.
 */
async function groupList(page: Page, db: Parameters<typeof sessionsOf>[0], userAgentTag: string): Promise<Owner> {
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
  const { rows } = await db.query<{ id: string; product_id: string; shop_id: string }>(
    `select i.id, i.product_id, p.shop_id from items i join products p on p.id = i.product_id
     where i.user_id = $1 order by i.created_at, i.id`,
    [userId],
  );
  expect(rows).toHaveLength(2);
  const [first, second] = rows as [(typeof rows)[number], (typeof rows)[number]];
  await db.query("update products set name = $2 where id = $1", [first.product_id, FIRST]);
  await db.query("update products set name = $2 where id = $1", [second.product_id, SECOND]);

  const created = await page.request.post("/api/me/wishlists", { data: { name: "Anniversaire" } });
  expect(created.status()).toBe(201);
  const listId = ((await created.json()) as { id: string }).id;
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

  const opened = await page.request.post(`/api/me/wishlists/${listId}/group-order`, {
    data: {
      shopId: first.shop_id,
      shipping: { label: "Colissimo", shippingCents: 690, freeFromCents: 8000 },
      deadline: "2027-03-12",
    },
  });
  expect(opened.status()).toBe(201);
  const orderId = ((await opened.json()) as { id: string }).id;
  return { shareUrl, listId, orderId };
}

type OwnerView = { people: { key: string; name: string; lines: { id: string; name: string }[] }[] };
async function ownerView(page: Page, listId: string): Promise<OwnerView> {
  const res = await page.request.get(`/api/me/wishlists/${listId}/group-order`);
  expect(res.status()).toBe(200);
  return (await res.json()) as OwnerView;
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
const banner = (page: Page) => page.getByTestId("group-banner");
const summary = (page: Page) => page.getByRole("region", { name: "Commande groupée" });

/** « Je le prends aussi » on an item: size, quantity, her name if asked. */
async function takeToo(page: Page, itemName: string, size: string, name?: string): Promise<void> {
  await itemOf(page, itemName)
    .getByRole("button", { name: /^Je le prends aussi/ })
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  if (size) await sheet.getByLabel("Taille").selectOption(size);
  if (name) await sheet.getByLabel("Ton prénom").fill(name);
  await sheet.getByRole("button", { name: "Je le prends aussi" }).click();
  await expect(sheet).toBeHidden();
}

/** The text with any space before « € » (Intl writes a no-break one). */
const euros = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ €/g, "\\s€"));

test("des amies achètent ensemble chez la même boutique", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const owner = await groupList(page, db, userAgentTag);
  const lea = await friend(browser, baseURL, `10.221.${testInfo.workerIndex % 250}.1`);
  const ines = await friend(browser, baseURL, `10.222.${testInfo.workerIndex % 250}.1`);

  // The banner and the button on each item of the shop.
  await lea.goto(owner.shareUrl);
  await expect(banner(lea)).toContainText(
    `Commande groupée chez ${AUTO_SHOP.name} avec Camille, jusqu'au 12\u00a0mars`,
  );
  await expect(banner(lea)).toContainText(euros("Total 0 € · Plus que 80 € pour la livraison offerte"));
  await axe(lea);

  // Léa takes the first item too, in M (a size the shop gives): her name is asked once.
  await itemOf(lea, FIRST)
    .getByRole("button", { name: /^Je le prends aussi/ })
    .click();
  const sheet = lea.getByRole("dialog");
  await expect(sheet.getByLabel("Quantité")).toHaveValue("1");
  const sizes = sheet.getByLabel("Taille").getByRole("option");
  await expect(sizes).toHaveText(["Taille non précisée", "S", "M"]);
  await sheet.getByLabel("Taille").selectOption("M");
  await sheet.getByLabel("Ton prénom").fill("Léa");
  await axe(lea);
  await sheet.getByRole("button", { name: "Je le prends aussi" }).click();
  await expect(sheet).toBeHidden();
  const leaFirst = itemOf(lea, FIRST);
  await expect(leaFirst.getByText("Tu le prends aussi (M × 1)")).toBeVisible();
  await expect(leaFirst.getByRole("button", { name: /^Modifier/ })).toBeFocused();
  // Still offered: the same item in another size.
  await expect(leaFirst.getByRole("button", { name: /^Je le prends aussi/ })).toBeVisible();
  await expect(banner(lea)).toContainText(euros("Total 23 € · Plus que 57 € pour la livraison offerte"));
  await expect(summary(lea)).toContainText("Léa");
  await expect(summary(lea)).toContainText(euros("Ta part : 29,90 € (articles 23 € + port 6,90 €)"));
  await expect(summary(lea)).toContainText("provisoire");

  // Inès: a link of another shop is refused, one of the same shop is read.
  await ines.goto(owner.shareUrl);
  await expect(itemOf(ines, FIRST).getByText("Tu le prends aussi", { exact: false })).toHaveCount(0);
  await expect(summary(ines)).toContainText(FIRST);
  await expect(summary(ines).getByText("Ta part", { exact: false })).toHaveCount(0);
  await summary(ines).getByRole("button", { name: "Ajouter un autre article" }).click();
  const add = ines.getByRole("dialog");
  await add.getByLabel(/Lien de l'article/).fill(manualProductUrl());
  await add.getByLabel("Ton prénom").fill("Inès");
  await add.getByRole("button", { name: "Ajouter" }).click();
  await expect(add.getByRole("alert")).toHaveText(`Ce lien n'est pas chez ${AUTO_SHOP.name}.`);
  // While the page is read, the line says so (the answer is held as « reading » until released).
  let reading = true;
  await ines.route(/\/api\/shared\/[^/]+$/, async (route) => {
    if (!reading || route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as {
      groupOrder: { people: { lines: { itemId: string | null; name: string; status: string }[] }[] } | null;
    };
    for (const person of body.groupOrder?.people ?? [])
      for (const line of person.lines)
        if (line.itemId === null) Object.assign(line, { name: "", status: "reading", unitPriceCents: null });
    await route.fulfill({ response, json: body });
  });
  await add.getByLabel(/Lien de l'article/).fill(autoProductUrl());
  await add.getByRole("button", { name: "Ajouter" }).click();
  await expect(add).toBeHidden();
  await expect(summary(ines).getByText("Lecture de l'article…")).toBeVisible();
  reading = false;
  await expect(summary(ines).getByText(PRODUCT.name, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(summary(ines).getByText("Lecture de l'article…")).toHaveCount(0);
  await ines.unroute(/\/api\/shared\/[^/]+$/);
  await expect(banner(ines)).toContainText(euros("Total 46 € · Plus que 34 € pour la livraison offerte"));
  await expect(summary(ines)).toContainText(euros("Ta part : 26,45 € (articles 23 € + port 3,45 €)"));
  await ines.screenshot({ path: testInfo.outputPath("ines-light.png"), fullPage: true });
  await setTheme(ines, "equilibre-dark");
  await ines.screenshot({ path: testInfo.outputPath("ines-dark.png"), fullPage: true });
  await axe(ines);

  // The shop gives no price for her link: she types one, then corrects it with « Modifier ».
  const { rows: inesLines } = await db.query<{ product_id: string }>(
    "select product_id from group_order_lines where group_order_id = $1 and buyer_name = 'Inès'",
    [owner.orderId],
  );
  await db.query("update products set price_cents = null where id = $1", [inesLines[0]?.product_id]);
  const typePrice = async (price: string, before: string) => {
    await summary(ines)
      .getByRole("button", { name: /^Modifier/ })
      .click();
    const sheet = ines.getByRole("dialog");
    await expect(sheet.getByLabel("Nom de l'article")).toHaveValue(PRODUCT.name);
    await expect(sheet.getByLabel(/^Prix/)).toHaveValue(before);
    await sheet.getByLabel(/^Prix/).fill(price);
    await sheet.getByRole("button", { name: "Enregistrer" }).click();
    await expect(sheet).toBeHidden();
  };
  await ines.reload();
  await typePrice("25", "");
  await expect(summary(ines)).toContainText(euros("Ta part : 28,45 € (articles 25 € + port 3,45 €)"));
  await typePrice("23", "25,00");
  await expect(summary(ines)).toContainText(euros("Ta part : 26,45 € (articles 23 € + port 3,45 €)"));

  // Léa adds the second item, Camille takes it out: struck through for Léa only.
  await takeToo(lea, SECOND, "");
  await expect(itemOf(lea, SECOND).getByText("Tu le prends aussi (× 1)")).toBeVisible();
  // « Retirer », then « Annuler » takes it back (same size and quantity).
  await itemOf(lea, SECOND)
    .getByRole("button", { name: /^Retirer/ })
    .click();
  const toast = lea.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Retiré de la commande groupée");
  await expect(itemOf(lea, SECOND).getByText("Tu le prends aussi", { exact: false })).toHaveCount(0);
  await expect(itemOf(lea, SECOND).getByRole("button", { name: /^Je le prends aussi/ })).toBeFocused();
  await toast.getByRole("button", { name: "Annuler" }).click();
  await expect(itemOf(lea, SECOND).getByText("Tu le prends aussi (× 1)")).toBeVisible();
  const view = await ownerView(page, owner.listId);
  const leaPerson = view.people.find((p) => p.name === "Léa");
  const secondLine = leaPerson?.lines.find((l) => l.name === SECOND);
  const removed = await page.request.delete(`/api/me/group-orders/${owner.orderId}/lines/${secondLine?.id}`, {
    data: {},
  });
  expect(removed.status()).toBe(200);
  await lea.reload();
  const struck = summary(lea).getByTestId("removed-line");
  await expect(struck).toContainText(SECOND);
  await expect(struck).toContainText("Retiré par Camille");
  await expect(struck.getByText(SECOND)).toHaveCSS("text-decoration-line", "line-through");
  await ines.reload();
  await expect(ines.getByText("Retiré par Camille")).toHaveCount(0);

  // Léa takes three: free shipping.
  await leaFirst.getByRole("button", { name: /^Modifier/ }).click();
  const edit = lea.getByRole("dialog");
  await expect(edit.getByLabel("Taille")).toHaveValue("M");
  await edit.getByLabel("Quantité").selectOption("3");
  await edit.getByRole("button", { name: "Enregistrer" }).click();
  await expect(edit).toBeHidden();
  await expect(leaFirst.getByText("Tu le prends aussi (M × 3)")).toBeVisible();
  await expect(banner(lea)).toContainText(euros("Total 92 € · Livraison offerte ✓"));
  await expect(summary(lea)).toContainText(euros("Ta part : 69 € (articles 69 € + port 0 €)"));
  await lea.screenshot({ path: testInfo.outputPath("lea-light.png"), fullPage: true });
  await setTheme(lea, "equilibre-dark");
  await lea.screenshot({ path: testInfo.outputPath("lea-dark.png"), fullPage: true });
  await axe(lea);

  // Closed: nothing more to add or change.
  const closed = await page.request.post(`/api/me/group-orders/${owner.orderId}/action`, {
    data: { action: "close" },
  });
  expect(closed.status()).toBe(200);
  await lea.reload();
  await expect(banner(lea)).toContainText("Commande close, Camille va commander.");
  await expect(
    lea.getByRole("button", { name: /Je le prends aussi|Ajouter un autre article|Modifier|Retirer/ }),
  ).toHaveCount(0);

  // Ordered, then paid.
  const ordered = await page.request.post(`/api/me/group-orders/${owner.orderId}/order`, {
    data: { shippingCents: 690, lines: [] },
  });
  expect(ordered.status()).toBe(200);
  await lea.reload();
  await expect(banner(lea)).toContainText(/Commandé le \d{1,2}\s\S+\./);
  // Free shipping was reached, but she paid 6,90 €: split between Léa and Inès.
  await expect(summary(lea)).toContainText(euros("Tu dois 72,45 € à Camille"));
  await expect(summary(lea).getByText("provisoire")).toHaveCount(0);
  await axe(lea);
  const key = (await ownerView(page, owner.listId)).people.find((p) => p.name === "Léa")?.key ?? "";
  const paid = await page.request.put(`/api/me/group-orders/${owner.orderId}/payments/${encodeURIComponent(key)}`, {
    data: { paid: true },
  });
  expect(paid.status()).toBe(200);
  await lea.reload();
  await expect(summary(lea)).toContainText("Payé ✓");
  await expect(summary(lea).getByText("Tu dois", { exact: false })).toHaveCount(0);

  await lea.context().close();
  await ines.context().close();
});

test("le prénom de la fondatrice caché", async ({ page, browser, baseURL, db, userAgentTag }, testInfo) => {
  test.slow();
  const owner = await groupList(page, db, userAgentTag);
  await db.query("update wishlists set show_owner_name = false where id = $1", [owner.listId]);
  const zoe = await friend(browser, baseURL, `10.223.${testInfo.workerIndex % 250}.1`);
  await zoe.goto(owner.shareUrl);
  await expect(banner(zoe)).toContainText(`Commande groupée chez ${AUTO_SHOP.name}, jusqu'au 12\u00a0mars`);
  await expect(banner(zoe)).not.toContainText("avec");
  await takeToo(zoe, FIRST, "M", "Zoé");
  await expect(itemOf(zoe, FIRST).getByText("Tu le prends aussi (M × 1)")).toBeVisible();
  const closed = await page.request.post(`/api/me/group-orders/${owner.orderId}/action`, {
    data: { action: "close" },
  });
  expect(closed.status()).toBe(200);
  await zoe.reload();
  await expect(banner(zoe)).toContainText("Commande close, elle va commander.");
  const ordered = await page.request.post(`/api/me/group-orders/${owner.orderId}/order`, {
    data: { shippingCents: 690, lines: [] },
  });
  expect(ordered.status()).toBe(200);
  await zoe.reload();
  await expect(summary(zoe)).toContainText(euros("Tu dois 29,90 €"));
  await expect(summary(zoe)).not.toContainText("Tu dois 29,90 € à");
  await zoe.context().close();
});
