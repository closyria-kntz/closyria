import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { AUTO_SHOP, autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Acheter ensemble, task 6: her side (spec § 4). She opens a group order from « Partage » with a delivery option of
// the shop, follows it on its page, takes her own items, takes out a friend's line, closes, reopens, orders with
// corrected prices (the 🎁 window first), ticks « Payé », cancels another one and finds it in the past ones.

const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};
const setTheme = (page: Page, theme: string) =>
  page.evaluate((id) => {
    document.documentElement.dataset.theme = id;
  }, theme);
/** Light and dark captures, axe in both. */
async function capture(page: Page, name: string, outputPath: (name: string) => string): Promise<void> {
  await axe(page);
  await page.screenshot({ path: outputPath(`${name}-light.png`), fullPage: true });
  await setTheme(page, "equilibre-dark");
  await page.screenshot({ path: outputPath(`${name}-dark.png`), fullPage: true });
  await axe(page);
  await setTheme(page, "equilibre");
}

const FIRST = "Robe Lina";
const SECOND = "Sac Mila";
type Db = Parameters<typeof sessionsOf>[0];
type Owner = { userId: string; listId: string; token: string; shopId: string; items: [string, string] };

/** Camille keeps two products of the fake shop (23 € each, sizes S and M) in « Anniversaire », shared, gifts on. */
async function ownerList(page: Page, db: Db, userAgentTag: string): Promise<Owner> {
  for (let i = 0; i < 2; i += 1) {
    await page.goto("/");
    await page.getByLabel("Coller un lien").fill(autoProductUrl());
    await page.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
    await keepWish(page);
  }
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
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
  const listId = await newList(page, db, "Anniversaire", [first.id, second.id]);
  const shared = await page.request.post(`/api/me/wishlists/${listId}/share`, { data: {} });
  expect(shared.status()).toBe(200);
  const url = ((await shared.json()) as { url: string }).url;
  const gifts = await page.request.patch(`/api/me/wishlists/${listId}`, { data: { allowGifts: true } });
  expect(gifts.status()).toBe(200);
  return { userId, listId, token: url.split("/").at(-1) ?? "", shopId: first.shop_id, items: [first.id, second.id] };
}

async function newList(page: Page, db: Db, name: string, itemIds: string[]): Promise<string> {
  const created = await page.request.post("/api/me/wishlists", { data: { name } });
  expect(created.status()).toBe(201);
  const listId = ((await created.json()) as { id: string }).id;
  for (const [index, itemId] of itemIds.entries()) {
    await db.query("insert into wishlist_items (wishlist_id, item_id, position) values ($1, $2, $3)", [
      listId,
      itemId,
      index,
    ]);
  }
  return listId;
}

/** A delivery option of the shop, written by the admin API (she is made admin for that call only). */
async function adminOption(page: Page, db: Db, owner: Owner, userAgentTag: string, label: string): Promise<void> {
  await db.query(`update "user" set role = 'admin' where id = $1`, [owner.userId]);
  await db.query(
    "update session set auth_method = 'passkey' where user_id = $1 and right(user_agent, length($2)) = $2",
    [owner.userId, userAgentTag],
  );
  const res = await page.request.post(`/api/admin/shops/${owner.shopId}/shipping-options`, {
    data: { label, shippingCents: 490, freeFromCents: 8000 },
  });
  expect(res.status(), await res.text()).toBe(201);
  await db.query(`update "user" set role = 'user' where id = $1`, [owner.userId]);
}

/** A friend's own browser: no session, her own address. */
async function friend(browser: Browser, baseURL: string | undefined, address: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: address },
  });
  return context.newPage();
}
const deviceOf = (name: string) => `device-${name.normalize("NFD").replace(/[^A-Za-z]/g, "")}-0123456789abcdef`;

/** The text with any space before « € » (Intl writes a no-break one). */
const euros = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ €/g, "\\s€"));
const appToast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const warning = (page: Page) => page.getByRole("dialog", { name: "Attends un peu 🎁" });
const pageUrl = (listId: string) => new RegExp(`/listes/${listId}/commande-groupee$`);

