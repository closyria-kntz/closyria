import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { readCode, sessionsOf } from "../fixtures/auth";
import { AUTO_SHOP, autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// « Après la commande », task 7 (docs/specs/2026-11-14-apres-commande.md §3): her order address and its help, the
// order to validate on « Accueil » and in « Mes commandes » (correct, validate, dismiss, an unreadable e-mail typed by
// hand), a pasted tracking number, the parcel on its way then received with its return deadline, the return reminder
// as the « une », an Instagram link. No e-mail server nor carrier here: what they would write is seeded in the database.

type Db = Parameters<typeof sessionsOf>[0];

const main = (page: Page) => page.getByRole("main");

const axe = async (page: Page) => {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
};

async function axeLightAndDark(page: Page) {
  await page.emulateMedia({ colorScheme: "light" });
  await axe(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(true);
  await axe(page);
  await page.emulateMedia({ colorScheme: "light" });
}

/**
 * Screenshots for the founder (iPhone and computer, light and dark), only when `E2E_SHOTS_DIR` names a folder:
 * the suite itself never writes them.
 */
async function shots(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.E2E_SHOTS_DIR;
  if (!dir || testInfo.project.name === "iPad (gen 7)") return;
  await mkdir(dir, { recursive: true });
  const device = testInfo.project.name === "iPhone 15" ? "iphone" : "ordinateur";
  // The app scrolls inside its own frame: a tall window shows the whole page at once.
  const size = page.viewportSize();
  if (size) await page.setViewportSize({ width: size.width, height: Math.max(size.height, 2200) });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `${dir}/${name}-${device}-${scheme === "light" ? "clair" : "sombre"}.png` });
  }
  await page.emulateMedia({ colorScheme: "light" });
  if (size) await page.setViewportSize(size);
}

/** A session for this test's browser, made a real account (« Camille Durand », a verified address). */
async function account(page: Page, db: Db, userAgentTag: string) {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  await db.query(
    `update "user" set name = 'Camille Durand', is_anonymous = false, email = $2, email_verified = true where id = $1`,
    [userId, `camille-${userId}@example.com`],
  );
  // Her profiles are made on their first read.
  const profiles = await page.evaluate(async () => (await fetch("/api/me/profiles")).json());
  const profileId = (profiles as { profiles: { id: string }[] }).profiles[0]?.id ?? "";
  return { userId, profileId };
}
type Account = Awaited<ReturnType<typeof account>>;

async function autoShopId(db: Db): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select id from shops where slug = $1", [AUTO_SHOP.slug]);
  return rows[0]?.id ?? "";
}

