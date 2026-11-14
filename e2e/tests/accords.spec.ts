import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page, TestInfo } from "@playwright/test";
import type pg from "pg";
import { signInAsAdmin } from "../fixtures/auth";
import { setupValue } from "../fixtures/paths";
import { expect, test } from "../fixtures/test";

// Accords de référencement en ligne (docs/specs/2026-11-14-catalogue-conforme.md §6): a shop invited by the admin gives
// its agreement online and withdraws it with its private link; a shop not invited asks with the public form and the
// admin accepts; a shop without agreement shows « {n} articles chez elle » on its tile.

/** Pictures for the review (light and dark, every device): `E2E_SHOTS_DIR` when set, else the test's output folder. */
const shotPath = (testInfo: TestInfo, name: string) =>
  process.env.E2E_SHOTS_DIR ? join(process.env.E2E_SHOTS_DIR, name) : testInfo.outputPath(name);
const device = (testInfo: TestInfo) => testInfo.project.name.replace(/\W+/g, "-");
const TINY_WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");

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

async function axeLightAndDark(page: Page, shot?: { testInfo: TestInfo; name: string }) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect
      .poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches))
      .toBe(scheme === "dark");
    await axe(page);
    if (shot) {
      const path = shotPath(shot.testInfo, `${shot.name}-${device(shot.testInfo)}-${scheme}.png`);
      await mkdir(dirname(path), { recursive: true });
      // The app scrolls inside its content area, not the window: a tall viewport pictures the whole page.
      const size = page.viewportSize();
      if (size) await page.setViewportSize({ width: size.width, height: 3200 });
      await page.screenshot({ path });
      if (size) await page.setViewportSize(size);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
}

const atLeastATouch = async (target: Locator) => {
  const box = await target.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
};

/** A published shop without agreement, with `imported` complete articles (photo included) only an import brought. */
async function seedShop(db: pg.Pool, label: string, imported: number, partner = false) {
  const tag = randomUUID().slice(0, 8);
  const name = `${label} ${tag}`;
  const domain = `accord-${tag}.e2e.test`;
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform, capture_mode, listing_agreement_at)
     values ($1, $2, 'published', 'shopify', 'manual', ${partner ? "now()" : "null"}) returning id`,
    [name, `e2e-accord-${tag}`],
  );
  const id = rows[0]?.id ?? "";
  await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [domain, id]);
  for (let i = 0; i < imported; i++) {
    const product = await db.query<{ id: string }>(
      `insert into products (shop_id, canonical_url, name, price_cents, currency, published_at, published_source)
       values ($1, $2, $3, 5900, 'EUR', now(), 'first_seen') returning id`,
      [id, `https://${domain}/products/${i}`, `Importé ${i} ${tag}`],
    );
    const productId = product.rows[0]?.id ?? "";
    const key = `products/${productId}/0.webp`;
    await mkdir(dirname(join(setupValue("E2E_STORAGE_DIR"), key)), { recursive: true });
    await writeFile(join(setupValue("E2E_STORAGE_DIR"), key), TINY_WEBP);
    await db.query(
      "insert into product_images (product_id, position, key, width, height, source_hash) values ($1, 0, $2, 1, 1, $3)",
      [productId, key, `h-${productId}`],
    );
  }
  return { id, name, domain, tag };
}

const partnerSince = async (db: pg.Pool, shopId: string) =>
  (await db.query<{ at: Date | null }>("select listing_agreement_at as at from shops where id = $1", [shopId])).rows[0]
    ?.at ?? null;

