import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import type pg from "pg";
import { sessionsOf, signInAsAdmin, signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { setupValue } from "../fixtures/paths";
import { expect, test } from "../fixtures/test";

// Catalogue conforme au droit (docs/specs/2026-11-14-catalogue-conforme.md): a shop without a listing agreement shows
// Closyria's illustration and « Voir les photos chez … » to the public, never its photos; a full import alone is seen
// by a « Testeuse » only; the admin switches « Testeuse » and « Accord de référencement ».

/**
 * Where the illustrated cards are pictured (light and dark, every device): the test's own output folder, or
 * `E2E_SHOTS_DIR` when set (to gather them for a review).
 */
const shotPath = (testInfo: TestInfo, name: string) =>
  process.env.E2E_SHOTS_DIR ? join(process.env.E2E_SHOTS_DIR, name) : testInfo.outputPath(name);
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
      const path = shotPath(shot.testInfo, `${shot.name}-${scheme}.png`);
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

/** A published shop of its own, without any listing agreement. */
async function seedShop(db: pg.Pool, tag: string) {
  const slug = `e2e-legal-${tag}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into shops (name, slug, status, platform, capture_mode) values ($1, $2, 'published', 'shopify', 'manual')
     returning id`,
    [`Atelier ${tag}`, slug],
  );
  const id = rows[0]?.id ?? "";
  await db.query("insert into shop_domains (domain, shop_id) values ($1, $2)", [`${slug}.e2e.test`, id]);
  return { id, name: `Atelier ${tag}` };
}

async function category(db: pg.Pool, slug: string, name: string): Promise<string> {
  await db.query("insert into categories (slug, name) values ($1, $2) on conflict (slug) do nothing", [slug, name]);
  const { rows } = await db.query<{ id: string }>("select id from categories where slug = $1", [slug]);
  return rows[0]?.id ?? "";
}

async function color(db: pg.Pool, tag: string, slug: string, name: string, hex: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "insert into colors (slug, name, hex) values ($1, $2, $3) returning id",
    [`e2e-${tag}-${slug}`, name, hex],
  );
  return rows[0]?.id ?? "";
}

/**
 * A complete article with a photo on disk; `pasted`: a link a user pasted (a user capture), else imported only.
 */
async function seedProduct(
  db: pg.Pool,
  shopId: string,
  seed: { name: string; categoryId: string | null; colorId: string | null; pasted: boolean; sizes?: string[] },
): Promise<string> {
  const url = `https://legal.e2e.test/products/${randomUUID()}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into products (shop_id, canonical_url, name, price_cents, currency, category_id, color_id, description,
       published_at, published_source)
     values ($1, $2, $3, 5900, 'EUR', $4, $5, 'Le texte de la boutique, jamais repris.', now(), 'first_seen')
     returning id`,
    [shopId, url, seed.name, seed.categoryId, seed.colorId],
  );
  const id = rows[0]?.id ?? "";
  const key = `products/${id}/0.webp`;
  await mkdir(dirname(join(setupValue("E2E_STORAGE_DIR"), key)), { recursive: true });
  await writeFile(join(setupValue("E2E_STORAGE_DIR"), key), TINY_WEBP);
  await db.query(
    "insert into product_images (product_id, position, key, width, height, source_hash) values ($1, 0, $2, 1, 1, $3)",
    [id, key, `h-${id}`],
  );
  for (const [position, label] of (seed.sizes ?? []).entries()) {
    await db.query("insert into product_sizes (product_id, label, position, available) values ($1, $2, $3, true)", [
      id,
      label,
      position,
    ]);
  }
  if (seed.pasted) {
    await db.query(
      `insert into captures (product_id, shop_id, url, trigger, status) values ($1, $2, $3, 'user', 'succeeded')`,
      [id, shopId, url],
    );
  }
  return id;
}

/** One pasted article of every silhouette, in its colour, and one article only an import brought. */
async function seedIllustrated(db: pg.Pool, tag: string) {
  const shop = await seedShop(db, tag);
  const kinds: [string, string | null, string | null, string, string][] = [
    ["T-shirt", "t-shirts", "T-shirts", "Jaune", "#F2C94C"],
    ["Robe", "robes", "Robes", "Rouge", "#C62828"],
    ["Pantalon", "pantalons", "Pantalons", "Bleu", "#2F6FDB"],
    ["Jupe", "jupes", "Jupes", "Rose", "#F4A6B8"],
    ["Manteau", "vestes-manteaux", "Vestes et manteaux", "Camel", "#B98B54"],
    ["Baskets", "baskets", "Baskets", "Blanc", "#FFFFFF"],
    ["Sac", "sacs", "Sacs", "Noir", "#111111"],
    ["Foulard", "echarpes-foulards", "Écharpes et foulards", "Vert", "#2E7D4F"],
    ["Pièce", null, null, "", ""],
  ];
  for (const [label, slug, name, colorName, hex] of kinds) {
    const categoryId = slug && name ? await category(db, slug, name) : null;
    const colorId = hex ? await color(db, tag, `${slug}`, colorName, hex) : null;
    await seedProduct(db, shop.id, {
      name: `${label} ${tag}`,
      categoryId,
      colorId,
      pasted: true,
      sizes: slug === "robes" ? ["36", "38", "40", "42"] : [],
    });
  }
  const importedOnly = await seedProduct(db, shop.id, {
    name: `Importé ${tag}`,
    categoryId: null,
    colorId: null,
    pasted: false,
  });
  return { shop, importedOnly };
}

const cards = (page: Page) => page.getByRole("list", { name: "Les articles" }).getByTestId("catalogue-card");

