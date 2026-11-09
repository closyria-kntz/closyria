import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Offrir, task 5: her side (spec § 4). The setting on the list, the « Attends un peu 🎁 » window before she buys
// an item a friend plans to give, « Reçu en cadeau » and the reminder after the date. Never a trace of who reserved.

const appToast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};
const setTheme = (page: Page, theme: string) =>
  page.evaluate((id) => {
    document.documentElement.dataset.theme = id;
  }, theme);
/** Light and dark captures of the moment, for the design review (kept with the test's results). */
async function capture(page: Page, name: string, outputPath: (name: string) => string): Promise<void> {
  await page.screenshot({ path: outputPath(`owner-${name}-light.png`), fullPage: true });
  await setTheme(page, "equilibre-dark");
  await page.screenshot({ path: outputPath(`owner-${name}-dark.png`), fullPage: true });
  await axe(page);
  await setTheme(page, "equilibre");
}

const NAMES = ["Robe Lina", "Sac Mila", "Gilet Nora"] as const;
type Db = Parameters<typeof sessionsOf>[0];
type Owner = { userId: string; listId: string; token: string; items: { id: string; productId: string }[] };

/** Camille keeps three products and puts them in « Anniversaire », shared. */
async function ownerList(page: Page, db: Db, userAgentTag: string): Promise<Owner> {
  for (let i = 0; i < NAMES.length; i += 1) {
    await page.goto("/");
    await page.getByLabel("Coller un lien").fill(autoProductUrl());
    await page.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
    await keepWish(page);
  }
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  await db.query(`update "user" set name = 'Camille Durand', is_anonymous = false where id = $1`, [userId]);
  const { rows } = await db.query<{ id: string; product_id: string }>(
    "select id, product_id from items where user_id = $1 order by created_at, id",
    [userId],
  );
  expect(rows).toHaveLength(NAMES.length);
  for (const [index, row] of rows.entries()) {
    await db.query("update products set name = $2 where id = $1", [row.product_id, NAMES[index]]);
  }
  const created = await page.request.post("/api/me/wishlists", { data: { name: "Anniversaire" } });
  expect(created.status()).toBe(201);
  const listId = ((await created.json()) as { id: string }).id;
  for (const [index, row] of rows.entries()) {
    await db.query("insert into wishlist_items (wishlist_id, item_id, position) values ($1, $2, $3)", [
      listId,
      row.id,
      index,
    ]);
  }
  const shared = await page.request.post(`/api/me/wishlists/${listId}/share`, { data: {} });
  expect(shared.status()).toBe(200);
  const url = ((await shared.json()) as { url: string }).url;
  return {
    userId,
    listId,
    token: url.split("/").at(-1) ?? "",
    items: rows.map((row) => ({ id: row.id, productId: row.product_id })),
  };
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

/** A friend reserves (or joins) through the link's API, with her own device. */
async function gift(friendPage: Page, token: string, itemId: string, name: string, intent: "reserve" | "join") {
  const deviceKey = `device-${name.normalize("NFD").replace(/[^A-Za-z]/g, "")}-0123456789abcdef`;
  const res = await friendPage.request.put(`/api/shared/${token}/items/${itemId}/gift`, {
    data: { name, deviceKey, intent },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
}

/** Today in Paris (the reminder's day), moved by `days`. */
function parisDay(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const card = (page: Page, name: string) => page.getByTestId("item-card").filter({ hasText: name });
const warning = (page: Page) => page.getByRole("dialog", { name: "Attends un peu 🎁" });

test("réglage des cadeaux sur la liste", async ({ page, db, userAgentTag }, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  await page.goto(`/listes/${owner.listId}`);
  const share = page.getByRole("region", { name: "Partage" });
  const toggle = share.getByRole("switch", { name: "Mes amies peuvent m'offrir des articles" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(share.getByLabel("Occasion")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const occasion = share.getByLabel("Occasion");
  await occasion.fill("mon anniversaire");
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(owner.listId));
  await occasion.press("Enter");
  expect((await saved).status()).toBe(200);
  const dated = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(owner.listId));
  await share.getByLabel("Date", { exact: true }).fill("2027-03-12");
  expect((await dated).status()).toBe(200);
  await capture(page, "share", (name) => testInfo.outputPath(name));

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(share.getByLabel("Occasion")).toHaveValue("mon anniversaire");
  await expect(share.getByLabel("Date", { exact: true })).toHaveValue("2027-03-12");

  // Off: she is told what it does to her friends; « Annuler » keeps it on.
  await toggle.click();
  const confirm = page.getByRole("dialog");
  await expect(
    confirm.getByText("Si des amies avaient prévu des cadeaux, elles ne pourront plus les voir."),
  ).toBeVisible();
  await axe(page);
  await confirm.getByRole("button", { name: "Annuler" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  const cut = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes(owner.listId));
  await confirm.getByRole("button", { name: "Couper" }).click();
  expect((await cut).status()).toBe(200);
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  const { rows } = await db.query<{ allow_gifts: boolean; gift_occasion: string | null }>(
    "select allow_gifts, gift_occasion from wishlists where id = $1",
    [owner.listId],
  );
  // The occasion stays for when she turns it back on.
  expect(rows[0]).toEqual({ allow_gifts: false, gift_occasion: "mon anniversaire" });

  // Stopping the share says it too, while gifts are on.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await share.getByRole("button", { name: "Arrêter le partage" }).click();
  await expect(
    page.getByRole("dialog").getByText("Si des amies avaient prévu des cadeaux, elles ne pourront plus les voir."),
  ).toBeVisible();
});

test("avertissement, reçu en cadeau, aucune trace des réservations", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  await setGifts(page, owner.listId, { allowGifts: true, giftOccasion: "mon anniversaire", giftDate: "2027-03-12" });
  const [first, second, third] = owner.items as [Owner["items"][0], Owner["items"][0], Owner["items"][0]];
  const lea = await friend(browser, baseURL, `10.221.${testInfo.workerIndex % 250}.1`);
  const ines = await friend(browser, baseURL, `10.222.${testInfo.workerIndex % 250}.1`);
  await gift(lea, owner.token, first.id, "Léa", "reserve");
  await gift(ines, owner.token, first.id, "Inès", "join");
  await gift(lea, owner.token, second.id, "Léa", "reserve");

  // No trace on her pages, and nothing asked about gifts while she only looks.
  const checks: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("gift-check")) checks.push(request.url());
  });
  for (const path of ["/envies", `/listes/${owner.listId}`, `/produits/${first.productId}`]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page
        .getByTestId("item-card")
        .or(page.getByRole("heading", { name: "Mon article" }))
        .first(),
    ).toBeVisible();
    const text = await page.locator("body").innerText();
    expect(text, path).not.toContain("Léa");
    expect(text, path).not.toContain("Réservé");
  }
  expect(checks).toEqual([]);

  // A free item: « Je le prends » without a window.
  await page.goto("/envies");
  await card(page, NAMES[2]).getByTestId("card-take").click();
  await expect(card(page, NAMES[2]).getByTestId("card-take")).toHaveAttribute("aria-pressed", "true");
  await expect(warning(page)).toHaveCount(0);
  // Asked once, right before taking it.
  await expect.poll(() => checks.length).toBe(1);

  // A reserved one: the window; « Attendre » takes nothing.
  await card(page, NAMES[1]).getByTestId("card-take").click();
  await expect(warning(page)).toBeVisible();
  await expect(warning(page).getByText("Quelqu'un a peut-être prévu de te l'offrir.")).toBeVisible();
  await capture(page, "warning", (name) => testInfo.outputPath(name));
  await warning(page).getByRole("button", { name: "Attendre" }).click();
  await expect(warning(page)).toHaveCount(0);
  await expect(card(page, NAMES[1]).getByTestId("card-take")).toHaveAttribute("aria-pressed", "false");
  const ticked = async (id: string) =>
    (await db.query<{ in_order_draft: boolean }>("select in_order_draft from items where id = $1", [id])).rows[0]
      ?.in_order_draft;
  expect(await ticked(second.id)).toBe(false);

  // « J'ai commandé » with two reserved items of three: one window, « Attendre » orders nothing.
  await db.query("update items set in_order_draft = true where id = any($1)", [[first.id, second.id]]);
  await page.reload();
  await page.getByRole("button", { name: "J’ai commandé (3)" }).click();
  await expect(warning(page).getByText("Quelqu'un a peut-être prévu de t'offrir 2 de ces articles.")).toBeVisible();
  await expect(warning(page).getByRole("button", { name: "Commander quand même" })).toBeVisible();
  await warning(page).getByRole("button", { name: "Attendre" }).click();
  await expect(warning(page)).toHaveCount(0);
  const stages = await db.query<{ stage: string }>("select stage from items where user_id = $1", [owner.userId]);
  expect(stages.rows.map((r) => r.stage)).toEqual(["spotted", "spotted", "spotted"]);

  // « Je le prends quand même »: taken, and her friends see she took it herself.
  await card(page, NAMES[1]).getByTestId("card-take").click();
  await expect(card(page, NAMES[1]).getByTestId("card-take")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => ticked(second.id)).toBe(false);
  await card(page, NAMES[1]).getByTestId("card-take").click();
  await warning(page).getByRole("button", { name: "Je le prends quand même" }).click();
  await expect(card(page, NAMES[1]).getByTestId("card-take")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => ticked(second.id)).toBe(true);
  await lea.goto(`/l/${owner.token}`);
  await expect(
    lea.getByRole("list", { name: "Articles" }).getByRole("listitem").filter({ hasText: NAMES[1] }),
  ).toContainText("Camille l'a pris elle-même");

  // « Reçu en cadeau » from « … »: to the wardrobe; « Annuler » puts it back.
  await card(page, NAMES[0])
    .getByRole("button", { name: `Plus d’actions pour ${NAMES[0]}` })
    .click();
  await page.getByRole("button", { name: "Reçu en cadeau" }).click();
  await expect(card(page, NAMES[0])).toHaveCount(0);
  await expect(appToast(page)).toContainText("Reçu en cadeau");
  await appToast(page).getByRole("button", { name: "Annuler" }).last().click();
  await expect(card(page, NAMES[0])).toHaveCount(1);
  const stageOf = async (id: string) =>
    (await db.query<{ stage: string }>("select stage from items where id = $1", [id])).rows[0]?.stage;
  expect(await stageOf(first.id)).toBe("spotted");

  // From the sheet: « Offert par Léa et Inès ».
  await page.goto(`/produits/${first.productId}`);
  await page.getByRole("button", { name: "Reçu en cadeau" }).click();
  await expect(page.getByText("Offert par Léa et Inès")).toBeVisible();
  expect(await stageOf(first.id)).toBe("owned");
  await expect(page.getByRole("button", { name: "Reçu en cadeau" })).toHaveCount(0);
  await capture(page, "fiche", (name) => testInfo.outputPath(name));

  // Nobody had planned the third: « Offert par une amie ».
  await page.goto(`/produits/${third.productId}`);
  await page.getByRole("button", { name: "Reçu en cadeau" }).click();
  await expect(page.getByText("Offert par une amie")).toBeVisible();

  await lea.context().close();
  await ines.context().close();
});

test("passer à Commandé avertit aussi (fiche et sélection)", async ({
  page,
  browser,
  baseURL,
  db,
  userAgentTag,
}, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  await setGifts(page, owner.listId, { allowGifts: true });
  const [first] = owner.items as [Owner["items"][0]];
  const lea = await friend(browser, baseURL, `10.223.${testInfo.workerIndex % 250}.1`);
  await gift(lea, owner.token, first.id, "Léa", "reserve");

  // The sheet's stages: « Commandé » then its date, then the window.
  await page.goto(`/produits/${first.productId}`);
  await page.getByRole("button", { name: "Passer à « Commandé »" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Valider" }).click();
  await expect(warning(page)).toBeVisible();
  await warning(page).getByRole("button", { name: "Attendre" }).click();
  const stageOf = async () =>
    (await db.query<{ stage: string }>("select stage from items where id = $1", [first.id])).rows[0]?.stage;
  expect(await stageOf()).toBe("spotted");

  // Several selected: the stage waits too.
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  for (const name of NAMES) await card(page, name).getByRole("button").first().click();
  await page.getByRole("region", { name: "Actions sur la sélection" }).getByRole("button", { name: "Étape" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reçu" }).click();
  await expect(warning(page).getByText("Quelqu'un a peut-être prévu de te l'offrir.")).toBeVisible();
  await warning(page).getByRole("button", { name: "Je le prends quand même" }).click();
  await expect(appToast(page)).toContainText("3 articles passés à « Reçu »");
  await expect.poll(stageOf).toBe("owned");
  await lea.context().close();
});

test("rappel après la date de l'occasion", async ({ page, db, userAgentTag }, testInfo) => {
  test.slow();
  const owner = await ownerList(page, db, userAgentTag);
  await setGifts(page, owner.listId, { allowGifts: true, giftOccasion: "mon anniversaire", giftDate: parisDay(-1) });
  const text = "Mon anniversaire est passé : tu as reçu des cadeaux de ta liste « Anniversaire » ?";

  await page.goto("/envies");
  const banner = page.getByRole("region", { name: "Rappel des cadeaux" });
  await expect(banner).toContainText(text);
  await capture(page, "reminder", (name) => testInfo.outputPath(name));
  await banner.getByRole("button", { name: "Plus tard" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("item-card").first()).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Another date: due again, on the list's page; « C'est fait » ends it for this occasion.
  await setGifts(page, owner.listId, { giftDate: parisDay(-2) });
  await page.goto(`/listes/${owner.listId}`);
  await expect(banner).toContainText(text);
  await capture(page, "reminder-list", (name) => testInfo.outputPath(name));
  await banner.getByRole("button", { name: "C'est fait" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Anniversaire" })).toBeVisible();
  await expect(banner).toHaveCount(0);

  // From « Mes envies », the banner opens the list.
  await setGifts(page, owner.listId, { giftDate: parisDay(-3) });
  await page.goto("/envies");
  await banner.getByRole("link", { name: "Ouvrir la liste" }).click();
  await expect(page).toHaveURL(new RegExp(`/listes/${owner.listId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Anniversaire" })).toBeVisible();
});