test("une boutique invitée donne son accord en ligne, puis le retire avec son lien privé", async ({
  page,
  db,
  request,
  userAgentTag,
}, testInfo) => {
  // The longest journey of the file (admin, invitation, success, used link, withdrawal, history), screenshots included.
  test.setTimeout(90_000);
  const shop = await seedShop(db, "Atelier Invité", 1);
  await signInAsAdmin(page, request, db, userAgentTag);

  // The admin makes the link and its ready-to-send e-mail.
  await page.goto(`/admin/boutiques/${shop.id}`);
  const block = page.getByRole("region", { name: "Accord de référencement" });
  await expect(block.getByTestId("agreement-status")).toContainText("Pas d’accord en cours");
  await block.getByRole("button", { name: "Créer un lien d’invitation" }).click();
  const link = block.getByLabel("Lien d’invitation");
  await expect(link).toHaveValue(/\/referencement\/[A-Za-z0-9_-]{43}$/);
  const url = await link.inputValue();
  await expect(block.getByLabel("E-mail à envoyer")).toHaveValue(new RegExp(`${shop.name}[\\s\\S]*${url}`));
  await expect(block.getByRole("button", { name: "Révoquer le lien" })).toBeVisible();
  const { rows: invitations } = await db.query<{ token_hash: string }>(
    "select token_hash from shop_invitations where shop_id = $1",
    [shop.id],
  );
  expect(invitations).toHaveLength(1);
  expect(invitations[0]?.token_hash).not.toBe(url.split("/").at(-1));
  await axeLightAndDark(page);

  // The shop's representative: no account needed.
  const path = new URL(url).pathname;
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: `Référencer ${shop.name} sur Closyria` })).toBeVisible();
  await expect(page.getByText(`Site : ${shop.domain}`)).toBeVisible();
  await expect(page.getByTestId("listing-conditions")).toContainText("Projet — à faire valider par un avocat");
  await expect(page.getByRole("heading", { name: "Les conditions de référencement" })).toBeVisible();
  await axeLightAndDark(page, { testInfo, name: "invitation" });

  const submit = page.getByRole("button", { name: "Référencer ma boutique" });
  await atLeastATouch(submit);
  await submit.click();
  await expect(page.getByText("Indiquez votre nom.")).toBeVisible();
  await expect(page.getByLabel("Votre nom")).toBeFocused();
  await expect(page.getByText("Cochez cette case pour accepter les conditions.")).toBeVisible();
  await axeLightAndDark(page);
  await page.getByLabel("Votre nom").fill("Léa Martin");
  await page.getByLabel("Votre e-mail").fill(`lea-${shop.tag}@atelier.e2e.test`);
  await page.getByLabel("Je suis habilité·e à représenter cette boutique").check();
  await page.getByLabel("J’accepte les conditions de référencement (version v1)").check();
  await atLeastATouch(page.getByLabel("Je suis habilité·e à représenter cette boutique").locator(".."));
  await submit.click();

  const done = page.getByTestId("listing-done");
  await expect(done.getByRole("heading", { name: `Merci ! ${shop.name} est référencée sur Closyria.` })).toBeFocused();
  const manage = done.getByRole("link", { name: "Gérer ou retirer ma boutique" });
  await expect(manage).toHaveAttribute("href", /^\/referencement\/gerer\/[A-Za-z0-9_-]{43}$/);
  const manageHref = (await manage.getAttribute("href")) ?? "";
  await atLeastATouch(manage);
  await axeLightAndDark(page, { testInfo, name: "succes" });
  expect(await partnerSince(db, shop.id)).not.toBeNull();
  const { rows: agreements } = await db.query<{ via: string; signer_email: string; conditions_version: string }>(
    "select via, signer_email, conditions_version from shop_agreements where shop_id = $1",
    [shop.id],
  );
  expect(agreements).toEqual([
    { via: "invitation", signer_email: `lea-${shop.tag}@atelier.e2e.test`, conditions_version: "v1" },
  ]);

  // Used: the link now says so, without the shop.
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Ce lien n’est plus valable" })).toBeVisible();
  await expect(page.getByText(shop.name)).toHaveCount(0);
  await axeLightAndDark(page);

  // The admin cannot move the day of a signed agreement; she makes a new private link for a signer who lost hers.
  await page.goto(`/admin/boutiques/${shop.id}`);
  const settings = page.getByRole("region", { name: "Réglages" });
  await settings.getByLabel("Date de l’accord").fill("2026-11-01");
  await settings.getByRole("button", { name: "Enregistrer" }).click();
  await expect(settings.getByText(/a signé son accord en ligne : sa date est celle de la signature/)).toBeVisible();
  const agreementBlock = page.getByRole("region", { name: "Accord de référencement" });
  await agreementBlock.getByRole("button", { name: "Nouveau lien de gestion" }).click();
  const newLink = agreementBlock.getByLabel("Lien privé de gestion");
  await expect(newLink).toHaveValue(/\/referencement\/gerer\/[A-Za-z0-9_-]{43}$/);
  await expect(agreementBlock.getByLabel("E-mail à envoyer avec le lien de gestion")).toHaveValue(
    new RegExp(`^Bonjour Léa Martin,[\\s\\S]*${shop.name}`),
  );
  await axeLightAndDark(page);
  const newManagePath = new URL(await newLink.inputValue()).pathname;
  // The lost link no longer works.
  await page.goto(manageHref);
  await expect(page.getByRole("heading", { level: 1, name: "Ce lien n’est pas valable" })).toBeVisible();

  // Withdrawal.
  await page.goto(newManagePath);
  await expect(page.getByRole("heading", { level: 1, name: `${shop.name} sur Closyria` })).toBeVisible();
  await expect(page.getByText(/Référencée sur Closyria depuis le/)).toBeVisible();
  await page.getByRole("button", { name: "Retirer ma boutique de Closyria" }).click();
  const confirm = page.getByRole("button", { name: "Oui, retirer ma boutique" });
  await expect(confirm).toBeFocused();
  await atLeastATouch(confirm);
  await axeLightAndDark(page, { testInfo, name: "retrait" });
  await confirm.click();
  await expect(page.getByTestId("listing-withdrawn")).toHaveText(
    `C’est fait : ${shop.name} n’est plus référencée sur Closyria.`,
  );
  await axeLightAndDark(page, { testInfo, name: "retrait-fait" });
  expect(await partnerSince(db, shop.id)).toBeNull();

  // The admin sees the history.
  await page.goto(`/admin/boutiques/${shop.id}`);
  const history = page.getByRole("region", { name: "Accord de référencement" }).getByTestId("agreement-history");
  await expect(history).toContainText("Lien d’invitation · Retirée par la boutique le");
  await expect(history).toContainText(`par Léa Martin (lea-${shop.tag}@atelier.e2e.test)`);
});