test("une carte publique sans accord : illustration et « Voir les photos chez … », jamais la photo de la boutique", async ({
  page,
  db,
}, testInfo) => {
  const tag = randomUUID().slice(0, 8);
  const { shop } = await seedIllustrated(db, tag);

  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(cards(page)).toHaveCount(9);
  // The imported-only article is not there for her.
  await expect(cards(page).filter({ hasText: `Importé ${tag}` })).toHaveCount(0);
  // No shop photo on the page: illustrations, each with its way to the shop's photos.
  await expect(cards(page).locator("img")).toHaveCount(0);
  await expect(cards(page).getByTestId("product-illustration")).toHaveCount(9);
  const kinds = await cards(page)
    .getByTestId("product-illustration")
    .evaluateAll((all) => all.map((el) => el.getAttribute("data-kind")));
  expect(new Set(kinds)).toEqual(
    new Set(["top", "dress", "bottom", "skirt", "coat", "shoes", "bag", "accessory", "other"]),
  );
  const robe = cards(page).filter({ hasText: `Robe ${tag}` });
  const photosAt = robe.getByRole("link", { name: new RegExp(`^Voir les photos chez ${shop.name}`) });
  await expect(photosAt).toHaveAttribute("href", /^https:\/\/legal\.e2e\.test\/products\//);
  await expect(photosAt).toHaveAttribute("target", "_blank");
  // Measured once the cards' entrance (a slight scale) is over: axe waits for the animations to end.
  await axeLightAndDark(page, { testInfo, name: `cartes-${testInfo.project.name.replace(/\W+/g, "-")}` });
  const box = await photosAt.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

  // The sheet: the illustration, the facts, « Voir les photos chez … »; never the shop's photo nor its text.
  await robe
    .getByRole("link", { name: new RegExp(`Robe ${tag}`) })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: `Robe ${tag}` })).toBeVisible();
  await expect(page.getByTestId("product-gallery").getByTestId("product-illustration")).toBeVisible();
  await expect(page.getByTestId("product-gallery").locator("img")).toHaveCount(0);
  await expect(page.getByTestId("sheet-shop-link")).toContainText(`Voir les photos chez ${shop.name}`);
  await expect(page.getByTestId("product-description")).toContainText("Robe rouge, du 36 au 42.");
  await expect(page.getByText("Le texte de la boutique, jamais repris.")).toHaveCount(0);
  await axeLightAndDark(page, { testInfo, name: `fiche-${testInfo.project.name.replace(/\W+/g, "-")}` });
});

test("une testeuse voit les articles importés, avec les photos de la boutique", async ({
  page,
  db,
  request,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  await seedIllustrated(db, tag);
  const email = uniqueEmail();
  await page.goto("/");
  await signInWithEmailCode(page, request, email);
  await db.query(`update "user" set is_tester = true where email = $1`, [email]);
  expect((await sessionsOf(db, userAgentTag)).length).toBeGreaterThan(0);

  await page.goto(`/decouvrir?recherche=${tag}`);
  await expect(cards(page)).toHaveCount(10);
  const imported = cards(page).filter({ hasText: `Importé ${tag}` });
  await expect(imported.locator("img")).toHaveCount(1);
  await expect(imported.getByTestId("card-photos-at")).toHaveCount(0);
  await expect(cards(page).getByTestId("product-illustration")).toHaveCount(0);
  await axeLightAndDark(page);
});

test("une admin coche « Testeuse » sur une personne et « Accord de référencement » sur une boutique", async ({
  page,
  db,
  request,
  userAgentTag,
}) => {
  const tag = randomUUID().slice(0, 8);
  const { shop } = await seedIllustrated(db, tag);
  const personId = `e2e-legal-${tag}`;
  await db.query(`insert into "user" (id, name, email, email_verified) values ($1, 'Lou', $2, true)`, [
    personId,
    `lou-${tag}@example.com`,
  ]);
  await signInAsAdmin(page, request, db, userAgentTag);

  await page.goto(`/admin/utilisatrices/${personId}`);
  const tester = page.getByRole("checkbox", { name: /Testeuse/ });
  await expect(tester).not.toBeChecked();
  await axeLightAndDark(page);
  await tester.check();
  await expect(page.getByText("Enregistré.")).toBeVisible();
  await expect(tester).toBeChecked();
  const { rows: people } = await db.query<{ is_tester: boolean }>(`select is_tester from "user" where id = $1`, [
    personId,
  ]);
  expect(people[0]?.is_tester).toBe(true);
  const { rows: audit } = await db.query<{ action: string }>("select action from admin_audit_log where target = $1", [
    `user:${personId}`,
  ]);
  expect(audit.map((a) => a.action)).toEqual(["user.tester"]);

  await page.goto(`/admin/boutiques/${shop.id}`);
  const settings = page.getByRole("region", { name: "Réglages" });
  const agreement = settings.getByRole("checkbox", { name: "Accord de référencement" });
  await expect(agreement).not.toBeChecked();
  await agreement.check();
  const day = settings.getByLabel("Date de l’accord");
  await expect(day).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await day.fill("2026-11-10");
  await axeLightAndDark(page);
  await settings.getByRole("button", { name: "Enregistrer" }).click();
  await expect(settings.getByText("Réglages enregistrés.")).toBeVisible();
  await expect(agreement).toBeChecked();
  const { rows: shops } = await db.query<{ day: string }>(
    `select to_char(listing_agreement_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as day from shops where id = $1`,
    [shop.id],
  );
  expect(shops[0]?.day).toBe("2026-11-10 00:00");
  const { rows: shopAudit } = await db.query<{ fields: string }>(
    "select details->>'fields' as fields from admin_audit_log where target = $1 and action = 'shop.update'",
    [`shop:${shop.id}`],
  );
  expect(shopAudit.map((a) => a.fields).join(",")).toContain("listingAgreementAt");
});