/** A draft order read from one of her e-mails (as the worker files it), with its lines and parcel. */
async function draftOrder(
  db: Db,
  who: Account,
  lines: { name: string; size?: string; color?: string; priceCents?: number }[],
  options: { trackingNumber?: string; carrier?: string; ref?: string } = {},
) {
  const { rows } = await db.query<{ id: string }>(
    `insert into orders (user_id, profile_id, shop_id, external_ref, ordered_at, status, source, parse_method)
     values ($1, $2, $3, $4, now() - interval '1 day', 'draft', 'email', 'known') returning id`,
    [who.userId, who.profileId, await autoShopId(db), options.ref ?? "1042"],
  );
  const orderId = rows[0]?.id ?? "";
  for (const [position, line] of lines.entries()) {
    await db.query(
      `insert into order_lines (order_id, name, size_label, color, quantity, price_cents, currency, position)
       values ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        orderId,
        line.name,
        line.size ?? null,
        line.color ?? null,
        line.priceCents ?? null,
        line.priceCents === undefined ? null : "EUR",
        position,
      ],
    );
  }
  if (options.trackingNumber) {
    await db.query(
      `insert into parcels (order_id, carrier, tracking_number, status, next_check_at, check_until)
       values ($1, $2, $3, 'pending', now() + interval '6 hours', now() + interval '30 days')`,
      [orderId, options.carrier ?? null, options.trackingNumber],
    );
  }
  return orderId;
}

/** Her wish of the fake shop's product, through « Coller un lien »; its sheet stays open. */
async function pasteAndWish(page: Page, db: Db, userId: string) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  const { rows } = await db.query<{ id: string; product_id: string }>(
    "select id, product_id from items where user_id = $1 and deleted_at is null order by created_at desc limit 1",
    [userId],
  );
  const [item] = rows;
  if (!item) throw new Error("no item");
  return item;
}

/** « 29 novembre »: a Paris day as the page writes it. */
const frenchDay = (isoDay: string) =>
  new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDay}T00:00:00Z`),
  );

/** Today in Paris plus `days`, `YYYY-MM-DD`. */
async function parisDayPlus(db: Db, days: number): Promise<string> {
  const { rows } = await db.query<{ day: string }>(
    `select to_char((now() at time zone 'Europe/Paris')::date + $1::int, 'YYYY-MM-DD') as day`,
    [days],
  );
  return rows[0]?.day ?? "";
}

test("une invitée crée d'abord son compte pour suivre ses commandes", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  await page.goto("/reglages/commandes");
  await expect(main(page).getByRole("heading", { level: 2, name: "Mes commandes par e-mail" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Crée ton compte pour suivre tes commandes" })).toHaveAttribute(
    "href",
    "/connexion?next=%2Freglages%2Fcommandes",
  );
  await expect(main(page).getByRole("button", { name: "Copier" })).toHaveCount(0);
  await axeLightAndDark(page);

  await page.goto("/mes-commandes");
  await expect(main(page).getByRole("heading", { level: 1, name: "Mes commandes" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Crée ton compte pour suivre tes commandes" })).toHaveAttribute(
    "href",
    "/connexion?next=%2Fmes-commandes",
  );
  await axeLightAndDark(page);
});

test("réception pas encore en service : pas d'adresse, un message calme", async ({ page, db, userAgentTag }) => {
  const who = await account(page, db, userAgentTag);
  // The environment without INBOUND_EMAIL_SECRET, as the API answers it there (this suite's API receives e-mails).
  const posts: string[] = [];
  await page.route("**/api/me/order-inbox", async (route) => {
    if (route.request().method() !== "GET") {
      posts.push(route.request().method());
      return route.fulfill({ status: 409, json: { error: "inbound_off" } });
    }
    return route.fulfill({ json: { receiving: false, address: null, autoForward: false, pendingGmailCode: null } });
  });
  await page.goto("/reglages/commandes");
  const soon = main(page).getByTestId("order-inbox-soon");
  await expect(soon.getByRole("heading", { level: 3, name: "Bientôt disponible" })).toBeVisible();
  await expect(
    soon.getByText(
      "La réception des e-mails de commande arrive bientôt. En attendant, tu peux ajouter une commande à la main ou coller un numéro de suivi.",
    ),
  ).toBeVisible();
  await expect(soon.getByRole("link", { name: "Mes commandes" })).toHaveAttribute("href", "/mes-commandes");
  await expect(main(page).getByTestId("order-address")).toHaveCount(0);
  await expect(main(page).getByRole("region", { name: "Comment transférer tes e-mails" })).toHaveCount(0);
  expect(posts).toEqual([]);
  const { rows } = await db.query("select 1 from order_inboxes where user_id = $1", [who.userId]);
  expect(rows).toEqual([]);
  await axeLightAndDark(page);
});

test("son adresse de commandes : copier, changer, le code Gmail et l'aide pas à pas", async ({
  page,
  context,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  await page.goto("/compte");
  await main(page)
    .getByRole("link", { name: /^Mes commandes par e-mail/ })
    .click();
  await expect(page).toHaveURL(/\/reglages\/commandes$/);
  await expect(main(page).getByRole("heading", { level: 2, name: "Mes commandes par e-mail" })).toBeVisible();

  const box = main(page).getByRole("region", { name: "Ton adresse" });
  const address = box.getByTestId("order-address");
  await expect(address).toHaveText(/^camille-[a-z2-9]{4}@commandes\.dev\.closyria\.com$/);
  const first = (await address.textContent()) ?? "";

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const copy = box.getByRole("button", { name: "Copier" });
  expect((await copy.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await copy.click();
  await expect(box.getByRole("status")).toHaveText("Adresse copiée");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

  // The help, step by step, for her mailbox.
  const help = main(page).getByRole("region", { name: "Comment transférer tes e-mails" });
  for (const name of ["Gmail", "Outlook", "iCloud"]) await expect(help.getByText(name, { exact: true })).toBeVisible();
  // Gmail's automatic forwarding is not accepted here (INBOUND_AUTOFORWARD off, the default): only « Transférer »
  // one e-mail at a time is explained, for every mailbox.
  await help.getByText("Gmail", { exact: true }).click();
  await expect(help).toContainText("touche « Transférer », colle ton adresse Closyria et envoie");
  await expect(help).not.toContainText("automatiquement");
  await expect(help).not.toContainText("Créer un filtre");
  await axeLightAndDark(page);
  await shots(page, testInfo, "reglages-commandes");

  // Gmail's confirmation code is only for its automatic forwarding: not shown while it is off.
  await db.query(
    "update order_inboxes set gmail_code = '83920571', gmail_code_at = now() where user_id = $1 and active",
    [who.userId],
  );
  await page.reload();
  await expect(address).toHaveText(first);
  await expect(main(page).getByTestId("gmail-code")).toHaveCount(0);
  await expect(main(page)).not.toContainText("83920571");

  // « Changer d'adresse »: asked first, then the old one stops at once.
  await box.getByRole("button", { name: "Changer d'adresse" }).click();
  const dialog = page.getByRole("dialog", { name: "Changer d'adresse ?" });
  await expect(dialog).toContainText("L'ancienne adresse cessera aussitôt de fonctionner.");
  await dialog.getByRole("button", { name: "Changer d'adresse" }).click();
  await expect(address).not.toHaveText(first);
  await expect(address).toHaveText(/^camille-[a-z2-9]{4}@commandes\.dev\.closyria\.com$/);
  const { rows } = await db.query<{ active: boolean }>(
    "select active from order_inboxes where user_id = $1 order by created_at",
    [who.userId],
  );
  expect(rows.map((r) => r.active)).toEqual([false, true]);

  await main(page).getByRole("link", { name: "Voir mes commandes" }).click();
  await expect(page).toHaveURL(/\/mes-commandes$/);
  await expect(main(page).getByRole("heading", { name: "Pas encore de commande" })).toBeVisible();
  await axeLightAndDark(page);
});

test("ses adresses d'envoi : ajouter une autre boîte, recopier le code reçu, la retirer", async ({
  page,
  request,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  await page.goto("/reglages/commandes");
  await expect(main(page).getByRole("region", { name: "Ton adresse" })).toContainText(
    "Seuls les e-mails que tu transfères depuis tes adresses d'envoi (ci-dessous) sont lus.",
  );
  const senders = main(page).getByRole("region", { name: "Mes adresses d'envoi" });
  // Her account address comes first, always read, never removable.
  await expect(senders.getByRole("listitem").first()).toContainText(`camille-${who.userId}@example.com`);
  await expect(senders.getByRole("listitem").first()).toContainText("Adresse du compte");
  await expect(senders.getByRole("listitem").first().getByRole("button")).toHaveCount(0);

  const add = senders.getByRole("button", { name: "Ajouter une adresse" });
  expect((await add.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await add.click();
  const other = `camille-${who.userId}@hotmail.example`.toLowerCase();
  const field = senders.getByLabel("Adresse e-mail");
  await expect(field).toBeFocused();
  await field.fill("pas-une-adresse");
  await senders.getByRole("button", { name: "Envoyer le code" }).click();
  await expect(senders.getByRole("alert")).toHaveText("Vérifie l'adresse e-mail.");
  await field.fill(`  ${other.toUpperCase()} `);
  await senders.getByRole("button", { name: "Envoyer le code" }).click();
  await expect(senders.getByRole("status")).toHaveText(`Code envoyé à ${other}`);

  const row = senders.getByTestId("sender-address").filter({ hasText: other });
  await expect(row).toContainText("En attente du code");
  const codeField = row.getByLabel(`Code reçu à ${other}`);
  await expect(codeField).toBeFocused();
  await expect(codeField).toHaveAttribute("autocomplete", "one-time-code");
  await expect(codeField).toHaveAttribute("inputmode", "numeric");
  await axeLightAndDark(page);
  await shots(page, testInfo, "adresses-envoi-code");

  // « Renvoyer le code » at once: the real wait is said (once a minute per address).
  await row.getByRole("button", { name: "Renvoyer le code" }).click();
  await expect(row.getByRole("alert")).toHaveText("Trop de codes demandés. Réessaie dans une minute.");

  const code = await readCode(request, other);
  const wrong = code === "000000" ? "111111" : "000000";
  await codeField.fill(wrong);
  await row.getByRole("button", { name: "Valider" }).click();
  await expect(row.getByRole("alert")).toHaveText("Ce code n'est pas le bon.");
  // Pasted with a space (« 123 456 »): cleaned before the 6-digit limit.
  await codeField.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await expect(codeField).toHaveValue(code);
  const valider = row.getByRole("button", { name: "Valider" });
  expect((await valider.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await valider.click();
  await expect(row).toContainText("Vérifiée");
  await expect(senders.getByRole("status")).toHaveText(`${other} est vérifiée : ses e-mails transférés seront lus.`);
  const { rows } = await db.query<{ email: string; verified: boolean; code_hash: string | null }>(
    "select email, verified_at is not null as verified, code_hash from order_sender_addresses where user_id = $1",
    [who.userId],
  );
  expect(rows).toEqual([{ email: other, verified: true, code_hash: null }]);
  await axeLightAndDark(page);

  // Still there after a reload, then « Retirer », asked first.
  await page.reload();
  await expect(row).toContainText("Vérifiée");
  await row.getByRole("button", { name: `Retirer ${other}` }).click();
  const dialog = page.getByRole("dialog", { name: "Retirer cette adresse ?" });
  await expect(dialog).toContainText(`Les e-mails transférés depuis ${other} ne seront plus lus.`);
  await axeLightAndDark(page);
  await dialog.getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(senders.getByRole("status")).toHaveText("Adresse retirée");
  await expect(senders.getByTestId("sender-address")).toHaveCount(0);
  const after = await db.query("select 1 from order_sender_addresses where user_id = $1", [who.userId]);
  expect(after.rows).toEqual([]);
});

test("la carte à valider : corriger, « C'est bon », « Ce n'est pas une commande » et un e-mail illisible", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  const orderId = await draftOrder(
    db,
    who,
    [
      { name: "Robe Lina", size: "M", color: "Rouge", priceCents: 8900 },
      { name: "Ceinture tressée", priceCents: 2500 },
    ],
    { trackingNumber: "6A12345678901", carrier: "colissimo" },
  );

  // « Accueil »: the card to validate, before anything else.
  await page.goto("/");
  const card = main(page).getByRole("article", { name: `Commande reçue de ${AUTO_SHOP.name}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Robe Lina");
  await expect(card).toContainText("M · Rouge");
  await expect(card).toContainText("89,00 €");
  await expect(card).toContainText("Ceinture tressée");
  await expect(card).toContainText("n° 1042");
  await expect(card).toContainText("Colissimo");
  await axeLightAndDark(page);
  await shots(page, testInfo, "accueil-carte-a-valider");

  // « Corriger »: her size, then « C'est bon ».
  await card.getByRole("button", { name: "Corriger" }).click();
  const form = card.getByRole("group", { name: "Article 1" });
  await form.getByLabel("Taille").fill("S");
  await card.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(card).toContainText("S · Rouge");
  await card.getByRole("button", { name: "C'est bon" }).click();
  await expect(card).toHaveCount(0);
  const { rows: lines } = await db.query<{ stage: string; size_label: string; name_override: string }>(
    `select i.stage, i.size_label, i.name_override from order_lines l join items i on i.id = l.item_id
      where l.order_id = $1 order by l.position`,
    [orderId],
  );
  expect(lines).toEqual([
    { stage: "ordered", size_label: "S", name_override: "Robe Lina" },
    { stage: "ordered", size_label: null, name_override: "Ceinture tressée" },
  ]);

  // « Mes commandes »: the validated order, its parcel and « Suivre chez le transporteur ».
  await page.goto("/mes-commandes");
  const order = main(page).getByRole("article", { name: AUTO_SHOP.name });
  await expect(order).toContainText("Robe Lina");
  await expect(order.getByRole("link", { name: "Suivre chez le transporteur" })).toHaveAttribute(
    "href",
    "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678901",
  );
  await axeLightAndDark(page);
  await shots(page, testInfo, "mes-commandes");

  // An article without a product has its sheet, with its order and parcel.
  await order.getByRole("link", { name: "Robe Lina" }).click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Robe Lina" })).toBeVisible();
  const block = main(page).getByRole("region", { name: "Commande / colis" });
  await expect(block).toContainText(AUTO_SHOP.name);
  await expect(block.getByRole("link", { name: "Suivre chez le transporteur" })).toBeVisible();
  // No shop page, no stock or price follow-up.
  await expect(main(page).getByRole("region", { name: "Alertes" })).toHaveCount(0);
  await expect(main(page).getByRole("link", { name: /^Voir chez/ })).toHaveCount(0);
  await axeLightAndDark(page);

  // « Ce n'est pas une commande »: set aside, gone from « Accueil ».
  const other = await draftOrder(db, who, [{ name: "Newsletter" }], { ref: "2077" });
  await page.goto("/");
  const second = main(page).getByRole("article", { name: `Commande reçue de ${AUTO_SHOP.name}` });
  await second.getByRole("button", { name: "Ce n'est pas une commande" }).click();
  await expect(second).toHaveCount(0);
  expect((await db.query("select status from orders where id = $1", [other])).rows).toEqual([{ status: "dismissed" }]);

  // An unreadable e-mail: typed by hand.
  const { rows: inbox } = await db.query<{ id: string }>(
    `insert into order_inboxes (user_id, local_part) values ($1, $2) returning id`,
    [
      who.userId,
      `camille-${who.userId
        .slice(0, 4)
        .toLowerCase()
        .replace(/[^a-z]/g, "x")}x`,
    ],
  );
  await db.query(
    `insert into inbound_emails (user_id, inbox_id, queue_id, from_address, auth_ok, status, purge_after)
     values ($1, $2, 'q1', 'camille@example.com', true, 'failed', now() + interval '30 days')`,
    [who.userId, inbox[0]?.id],
  );
  await page.goto("/mes-commandes");
  const unread = main(page).getByRole("article", { name: "On n'a pas su lire cet e-mail" });
  await unread.getByRole("button", { name: "Saisir la commande" }).click();
  await unread.getByLabel("Boutique").fill("Atelier Mona");
  await unread.getByRole("group", { name: "Article 1" }).getByLabel("Nom de l'article").fill("Pull marin");
  await unread.getByLabel("Numéro de suivi (facultatif)").fill("6A99999999999");
  await unread.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(unread).toHaveCount(0);
  const typed = main(page).getByRole("article", { name: "Atelier Mona" });
  await expect(typed).toContainText("Pull marin");
  await expect(typed).toContainText("Colissimo");
  await axeLightAndDark(page);
});

test("un numéro collé, le colis en route puis reçu avec sa date limite, et un transporteur corrigé", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  const wish = await pasteAndWish(page, db, who.userId);
  await db.query("update items set stage = 'ordered' where id = $1", [wish.id]);
  await page.reload();

  // « Ajouter un numéro de suivi » on her article « Commandé »: the carrier is guessed.
  const block = main(page).getByRole("region", { name: "Commande / colis" });
  await block.getByRole("button", { name: "Ajouter un numéro de suivi" }).click();
  await block.getByLabel("Numéro de suivi").fill("6a 1234 5678 902");
  await block.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(block).toContainText("Colissimo");
  await expect(block).toContainText("6A12345678902");
  await expect(block.getByRole("link", { name: "Suivre chez le transporteur" })).toHaveAttribute(
    "href",
    "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678902",
  );
  const { rows: parcels } = await db.query<{ id: string; order_id: string }>(
    `select p.id, p.order_id from parcels p join orders o on o.id = p.order_id where o.user_id = $1`,
    [who.userId],
  );
  const parcel = parcels[0];
  if (!parcel) throw new Error("no parcel");

  // The carrier said « Pris en charge »: « En route » with the step and the estimated day.
  const estimated = await parisDayPlus(db, 2);
  await db.query(
    `update parcels set status = 'in_transit', last_event_at = now(), estimated_at = $2::date + time '12:00' where id = $1`,
    [parcel.id, estimated],
  );
  await db.query(
    `insert into parcel_events (parcel_id, at, status, label) values ($1, now(), 'in_transit', 'Pris en charge')`,
    [parcel.id],
  );
  await page.reload();
  await expect(block).toContainText("En route");
  await expect(block).toContainText("Pris en charge");
  await expect(block).toContainText(`Arrivée prévue le ${frenchDay(estimated)}`);
  await axeLightAndDark(page);
  await shots(page, testInfo, "fiche-commande-colis");

  // « Tu as reçu ta commande … ? » → « Oui »: « Reçu » with its return deadline (14 days, the shop's default).
  await db.query("update orders set received_asked_at = now() where id = $1", [parcel.order_id]);
  await page.goto("/");
  const question = main(page).getByRole("article", { name: `Tu as reçu ta commande ${AUTO_SHOP.name} ?` });
  await axeLightAndDark(page);
  await question.getByRole("button", { name: "Oui" }).click();
  await expect(question).toHaveCount(0);
  const deadline = await parisDayPlus(db, 14);
  await page.goto(`/produits/${wish.product_id}`);
  await expect(main(page).getByText(`Retour possible jusqu'au ${frenchDay(deadline)}`)).toBeVisible();
  expect((await db.query("select stage, return_deadline::text as d from items where id = $1", [wish.id])).rows).toEqual(
    [{ stage: "owned", d: deadline }],
  );

  // A number the format does not tell: she picks the carrier, and the tracking starts again.
  const other = await draftOrder(db, who, [{ name: "Jupe plissée" }], { trackingNumber: "12345678", ref: "3001" });
  await db.query("update orders set status = 'confirmed', confirmed_at = now() where id = $1; ", [other]);
  await db.query(
    "update parcels set status = 'unknown', next_check_at = null, check_failures = 3 where order_id = $1",
    [other],
  );
  await page.goto("/mes-commandes");
  const jupe = main(page).getByRole("article", { name: AUTO_SHOP.name }).filter({ hasText: "Jupe plissée" });
  await expect(jupe).toContainText("Transporteur inconnu");
  await jupe.getByLabel("Transporteur").selectOption({ label: "Mondial Relay" });
  await jupe.getByRole("button", { name: "Enregistrer le transporteur" }).click();
  await expect(jupe).toContainText("Mondial Relay");
  await expect(jupe.getByRole("link", { name: "Suivre chez le transporteur" })).toHaveAttribute(
    "href",
    /mondialrelay\.fr/,
  );
  const { rows: fixed } = await db.query<{ carrier: string; status: string; check_failures: number; due: boolean }>(
    "select carrier, status, check_failures, next_check_at is not null as due from parcels where order_id = $1",
    [other],
  );
  expect(fixed).toEqual([{ carrier: "mondial_relay", status: "pending", check_failures: 0, due: true }]);
});

test("un numéro de suivi modifié puis un suivi supprimé, la commande et l'article restent", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  const orderId = await draftOrder(db, who, [{ name: "Robe portefeuille" }], {
    trackingNumber: "6A18537412398",
    carrier: "colissimo",
    ref: "4001",
  });
  await db.query("update orders set status = 'confirmed', confirmed_at = now() where id = $1", [orderId]);
  await db.query(
    `insert into parcels (order_id, carrier, tracking_number, status, next_check_at, check_until)
     values ($1, 'colissimo', '8R04217735096', 'in_transit', now() + interval '6 hours', now() + interval '30 days')`,
    [orderId],
  );
  await page.goto("/mes-commandes");
  const card = main(page).getByRole("article", { name: AUTO_SHOP.name }).filter({ hasText: "Robe portefeuille" });
  const first = card.getByRole("listitem").filter({ hasText: "6A18537412398" });

  // « Modifier le numéro »: a number another parcel of the order has is refused, said in words.
  await first.getByRole("button", { name: "Modifier le numéro" }).click();
  const field = first.getByLabel("Numéro de suivi");
  await expect(field).toHaveValue("6A18537412398");
  await field.fill("8R0421 7735096");
  await first.getByRole("button", { name: "Enregistrer le numéro" }).click();
  await expect(first.getByRole("alert")).toHaveText("Ce numéro est déjà sur un autre colis de cette commande.");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await axeLightAndDark(page);

  // A DHL number: its carrier is read from it, and the tracking starts again.
  await field.fill("jjd 0001 2345 6789 012345");
  await first.getByRole("button", { name: "Enregistrer le numéro" }).click();
  const renamed = card.getByRole("listitem").filter({ hasText: "JJD000123456789012345" });
  await expect(renamed).toContainText("DHL");
  await expect(renamed).toContainText("En attente du transporteur");
  await expect(renamed.getByRole("status")).toHaveText("Numéro enregistré : le suivi reprend.");
  const { rows: edited } = await db.query<{ carrier: string; status: string; due: boolean }>(
    `select carrier, status, next_check_at <= now() as due from parcels
     where order_id = $1 and tracking_number = 'JJD000123456789012345'`,
    [orderId],
  );
  expect(edited).toEqual([{ carrier: "dhl", status: "pending", due: true }]);

  // « Supprimer ce suivi »: asked first; « Annuler » keeps it.
  const second = card.getByRole("listitem").filter({ hasText: "8R04217735096" });
  await second.getByRole("button", { name: "Supprimer ce suivi" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer ce suivi de colis ?" });
  await expect(dialog).toContainText("L'article et la commande restent.");
  await axeLightAndDark(page);
  await shots(page, testInfo, "supprimer-suivi");
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toBeHidden();
  await expect(second).toHaveCount(1);
  await second.getByRole("button", { name: "Supprimer ce suivi" }).click();
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(second).toHaveCount(0);
  await expect(card).toContainText("Robe portefeuille");
  await expect(card).toContainText("JJD000123456789012345");
  const { rows: left } = await db.query<{ n: number }>("select count(*)::int as n from parcels where order_id = $1", [
    orderId,
  ]);
  expect(left).toEqual([{ n: 1 }]);
  await page.reload();
  await expect(card.getByRole("listitem").filter({ hasText: "8R04217735096" })).toHaveCount(0);
});

/** A draft order validated through the API (« C'est bon »): its lines get their articles « Commandé ». */
async function confirmedOrder(page: Page, db: Db, who: Account, name: string, ref: string) {
  const orderId = await draftOrder(db, who, [{ name }], {
    trackingNumber: `6A${ref}12345678`,
    carrier: "colissimo",
    ref,
  });
  const status = await page.evaluate(
    async (id) => (await fetch(`/api/me/orders/${id}/confirm`, { method: "POST" })).status,
    orderId,
  );
  expect(status).toBe(200);
  const { rows } = await db.query<{ item_id: string }>("select item_id from order_lines where order_id = $1", [
    orderId,
  ]);
  return { orderId, itemId: rows[0]?.item_id ?? "" };
}

test("une commande supprimée disparaît avec ses colis, ses articles restent", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  const kept = await confirmedOrder(page, db, who, "Chemise lin", "5001");
  const gone = await confirmedOrder(page, db, who, "Pantalon large", "5002");
  await page.goto("/mes-commandes");
  const card = main(page).getByRole("article", { name: AUTO_SHOP.name }).filter({ hasText: "Pantalon large" });

  // Asked first; « Annuler » keeps it.
  await card.getByRole("button", { name: "Supprimer la commande" }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer cette commande ?" });
  await expect(dialog).toContainText("La commande et ses colis disparaissent. Les articles restent dans tes articles.");
  await axeLightAndDark(page);
  await shots(page, testInfo, "supprimer-commande");
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toHaveCount(1);

  await card.getByRole("button", { name: "Supprimer la commande" }).click();
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(main(page).getByRole("status").filter({ hasText: "Commande supprimée" })).toBeVisible();
  await expect(main(page).getByRole("heading", { name: "Tes commandes" })).toBeFocused();
  await expect(main(page).getByRole("article", { name: AUTO_SHOP.name })).toHaveCount(1);
  const { rows: left } = await db.query<{ orders: number; parcels: number }>(
    `select (select count(*)::int from orders where id = $1) as orders,
            (select count(*)::int from parcels where order_id = $1) as parcels`,
    [gone.orderId],
  );
  expect(left).toEqual([{ orders: 0, parcels: 0 }]);
  // Her article stays « Commandé », its sheet no longer tied to the order.
  const { rows: items } = await db.query<{ stage: string; deleted: boolean }>(
    "select stage, deleted_at is not null as deleted from items where id = $1",
    [gone.itemId],
  );
  expect(items).toEqual([{ stage: "ordered", deleted: false }]);
  await page.goto(`/articles/${gone.itemId}`);
  const block = main(page).getByRole("region", { name: "Commande / colis" });
  await expect(block.getByRole("button", { name: "Ajouter un numéro de suivi" })).toBeVisible();
  await expect(block.getByRole("link", { name: "Voir la commande" })).toHaveCount(0);

  // From the article's sheet too: the block says it, the focus stays in it.
  await page.goto(`/articles/${kept.itemId}`);
  await block.getByRole("button", { name: "Supprimer la commande" }).click();
  await page
    .getByRole("dialog", { name: "Supprimer cette commande ?" })
    .getByRole("button", { name: "Supprimer", exact: true })
    .click();
  await expect(block.getByRole("status")).toHaveText("Commande supprimée");
  await expect(block.getByRole("heading", { name: "Commande / colis" })).toBeFocused();
  await expect(block.getByRole("link", { name: "Voir la commande" })).toHaveCount(0);
  await axeLightAndDark(page);
});

test("une commande validée modifiée : boutique pour elle seule, numéro et date", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  await confirmedOrder(page, db, who, "Veste en jean", "6001");
  const edited = await confirmedOrder(page, db, who, "Top rayé", "6002");
  await page.goto("/mes-commandes");
  const card = main(page).getByRole("article", { name: AUTO_SHOP.name }).filter({ hasText: "Top rayé" });

  // « Annuler » closes the form, nothing changed.
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  await expect(card.getByLabel("Boutique")).toHaveValue(AUTO_SHOP.name);
  await expect(card.getByLabel("Numéro de commande")).toHaveValue("6002");
  await card.getByLabel("Boutique").fill("Autre chose");
  await card.getByRole("button", { name: "Annuler" }).click();
  await expect(card.getByLabel("Boutique")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Modifier", exact: true })).toBeFocused();

  // The number of her other order of the same shop is refused, said in words.
  await card.getByRole("button", { name: "Modifier", exact: true }).click();
  await card.getByLabel("Numéro de commande").fill("6001");
  await card.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(card.getByRole("alert")).toHaveText("Une autre de tes commandes de cette boutique a déjà ce numéro.");
  await expect(card.getByLabel("Numéro de commande")).toHaveAttribute("aria-invalid", "true");
  await axeLightAndDark(page);
  await shots(page, testInfo, "modifier-commande");

  const day = await parisDayPlus(db, -3);
  await card.getByLabel("Boutique").fill("Ma boutique du marais");
  await card.getByLabel("Numéro de commande").fill("A-77");
  await card.getByLabel("Date de commande").fill(day);
  await card.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const renamed = main(page).getByRole("article", { name: "Ma boutique du marais" });
  await expect(renamed).toContainText(`Commandée le ${frenchDay(day)} · n° A-77`);
  await expect(renamed.getByRole("status")).toHaveText("Commande modifiée.");
  await expect(renamed.getByRole("button", { name: "Modifier", exact: true })).toBeFocused();
  // Her name on her order only: the catalogue keeps its own.
  const { rows } = await db.query<{ shop: string; ref: string; typed: boolean; catalogue: string }>(
    `select o.shop_name as shop, o.external_ref as ref, o.shop_name_typed as typed, s.name as catalogue
     from orders o join shops s on s.id = o.shop_id where o.id = $1`,
    [edited.orderId],
  );
  expect(rows).toEqual([{ shop: "Ma boutique du marais", ref: "A-77", typed: true, catalogue: AUTO_SHOP.name }]);
  await expect(main(page).getByRole("article", { name: AUTO_SHOP.name })).toContainText("Veste en jean");

  // From the article's sheet, the same form.
  await page.goto(`/articles/${edited.itemId}`);
  const block = main(page).getByRole("region", { name: "Commande / colis" });
  await expect(block).toContainText("Commande Ma boutique du marais");
  await block.getByRole("button", { name: "Modifier", exact: true }).click();
  await block.getByLabel("Numéro de commande").fill("A-78");
  await block.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(block).toContainText("n° A-78");
  await expect(block.getByRole("status").filter({ hasText: "Commande modifiée." })).toBeVisible();
  await axeLightAndDark(page);
});

test("changer de transporteur ou de numéro s'annule ; sans transporteur, le choix se rouvre", async ({
  page,
  db,
  userAgentTag,
}) => {
  const who = await account(page, db, userAgentTag);
  const orderId = await draftOrder(db, who, [{ name: "Gilet court" }], { trackingNumber: "12345678", ref: "7001" });
  await db.query("update orders set status = 'confirmed', confirmed_at = now() where id = $1", [orderId]);
  await db.query("update parcels set status = 'unknown', next_check_at = null where order_id = $1", [orderId]);
  await db.query(
    `insert into parcels (order_id, carrier, tracking_number, status, next_check_at, check_until)
     values ($1, 'colissimo', '6A18537412398', 'in_transit', now() + interval '6 hours', now() + interval '30 days')`,
    [orderId],
  );
  await page.goto("/mes-commandes");
  const card = main(page).getByRole("article", { name: AUTO_SHOP.name });

  // No carrier: the choice is open at once; « Annuler » closes it, « Choisir le transporteur » opens it again.
  const unknown = card.getByRole("listitem").filter({ hasText: "12345678" });
  await expect(unknown.getByLabel("Transporteur")).toBeVisible();
  await unknown.getByLabel("Transporteur").selectOption({ label: "GLS" });
  await unknown.getByRole("button", { name: "Annuler" }).click();
  await expect(unknown.getByLabel("Transporteur")).toHaveCount(0);
  const choose = unknown.getByRole("button", { name: "Choisir le transporteur" });
  await expect(choose).toBeFocused();
  await choose.click();
  await expect(unknown.getByLabel("Transporteur")).toHaveValue("");
  await axeLightAndDark(page);

  // A known carrier: « Changer de transporteur » then « Annuler » keeps it, the choice reset.
  const known = card.getByRole("listitem").filter({ hasText: "6A18537412398" });
  await known.getByRole("button", { name: "Changer de transporteur" }).click();
  await known.getByLabel("Transporteur").selectOption({ label: "DPD" });
  await known.getByRole("button", { name: "Annuler" }).click();
  await expect(known.getByLabel("Transporteur")).toHaveCount(0);
  await expect(known.getByRole("button", { name: "Changer de transporteur" })).toBeFocused();
  await known.getByRole("button", { name: "Changer de transporteur" }).click();
  await expect(known.getByLabel("Transporteur")).toHaveValue("colissimo");
  await known.getByRole("button", { name: "Annuler" }).click();

  // « Modifier le numéro » has its « Annuler » too.
  await known.getByRole("button", { name: "Modifier le numéro" }).click();
  await known.getByLabel("Numéro de suivi").fill("8R04217735096");
  await known.getByRole("button", { name: "Annuler" }).click();
  await expect(known.getByLabel("Numéro de suivi")).toHaveCount(0);
  await expect(known.getByRole("button", { name: "Modifier le numéro" })).toBeFocused();
  const { rows } = await db.query<{ carrier: string | null; tracking_number: string }>(
    "select carrier, tracking_number from parcels where order_id = $1 order by tracking_number",
    [orderId],
  );
  expect(rows).toEqual([
    { carrier: null, tracking_number: "12345678" },
    { carrier: "colissimo", tracking_number: "6A18537412398" },
  ]);
});

test("le rappel de retour à 3 jours est la une de l'Accueil", async ({ page, db, userAgentTag }) => {
  const who = await account(page, db, userAgentTag);
  const wish = await pasteAndWish(page, db, who.userId);
  const deadline = await parisDayPlus(db, 3);
  await db.query("update items set stage = 'owned', return_deadline = $2 where id = $1", [wish.id, deadline]);
  await db.query(
    `insert into alert_events (user_id, profile_id, item_id, product_id, kind, created_at, status)
     values ($1, $2, $3, $4, 'return_reminder', now() - interval '1 minute', 'sent')`,
    [who.userId, who.profileId, wish.id, wish.product_id],
  );
  await page.goto("/");
  const une = main(page).getByRole("article", { name: `Plus que 3 jours pour retourner ${PRODUCT.name}` });
  await expect(une).toContainText(`Retour possible jusqu'au ${frenchDay(deadline)}`);
  await axeLightAndDark(page);
  await une.getByRole("link", { name: "Voir l’article" }).click();
  await expect(page).toHaveURL(new RegExp(`/produits/${wish.product_id}`));
});

test("un lien Instagram ouvre le formulaire court et crée l'article sans lire Instagram", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  const who = await account(page, db, userAgentTag);
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill("https://www.instagram.com/p/C0deExemple/");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page).toHaveURL(/\/ajouter\/instagram\?lien=/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Un article vu sur Instagram" })).toBeVisible();
  await expect(main(page)).toContainText("On ne lit pas Instagram : dis-nous ce que tu as vu.");
  // A wish has no price paid.
  await expect(main(page).getByLabel("Prix payé")).toHaveCount(0);
  await main(page).getByLabel("Nom de l'article").fill("Top en crochet");
  await main(page).getByLabel("Boutique ou marque").fill("Maison Rosa");
  await main(page).getByRole("radio", { name: "Je l'ai commandé" }).check();
  await main(page).getByLabel("Prix payé").fill("45");
  await axeLightAndDark(page);
  await shots(page, testInfo, "formulaire-instagram");
  await main(page).getByRole("button", { name: "Ajouter", exact: true }).click();

  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Top en crochet" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Voir la publication Instagram" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/p/C0deExemple/",
  );
  const { rows } = await db.query(
    `select stage, product_id, name_override, brand_override, price_paid_cents, source_url from items
      where user_id = $1 and deleted_at is null`,
    [who.userId],
  );
  expect(rows).toEqual([
    {
      stage: "ordered",
      product_id: null,
      name_override: "Top en crochet",
      brand_override: "Maison Rosa",
      price_paid_cents: 4500,
      source_url: "https://www.instagram.com/p/C0deExemple/",
    },
  ]);
  // Without a product the card leads to its sheet.
  await page.goto("/articles?etape=commande");
  await main(page)
    .getByRole("link", { name: /Top en crochet/ })
    .click();
  await expect(page).toHaveURL(/\/articles\/[0-9a-f-]{36}$/);
});