test("une boutique non invitée demande son référencement, l’admin vérifie et accepte", async ({
  page,
  db,
  request,
  userAgentTag,
}, testInfo) => {
  test.setTimeout(90_000);
  const tag = randomUUID().slice(0, 8);
  const shopName = `Atelier Demande ${tag}`;

  await page.goto("/decouvrir");
  await page.getByRole("link", { name: "Référencer ma boutique" }).click();
  await expect(page).toHaveURL(/\/referencer-ma-boutique$/);
  await expect(page.getByRole("heading", { level: 1, name: "Référencer ma boutique" })).toBeVisible();
  await axeLightAndDark(page, { testInfo, name: "demande" });

  const send = page.getByRole("button", { name: "Envoyer ma demande" });
  await send.click();
  await expect(page.getByText("Indiquez le nom de la boutique.")).toBeVisible();
  await expect(page.getByLabel("Nom de la boutique")).toBeFocused();
  await page.getByLabel("Nom de la boutique").fill(shopName);
  await page.getByLabel("Adresse du site").fill(`demande-${tag}.e2e.test`);
  await page.getByLabel("Votre nom").fill("Inès Roy");
  await page.getByLabel("Votre e-mail").fill(`ines-${tag}@demande.e2e.test`);
  await page.getByLabel("Message (facultatif)").fill("Nous serions ravies d’être sur Closyria.");
  await page.getByLabel("Je suis habilité·e à représenter cette boutique").check();
  await page.getByLabel("J’accepte les conditions de référencement (version v1)").check();
  await send.click();
  await expect(page.getByRole("heading", { name: "Demande envoyée" })).toBeFocused();
  await axeLightAndDark(page);

  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto("/admin/referencement");
  const item = page.getByTestId("listing-request").filter({ hasText: shopName });
  await expect(item).toContainText(`https://demande-${tag}.e2e.test`);
  await expect(item).toContainText(`Inès Roy · ines-${tag}@demande.e2e.test`);
  await expect(item).toContainText("elle sera créée en brouillon");
  await axeLightAndDark(page, { testInfo, name: "admin-demandes" });

  await item.getByRole("button", { name: `Accepter ${shopName}` }).click();
  await expect(item.getByText("Coche d’abord la vérification.")).toBeVisible();
  await item.getByLabel(/J’ai vérifié que cette personne représente la boutique/).check();
  await item.getByRole("button", { name: `Accepter ${shopName}` }).click();
  const accepted = item.getByTestId("request-accepted");
  await expect(accepted).toContainText("Accord enregistré. Envoie à Inès Roy son lien privé");
  await expect(accepted.getByLabel("Lien privé de gestion")).toHaveValue(/\/referencement\/gerer\/[A-Za-z0-9_-]{43}$/);
  await expect(accepted.getByLabel("E-mail à envoyer avec le lien de gestion")).toHaveValue(/^Bonjour Inès Roy,/);
  await axeLightAndDark(page);

  const { rows } = await db.query<{ status: string; via: string; signer_name: string; partner: boolean }>(
    `select s.status, a.via, a.signer_name, s.listing_agreement_at is not null as partner
       from listing_requests r join shops s on s.id = r.shop_id join shop_agreements a on a.id = r.agreement_id
      where r.shop_name = $1`,
    [shopName],
  );
  expect(rows).toEqual([{ status: "draft", via: "request", signer_name: "Inès Roy", partner: true }]);
});

test("une boutique sans accord montre « {n} articles chez elle » et « Voir la boutique » ; une partenaire inchangée", async ({
  page,
  db,
}, testInfo) => {
  const plain = await seedShop(db, "Tuile Sans Accord", 3);
  const partner = await seedShop(db, "Tuile Partenaire", 1, true);

  await page.goto(`/decouvrir?recherche=${encodeURIComponent("Tuile")}`);
  const shops = page.getByRole("region", { name: "Toutes les boutiques" });
  const plainTile = shops.getByRole("link", { name: new RegExp(plain.name) });
  await expect(plainTile).toContainText("3 articles chez elle");
  await expect(plainTile).toContainText("Voir la boutique");
  await expect(plainTile).toHaveAttribute("href", `https://${plain.domain}`);
  await expect(plainTile.locator("img")).toHaveCount(0);
  const partnerTile = shops.getByRole("link", { name: new RegExp(partner.name) });
  await expect(partnerTile).toContainText("1 article");
  await expect(partnerTile).not.toContainText("chez elle");
  await expect(partnerTile).not.toContainText("Voir la boutique");
  await axeLightAndDark(page, { testInfo, name: "tuile" });
});