test("sa commande groupée, de l'ouverture au paiement", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  const relay = `Relais ${randomUUID().slice(0, 6)}`;
  await adminOption(page, db, owner, userAgentTag, relay);

  // « Ouvrir une commande groupée » from « Partage »: the shop of her items, the admin's option, a deadline.
  await page.goto(`/listes/${owner.listId}`);
  const share = page.getByRole("region", { name: "Partage" });
  await share.getByRole("button", { name: "Ouvrir une commande groupée" }).click();
  const opening = page.getByRole("dialog", { name: "Ouvrir une commande groupée" });
  await expect(opening.getByLabel("Boutique")).toHaveValue(owner.shopId);
  const option = opening.getByRole("radio", { name: new RegExp(relay) });
  await expect(option).toBeVisible();
  await expect(opening.getByRole("radio", { name: "Autre" })).toBeVisible();
  await option.check();
  await opening.getByLabel("Date limite (facultatif)").fill("2027-03-12");
  await capture(page, "open-dialog", (name) => testInfo.outputPath(name));
  await opening.getByRole("button", { name: "Ouvrir la commande" }).click();
  await expect(page).toHaveURL(pageUrl(owner.listId));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `Commande groupée chez ${AUTO_SHOP.name}, jusqu'au 12\u00a0mars`,
  );
  await expect(page.getByText(euros(`${relay} · port 4,90 € · offerte dès 80 €`))).toBeVisible();
  await expect(page.getByText(euros("Total 0 € · Plus que 80 € pour la livraison offerte"))).toBeVisible();
  const { rows: opened } = await db.query<{ shipping_label: string; shipping_cents: number }>(
    "select shipping_label, shipping_cents from group_orders where wishlist_id = $1",
    [owner.listId],
  );
  expect(opened).toEqual([{ shipping_label: relay, shipping_cents: 490 }]);

  // The banner of « Mes envies » leads back to it; « Partage » too.
  await page.goto("/envies");
  const banner = page.getByRole("region", { name: "Commande groupée en cours" });
  await expect(banner).toContainText(`Commande groupée chez ${AUTO_SHOP.name} en cours`);
  await banner.getByRole("link", { name: "Voir" }).click();
  await expect(page).toHaveURL(pageUrl(owner.listId));

  // Her own items: ticked, with a size. While a tick is being saved, « J'ai commandé » waits for it.
  const me = page.getByRole("region", { name: "Toi" });
  const mine = (name: string) => me.getByRole("listitem").filter({ hasText: name });
  const orderedButton = page.getByRole("button", { name: "J'ai commandé" });
  await expect(page.getByTestId("group-total")).toHaveCount(0);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/own-lines$/, async (route) => {
    await held;
    await route.continue();
  });
  await mine(FIRST)
    .getByRole("checkbox", { name: /Je le prends dans cette commande/ })
    .check();
  await expect(orderedButton).toBeDisabled();
  release();
  await expect(orderedButton).toBeEnabled();
  await page.unroute(/\/own-lines$/);
  await mine(FIRST)
    .getByLabel(/^Taille/)
    .selectOption("M");
  await mine(SECOND)
    .getByRole("checkbox", { name: /Je le prends dans cette commande/ })
    .check();
  await mine(SECOND)
    .getByLabel(/^Taille/)
    .selectOption("S");
  await expect(me).toContainText(euros("Articles 46 € + port 4,90 € = 50,90 €"));
  await expect(page.getByText(euros("Total 46 € · Plus que 34 € pour la livraison offerte"))).toBeVisible();
  await expect
    .poll(async () => {
      const { rows } = await db.query<{ size_label: string | null }>(
        `select l.size_label from group_order_lines l join group_orders o on o.id = l.group_order_id
         where o.wishlist_id = $1 and l.buyer_name_key is null order by l.size_label`,
        [owner.listId],
      );
      return rows.map((r) => r.size_label);
    })
    .toEqual(["M", "S"]);

  // Léa adds the first item through her link: on the page at the next read (every 10 s).
  const lea = await friend(browser, baseURL, `10.231.${testInfo.workerIndex % 250}.1`);
  const added = await lea.request.post(`/api/shared/${owner.token}/group-order/lines`, {
    data: {
      source: "item",
      itemId: owner.items[0],
      sizeLabel: "M",
      quantity: 1,
      name: "Léa",
      deviceKey: deviceOf("Léa"),
    },
  });
  expect(added.status(), await added.text()).toBe(201);
  const leaBlock = page.getByRole("region", { name: "Léa" });
  await expect(leaBlock).toContainText(FIRST, { timeout: 15_000 });
  await expect(leaBlock).toContainText(euros("Articles 23 € + port 2,45 € = 25,45 €"));
  await expect(me).toContainText(euros("Articles 46 € + port 2,45 € = 48,45 €"));

  // « Retirer » her line, then « Annuler » puts it back.
  await leaBlock.getByRole("button", { name: /^Retirer/ }).click();
  await expect(appToast(page)).toContainText("Ligne de Léa retirée");
  await expect(leaBlock.getByTestId("removed-line")).toContainText(FIRST);
  await expect(me).toContainText(euros("Articles 46 € + port 4,90 € = 50,90 €"));
  await appToast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(leaBlock.getByTestId("removed-line")).toHaveCount(0);
  await expect(leaBlock).toContainText(euros("Articles 23 € + port 2,45 € = 25,45 €"));

  // « Clôturer », « Rouvrir », « Clôturer ».
  const state = page.getByTestId("group-state");
  await expect(state).toHaveText("Ouverte : tes amies peuvent ajouter leurs articles.");
  await page.getByRole("button", { name: "Clôturer" }).click();
  await expect(state).toHaveText("Close : tes amies ne peuvent plus rien ajouter.");
  await page.getByRole("button", { name: "Rouvrir" }).click();
  await expect(state).toHaveText("Ouverte : tes amies peuvent ajouter leurs articles.");
  await page.getByRole("button", { name: "Clôturer" }).click();
  await expect(state).toHaveText("Close : tes amies ne peuvent plus rien ajouter.");
  await capture(page, "closed", (name) => testInfo.outputPath(name));

  // Inès plans to give her the second item: « J'ai commandé » asks first; « Attendre » leaves the order closed.
  const ines = await friend(browser, baseURL, `10.232.${testInfo.workerIndex % 250}.1`);
  const reserved = await ines.request.put(`/api/shared/${owner.token}/items/${owner.items[1]}/gift`, {
    data: { name: "Inès", deviceKey: deviceOf("Inès"), intent: "reserve" },
  });
  expect(reserved.status(), await reserved.text()).toBeLessThan(300);
  const orderedDialog = page.getByRole("dialog", { name: "J'ai commandé" });
  const fill = async () => {
    await page.getByRole("button", { name: "J'ai commandé" }).click();
    await expect(orderedDialog.getByLabel(`Prix de ${FIRST} (Camille)`)).toHaveValue("23");
    await expect(orderedDialog.getByLabel(`Prix de ${FIRST} (Léa)`)).toHaveValue("23");
    await expect(orderedDialog.getByLabel("Port payé")).toHaveValue("4,90");
    await orderedDialog.getByLabel(`Prix de ${FIRST} (Léa)`).fill("20");
    await orderedDialog.getByLabel("Port payé").fill("5,50");
  };
  await fill();
  await capture(page, "ordered-dialog", (name) => testInfo.outputPath(name));
  await orderedDialog.getByRole("button", { name: "Valider" }).click();
  await expect(warning(page)).toBeVisible();
  await warning(page).getByRole("button", { name: "Attendre" }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect(orderedDialog).toHaveCount(0);
  await expect(state).toHaveText("Close : tes amies ne peuvent plus rien ajouter.");
  const statusOf = async () =>
    (await db.query<{ status: string }>("select status from group_orders where wishlist_id = $1", [owner.listId]))
      .rows[0]?.status;
  expect(await statusOf()).toBe("closed");

  // Again, « Commander quand même »: what she corrected is still there; ordered, prices frozen, her items in « Commandé ».
  await page.getByRole("button", { name: "J'ai commandé" }).click();
  await expect(orderedDialog.getByLabel(`Prix de ${FIRST} (Léa)`)).toHaveValue("20");
  await expect(orderedDialog.getByLabel("Port payé")).toHaveValue("5,50");
  await orderedDialog.getByLabel(`Prix de ${SECOND} (Camille)`).fill("");
  await orderedDialog.getByRole("button", { name: "Valider" }).click();
  await expect(orderedDialog.getByRole("alert")).toHaveText("Indique le prix de chaque article.");
  await orderedDialog.getByLabel(`Prix de ${SECOND} (Camille)`).fill("23");
  await orderedDialog.getByRole("button", { name: "Valider" }).click();
  await warning(page).getByRole("button", { name: "Commander quand même" }).click();
  await expect(state).toHaveText(/^Commandé le \d{1,2}\s\S+\.$/);
  await expect(leaBlock).toContainText(euros("Doit 22,75 €"));
  await expect(me).toContainText(euros("Articles 46 € + port 2,75 € = 48,75 €"));
  // At the top, what it came to: 46 € + 20 € + 5,50 € of shipping.
  await expect(page.getByTestId("group-total")).toHaveText(euros("Total 71,50 €"));
  await expect(page.getByRole("button", { name: /Clôturer|Rouvrir|J'ai commandé|Annuler la commande/ })).toHaveCount(0);
  expect(await statusOf()).toBe("ordered");
  const stages = await db.query<{ stage: string }>("select stage from items where id = any($1)", [owner.items]);
  expect(stages.rows.map((r) => r.stage)).toEqual(["ordered", "ordered"]);

  // « Payé », then taken back.
  const paid = leaBlock.getByRole("checkbox", { name: /^Payé/ });
  await paid.check();
  await expect(paid).toBeChecked();
  const paidAt = async () =>
    (
      await db.query<{ paid_at: Date | null }>(
        `select p.paid_at from group_order_payments p join group_orders o on o.id = p.group_order_id
         where o.wishlist_id = $1`,
        [owner.listId],
      )
    ).rows[0]?.paid_at ?? null;
  await expect.poll(paidAt).not.toBeNull();
  await capture(page, "ordered", (name) => testInfo.outputPath(name));
  await paid.uncheck();
  await expect(paid).not.toBeChecked();
  await expect.poll(paidAt).toBeNull();

  // « Commandes groupées passées » on the list.
  await page.goto(`/listes/${owner.listId}`);
  const past = page.getByRole("region", { name: "Commandes groupées passées" });
  await expect(past).toContainText(AUTO_SHOP.name);
  await expect(past).toContainText(euros("Total 71,50 €"));
  await expect(past).toContainText("1 amie n'a pas encore payé");
  await expect(
    page.getByRole("region", { name: "Partage" }).getByRole("button", { name: "Ouvrir une commande groupée" }),
  ).toBeVisible();
  await capture(page, "past", (name) => testInfo.outputPath(name));

  // Long after (past the 30 days of the list's current one), it still opens from the list, « Payé » to tick.
  await db.query("update group_orders set ordered_at = now() - interval '40 days' where wishlist_id = $1", [
    owner.listId,
  ]);
  await page.reload();
  await past.getByRole("link", { name: /^Voir/ }).click();
  await expect(page).toHaveURL(new RegExp(`/listes/${owner.listId}/commande-groupee\\?commande=[0-9a-f-]{36}$`));
  await expect(page.getByTestId("group-state")).toHaveText(/^Commandé le \d{1,2}\s\S+\.$/);
  await expect(page.getByTestId("group-total")).toHaveText(euros("Total 71,50 €"));
  await expect(
    page.getByRole("button", { name: /Clôturer|Rouvrir|J'ai commandé|Annuler la commande|Retirer/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Toi" }).getByRole("checkbox").first()).toBeDisabled();
  const oldPaid = page.getByRole("region", { name: "Léa" }).getByRole("checkbox", { name: /^Payé/ });
  await oldPaid.check();
  await expect.poll(paidAt).not.toBeNull();
  await page.goto(`/listes/${owner.listId}`);
  await expect(past).toContainText("Tout est payé ✓");

  await lea.context().close();
  await ines.context().close();
});

test("annuler une commande groupée", async ({ page, db, userAgentTag }, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  const other = await newList(page, db, "Vacances", [owner.items[0]]);
  expect((await page.request.post(`/api/me/wishlists/${other}/share`, { data: {} })).status()).toBe(200);
  const opened = await page.request.post(`/api/me/wishlists/${other}/group-order`, {
    data: {
      shopId: owner.shopId,
      shipping: { label: "Colissimo", shippingCents: 690, freeFromCents: null },
      deadline: null,
    },
  });
  expect(opened.status()).toBe(201);

  // The list's page: a banner and a link from « Partage ».
  await page.goto(`/listes/${other}`);
  await expect(page.getByRole("region", { name: "Commande groupée en cours" })).toContainText(
    `Commande groupée chez ${AUTO_SHOP.name} en cours`,
  );
  await page.getByRole("region", { name: "Partage" }).getByRole("link", { name: "Voir la commande groupée" }).click();
  await expect(page).toHaveURL(pageUrl(other));
  await expect(page.getByText(euros("Total 0 € · Port 6,90 €, partagé entre celles qui commandent"))).toBeVisible();

  // « Garder » keeps it; « Oui, annuler » cancels it.
  await page.getByRole("button", { name: "Annuler la commande groupée" }).click();
  const confirm = page.getByRole("dialog", { name: "Annuler la commande groupée ?" });
  await axe(page);
  await confirm.getByRole("button", { name: "Garder" }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler la commande groupée" }).click();
  await confirm.getByRole("button", { name: "Oui, annuler" }).click();
  await expect(page.getByTestId("group-state")).toHaveText("Commande annulée.");
  await capture(page, "cancelled", (name) => testInfo.outputPath(name));

  await page.goto("/envies");
  await expect(page.getByTestId("item-card").first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Commande groupée en cours" })).toHaveCount(0);
  await page.goto(`/listes/${other}`);
  await expect(page.getByRole("region", { name: "Commandes groupées passées" })).toContainText("Annulée le");
});
