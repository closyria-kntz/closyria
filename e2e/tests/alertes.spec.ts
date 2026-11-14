import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { sessionsOf } from "../fixtures/auth";
import { AUTO_SHOP, autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 4 « Alertes », task 6 (docs/specs/2026-11-14-alertes.md §3): Compte → Notifications (a guest creates her
// account first, an iPhone in a Safari tab is sent to the home screen help, a refusal is said clearly), what she
// receives and her devices; on a wish's sheet « M'alerter », « Préviens-moi sous … € » and the watch line; « Nouvelles »
// and the « une » of « Accueil »; the service worker opens the notification's address.
//
// No real push service here: the browser's PushManager and its permission are faked by an init script; the service
// worker itself is the real public/sw.js.

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

type FakePush = {
  /** `Notification.permission` when the page opens. */
  permission?: NotificationPermission;
  /** What « Autoriser / Bloquer » answers. */
  answer?: NotificationPermission;
  /** false: a Safari tab on an iPhone (no PushManager, no Notification). */
  pushManager?: boolean;
};

/**
 * Fakes the browser's push: `Notification.permission` / `requestPermission`, and the registration's `pushManager`
 * (a subscription to a known push service, kept in localStorage across reloads like the browser keeps it).
 */
async function fakePush(page: Page, options: FakePush = {}) {
  await page.addInitScript(
    ({ permission, answer, pushManager }) => {
      const w = window as unknown as Record<string, unknown>;
      // The first blank page of a test has no storage: nothing to fake there.
      if (location.protocol === "about:") return;
      if (!pushManager) {
        delete w.PushManager;
        delete w.Notification;
        return;
      }
      const KEY = "e2e.push.endpoint";
      let state: NotificationPermission =
        (sessionStorage.getItem("e2e.push.permission") as NotificationPermission) ?? permission;
      const subscription = (endpoint: string) => ({
        endpoint,
        toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BE2E-p256dh-key", auth: "e2e-auth" } }),
        unsubscribe: async () => {
          localStorage.removeItem(KEY);
          return true;
        },
      });
      const fake = {
        getSubscription: async () => {
          const endpoint = localStorage.getItem(KEY);
          return endpoint ? subscription(endpoint) : null;
        },
        subscribe: async () => {
          const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`;
          localStorage.setItem(KEY, endpoint);
          return subscription(endpoint);
        },
      };
      Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", {
        configurable: true,
        get: () => fake,
      });
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => state });
      Notification.requestPermission = async () => {
        state = answer;
        sessionStorage.setItem("e2e.push.permission", state);
        return state;
      };
    },
    {
      permission: options.permission ?? "default",
      answer: options.answer ?? "granted",
      pushManager: options.pushManager ?? true,
    },
  );
}

/** A session for this test's browser, made a real account (not a guest) in the database. */
async function account(page: Page, db: Db, userAgentTag: string): Promise<string> {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  await db.query(`update "user" set name = 'Camille Durand', is_anonymous = false where id = $1`, [userId]);
  return userId;
}

/** Her wish of the fake shop's product, through « Coller un lien »; its sheet stays open. */
async function pasteAndWish(page: Page, db: Db, userAgentTag: string) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  const [session] = await sessionsOf(db, userAgentTag);
  const userId = session?.userId ?? "";
  const { rows } = await db.query<{ id: string; product_id: string; profile_id: string; shop_id: string }>(
    `select i.id, i.product_id, i.profile_id, p.shop_id
       from items i join products p on p.id = i.product_id where i.user_id = $1`,
    [userId],
  );
  const [item] = rows;
  if (!item) throw new Error("no item");
  return { userId, ...item };
}

async function openNotifications(page: Page) {
  await page.goto("/compte");
  await main(page)
    .getByRole("link", { name: /^Notifications/ })
    .click();
  await expect(page).toHaveURL(/\/reglages\/notifications$/);
  await expect(main(page).getByRole("heading", { level: 2, name: "Notifications" })).toBeVisible();
}

test("Compte → Notifications : une invitée crée d'abord son compte", async ({ page }) => {
  await fakePush(page);
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  await openNotifications(page);
  await expect(main(page).getByRole("heading", { name: "Les notifications demandent un compte" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Crée ton compte pour recevoir tes alertes" })).toHaveAttribute(
    "href",
    "/connexion?next=%2Freglages%2Fnotifications",
  );
  await expect(main(page).getByRole("button", { name: "Activer les notifications" })).toHaveCount(0);
  await expect(main(page)).toContainText("Tes nouvelles restent sur l’Accueil et dans « Nouvelles ».");
  await axeLightAndDark(page);

  // The API says the same to a guest that would try anyway.
  const refused = await page.request.post("/api/me/push-subscriptions", {
    data: { endpoint: "https://fcm.googleapis.com/fcm/send/guest", keys: { p256dh: "p", auth: "a" } },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "account_required" });
});

test("elle active les notifications, règle ce qu'elle reçoit et retire son appareil", async ({
  page,
  db,
  userAgentTag,
  baseURL,
}) => {
  await fakePush(page);
  const userId = await account(page, db, userAgentTag);
  await openNotifications(page);

  const device = main(page).getByRole("region", { name: "Sur cet appareil" });
  await device.getByRole("button", { name: "Activer les notifications" }).click();
  await expect(device).toContainText("Les notifications sont activées sur cet appareil.");
  // The real service worker, for the whole site.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(
    `${new URL(baseURL ?? "").origin}/`,
  );
  const devices = main(page).getByRole("region", { name: "Tes appareils" });
  await expect(devices.getByRole("listitem")).toHaveCount(1);
  await expect(devices.getByRole("listitem")).toContainText("cet appareil");
  const { rows } = await db.query<{ endpoint: string }>("select endpoint from push_subscriptions where user_id = $1", [
    userId,
  ]);
  expect(rows.map((r) => r.endpoint)).toEqual([
    expect.stringMatching(/^https:\/\/fcm\.googleapis\.com\/fcm\/send\/e2e-/),
  ]);

  // What she receives: three switches, on by default, and the digest's hour.
  const what = main(page).getByRole("region", { name: "Ce que tu reçois" });
  const sizeBack = what.getByRole("switch", { name: /^Ta taille est revenue/ });
  const digest = what.getByRole("switch", { name: /^Résumé du jour/ });
  for (const name of [/^Ta taille est revenue/, /^Prix visé atteint/, /^Résumé du jour/]) {
    const toggle = what.getByRole("switch", { name });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const hour = what.getByLabel("Heure du résumé");
  await expect(hour).toHaveValue("18");
  await sizeBack.click();
  await expect(sizeBack).toHaveAttribute("aria-checked", "false");
  await expect(main(page).getByRole("status").filter({ hasText: "Réglage enregistré" })).toBeVisible();
  await hour.selectOption({ label: "20 h" });
  await expect(main(page).getByRole("status").filter({ hasText: "Réglage enregistré" })).toBeVisible();
  await expect
    .poll(async () => (await db.query("select digest_hour from alert_settings where user_id = $1", [userId])).rows[0])
    .toEqual({ digest_hour: 20 });
  await digest.click();
  await expect(hour).toBeDisabled();
  await axeLightAndDark(page);

  await page.reload();
  await expect(device).toContainText("Les notifications sont activées sur cet appareil.");
  await expect(sizeBack).toHaveAttribute("aria-checked", "false");
  await expect(digest).toHaveAttribute("aria-checked", "false");
  await expect(hour).toHaveValue("20");

  // « Retirer »: this device stops receiving, and « Activer les notifications » comes back.
  await devices.getByRole("button", { name: /^Retirer / }).click();
  await expect(devices).toContainText("Aucun appareil ne reçoit tes notifications pour l’instant.");
  await expect(device.getByRole("button", { name: "Activer les notifications" })).toBeVisible();
  expect((await db.query("select 1 from push_subscriptions where user_id = $1", [userId])).rowCount).toBe(0);

  await main(page).getByRole("link", { name: "Voir toutes mes nouvelles" }).click();
  await expect(page).toHaveURL(/\/nouvelles$/);
});

test("un refus du navigateur est expliqué, et le reste marche", async ({ page, db, userAgentTag }) => {
  await fakePush(page, { answer: "denied" });
  const userId = await account(page, db, userAgentTag);
  await openNotifications(page);
  const device = main(page).getByRole("region", { name: "Sur cet appareil" });
  await device.getByRole("button", { name: "Activer les notifications" }).click();
  await expect(device.getByRole("alert")).toContainText("Tu as refusé les notifications pour Closyria");
  await expect(device).toContainText("Tes nouvelles restent sur l’Accueil et dans « Nouvelles ».");
  await expect(device.getByRole("button", { name: "Activer les notifications" })).toHaveCount(0);
  expect((await db.query("select 1 from push_subscriptions where user_id = $1", [userId])).rowCount).toBe(0);

  // Still refused when she comes back; her settings still change.
  await page.reload();
  await expect(device.getByRole("alert")).toContainText("Tu as refusé les notifications pour Closyria");
  const targetPrice = main(page).getByRole("switch", { name: /^Prix visé atteint/ });
  await targetPrice.click();
  await expect(targetPrice).toHaveAttribute("aria-checked", "false");
  await axeLightAndDark(page);
});

test("sur iPhone hors écran d'accueil, l'aide pour ajouter Closyria ; ailleurs, un message clair", async ({
  page,
  db,
  userAgentTag,
}, testInfo) => {
  await fakePush(page, { pushManager: false });
  await account(page, db, userAgentTag);
  await openNotifications(page);
  const device = main(page).getByRole("region", { name: "Sur cet appareil" });
  await expect(device.getByRole("button", { name: "Activer les notifications" })).toHaveCount(0);
  await expect(device).toContainText("Tes nouvelles restent sur l’Accueil et dans « Nouvelles ».");
  if (testInfo.project.name === "Desktop Chrome") {
    await expect(device).toContainText("Ce navigateur ne peut pas recevoir de notifications.");
    await axeLightAndDark(page);
    return;
  }
  // An iPhone or an iPad in a Safari tab.
  await expect(device).toContainText("Sur iPhone, ajoute d’abord Closyria à ton écran d’accueil");
  const help = device.getByRole("link", { name: "Voir comment ajouter Closyria à l’écran d’accueil" });
  await expect(help).toHaveAttribute("href", "/aide/iphone");
  await axeLightAndDark(page);
  await help.click();
  await expect(page).toHaveURL(/\/aide\/telephone#iphone$/);
  const steps = page.getByRole("region", { name: "Ajouter Closyria à l’écran d’accueil" });
  await expect(steps.getByRole("listitem")).toHaveCount(3);
  await expect(steps).toBeInViewport();
  await steps.getByRole("link", { name: "Aller aux notifications" }).click();
  await expect(page).toHaveURL(/\/reglages\/notifications$/);
});

test("sur la fiche d'une envie : « M'alerter », « Préviens-moi sous … € » et la ligne de suivi", async ({
  page,
  db,
  userAgentTag,
}) => {
  await fakePush(page);
  const wish = await pasteAndWish(page, db, userAgentTag);
  const alerts = main(page).getByRole("region", { name: "Alertes" });
  await expect(alerts).toBeVisible();
  const line = alerts.getByTestId("alert-line");
  await expect(line).toContainText(
    /Suivi : (taille .+|tailles .+|retour en stock) · vérifié (maintenant|il y a \d+ min)/,
  );
  // A guest has no device: the line says how to be told.
  await expect(alerts.getByRole("link", { name: "Active les notifications pour être prévenue" })).toHaveAttribute(
    "href",
    "/reglages/notifications",
  );

  const toggle = alerts.getByRole("switch", { name: /^M’alerter/ });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(line).toContainText("Suivi en pause");
  await expect(line).toContainText("Rallume « M’alerter » pour reprendre le suivi.");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(line).toContainText("Suivi : ");

  const target = alerts.getByLabel("Préviens-moi sous … €");
  await target.fill("abc");
  await alerts.getByRole("button", { name: "Enregistrer le prix visé" }).click();
  await expect(alerts.getByRole("alert")).toHaveText("Écris un montant, par exemple 59 ou 59,90.");
  await target.fill("19,90");
  await alerts.getByRole("button", { name: "Enregistrer le prix visé" }).click();
  await expect(alerts).toContainText("Tu seras prévenue dès qu’il passe sous 19,90 €.");
  await expect
    .poll(async () => (await db.query("select target_price_cents from items where id = $1", [wish.id])).rows[0])
    .toEqual({ target_price_cents: 1990 });
  await axeLightAndDark(page);

  // Her own size on the item is the one watched. An account without a device is still told how to be told.
  await db.query("update items set size_label = 'M' where id = $1", [wish.id]);
  await db.query(`update "user" set is_anonymous = false where id = $1`, [wish.userId]);
  await page.reload();
  await expect(line).toContainText(/Suivi : taille M · vérifié/);
  await expect(alerts.getByRole("link", { name: "Active les notifications pour être prévenue" })).toBeVisible();
  await expect(target).toHaveValue("19,90");
  await alerts.getByRole("button", { name: "Retirer le prix visé" }).click();
  await expect(target).toHaveValue("");
  await expect
    .poll(async () => (await db.query("select target_price_cents from items where id = $1", [wish.id])).rows[0])
    .toEqual({ target_price_cents: null });

  // Ordered: no longer a wish, no alert block.
  await db.query("update items set stage = 'ordered' where id = $1", [wish.id]);
  await page.reload();
  await expect(main(page).getByRole("heading", { name: "Mon article" })).toBeVisible();
  await expect(main(page).getByRole("region", { name: "Alertes" })).toHaveCount(0);
});

test("« Nouvelles » et la une de l'Accueil montrent ses alertes", async ({ page, db, userAgentTag }) => {
  await fakePush(page);
  const wish = await pasteAndWish(page, db, userAgentTag);
  await db.query("update items set target_price_cents = 2100 where id = $1", [wish.id]);
  const item = [wish.userId, wish.profile_id, wish.id, wish.product_id];
  await db.query(
    `insert into alert_events (user_id, profile_id, item_id, product_id, kind, size_label, created_at, status)
     values ($1, $2, $3, $4, 'size_back', 'M', now() - interval '4 minutes', 'sent')`,
    item,
  );
  await db.query(
    `insert into alert_events (user_id, profile_id, item_id, product_id, kind, price_cents, previous_cents, created_at, status)
     values ($1, $2, $3, $4, 'price_drop', 2300, 3000, now() - interval '1 day', 'digest')`,
    item,
  );
  const { rows: sales } = await db.query<{ id: string }>(
    `insert into sale_periods (name, starts_on, ends_on)
     values ('Soldes d’hiver', (now() at time zone 'Europe/Paris')::date + 1, (now() at time zone 'Europe/Paris')::date + 30)
     returning id`,
  );
  await db.query(
    `insert into alert_events (user_id, kind, sale_period_id, created_at, status)
     values ($1, 'sale_period', $2, now() - interval '3 minutes', 'digest')`,
    [wish.userId, sales[0]?.id],
  );
  await db.query(
    `insert into alert_events (user_id, kind, shop_id, created_at, status)
     values ($1, 'shop_promo', $2, now() - interval '2 minutes', 'digest')`,
    [wish.userId, wish.shop_id],
  );
  await db.query(
    `insert into alert_events (user_id, profile_id, item_id, product_id, kind, price_cents, created_at, status)
     values ($1, $2, $3, $4, 'target_price', 2000, now() - interval '1 minute', 'sent')`,
    item,
  );
  const sheet = `/produits/${wish.product_id}?profil=${wish.profile_id}`;

  // « Accueil »: the target price is the une; the sales and the promo are news.
  await page.goto("/");
  const une = page.getByRole("article", { name: `${PRODUCT.name} : 20,00 € (tu visais 21,00 €)` });
  await expect(une).toContainText("Prix visé");
  await expect(une.getByRole("link", { name: "Voir l’article" })).toHaveAttribute("href", sheet);
  const news = page.getByRole("region", { name: "Ce qui a changé" });
  await expect(news).toContainText(`${AUTO_SHOP.name} est en promo`);
  await expect(news).toContainText("Les soldes commencent demain");
  await axeLightAndDark(page);

  await news.getByRole("link", { name: "Toutes mes nouvelles" }).click();
  await expect(page).toHaveURL(/\/nouvelles$/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Nouvelles" })).toBeVisible();
  const today = main(page).getByRole("region", { name: "Aujourd’hui" });
  const rows = today.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText(`${PRODUCT.name} : 20,00 € (tu visais 21,00 €)`);
  await expect(rows.nth(0).getByRole("link")).toHaveAttribute("href", sheet);
  await expect(rows.nth(1)).toContainText(`${AUTO_SHOP.name} est en promo`);
  await expect(rows.nth(1).getByRole("link")).toHaveAttribute("href", "/nouvelles");
  await expect(rows.nth(2)).toContainText("Les soldes commencent demain");
  await expect(rows.nth(3)).toContainText(`${PRODUCT.name} : de retour en M chez ${AUTO_SHOP.name}`);
  await expect(main(page).getByRole("region", { name: "Hier" })).toContainText(`${PRODUCT.name} passe à 23,00 €`);
  await expect(main(page).getByRole("region", { name: "Hier" })).toContainText(`−7,00 € chez ${AUTO_SHOP.name}`);
  await expect(rows.nth(0)).toContainText("Nouveau");
  await axeLightAndDark(page);

  // Seen: no longer « Nouveau » next time.
  await expect
    .poll(
      async () =>
        (
          await db.query("select count(*)::int as n from alert_events where user_id = $1 and read_at is null", [
            wish.userId,
          ])
        ).rows[0],
    )
    .toEqual({ n: 0 });
  await page.reload();
  await expect(rows).toHaveCount(4);
  await expect(main(page).getByText("Nouveau", { exact: true })).toHaveCount(0);

  await rows.nth(0).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/produits/${wish.product_id}\\?profil=${wish.profile_id}$`));
});

test("une nouvelle utilisatrice voit « Nouvelles » vide, qui dit quoi attendre", async ({ page }) => {
  await page.goto("/nouvelles");
  await expect(main(page).getByRole("heading", { name: "Rien de neuf pour l’instant" })).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Réglages des notifications" })).toHaveAttribute(
    "href",
    "/reglages/notifications",
  );
  await axeLightAndDark(page);
});

test("le service worker ouvre l'adresse de la notification touchée", async ({ page, context, db, userAgentTag }) => {
  await fakePush(page);
  await account(page, db, userAgentTag);
  await openNotifications(page);
  const registered = context.waitForEvent("serviceworker");
  await main(page).getByRole("button", { name: "Activer les notifications" }).click();
  await expect(main(page)).toContainText("Les notifications sont activées sur cet appareil.");
  const worker = context.serviceWorkers()[0] ?? (await registered);
  // Her open page is under the worker (it took the pages over when it started).
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // A tap on a notification of the worker's: `url` is where the worker message said to go.
  await worker.evaluate(() => {
    const event = new Event("notificationclick") as Event & { waitUntil?: (p: Promise<unknown>) => void };
    Object.defineProperty(event, "notification", {
      value: { close: () => {}, data: { url: `${self.location.origin}/nouvelles` } },
    });
    event.waitUntil = (promise) => void promise.catch(() => {});
    self.dispatchEvent(event);
  });
  await expect(page).toHaveURL(/\/nouvelles$/);
  await expect(main(page).getByRole("heading", { level: 1, name: "Nouvelles" })).toBeVisible();
});
