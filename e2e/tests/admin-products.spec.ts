import { signInAsAdmin } from "../fixtures/auth";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 17: the product sheet admin. A sheet is captured by pasting its address, then an admin
// finds it, corrects its type and sees « Corrigée »; the reference lists load.

test("une admin retrouve une fiche capturée, corrige son type et voit « Corrigée »", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  // Keep the sheet: « Gardée par » then counts one active item.
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  const productId = /\/produits\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(productId).toBeTruthy();

  // The e2e database has no seeded types (the seed runs at worker start): this test brings its own.
  const stamp = Date.now();
  const type = `Pantalon e2e ${stamp}`;
  await db.query("insert into categories (slug, name) values ($1, $2)", [`pantalon-e2e-${stamp}`, type]);
  try {
    await signInAsAdmin(page, request, db, userAgentTag);
    await page.goto("/admin/fiches");
    await page.getByRole("searchbox", { name: "Rechercher" }).fill(PRODUCT.name);
    await page.getByRole("button", { name: "Filtrer" }).click();
    await expect(page).toHaveURL(/q=/);
    await page.locator(`a[href="/admin/fiches/${productId}"]`).click();

    await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible();
    await expect(page.getByText("Gardée par 1 compte")).toBeVisible();
    await expect(page.getByText("Corrigée")).toHaveCount(0);
    await page.getByRole("button", { name: "Corriger la fiche" }).click();
    const form = page.getByRole("form", { name: "Corriger la fiche" });
    const category = form.getByLabel("Type");
    await category.selectOption({ label: type });
    await form.getByRole("button", { name: "Enregistrer la correction" }).click();

    await expect(page.getByText("Fiche corrigée.")).toBeVisible();
    await expect(page.getByText("Corrigée", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(type).first()).toBeVisible();
    const { rows } = await db.query<{ classified_by: string }>("select classified_by from products where id = $1", [
      productId,
    ]);
    expect(rows).toEqual([{ classified_by: "admin" }]);

    // The list: « Gardée par » is a count, and the « Corrigée » filter keeps this sheet.
    await page.goto("/admin/fiches");
    await page.getByLabel("Rangement").selectOption({ label: "Corrigée" });
    await page.getByRole("button", { name: "Filtrer" }).click();
    await expect(page).toHaveURL(/classified=admin/);
    const row = page.getByRole("row").filter({ has: page.locator(`a[href="/admin/fiches/${productId}"]`) });
    await expect(row.getByRole("cell").nth(4)).toHaveText("1");
    await expect(row.getByText("Corrigée")).toBeVisible();
  } finally {
    await db.query("delete from categories where slug = $1", [`pantalon-e2e-${stamp}`]);
  }
});

test("les listes de référence affichent l’arbre des types et permettent d’ajouter une matière", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto("/admin/references");
  await expect(page.getByRole("heading", { level: 1, name: "Listes de référence" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Types" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Couleurs" })).toBeVisible();

  const name = `Matière e2e ${Date.now()}`;
  const materials = page.getByRole("region", { name: "Matières" });
  await materials.getByLabel("Nom").fill(name);
  await materials.getByLabel("Mots-clés").fill("e2e, test");
  await materials.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(materials.getByText("Ajouté.")).toBeVisible();
  await expect(materials.getByText(name, { exact: true })).toBeVisible();
});

test("un type ne peut pas être déplacé sous lui-même : la liste l'exclut et l'API refuse la boucle", async ({
  page,
  request,
  db,
  userAgentTag,
}) => {
  const stamp = Date.now();
  const parentSlug = `parent-e2e-${stamp}`;
  const childSlug = `enfant-e2e-${stamp}`;
  const parent = await db.query<{ id: string }>("insert into categories (slug, name) values ($1, $2) returning id", [
    parentSlug,
    `Parent e2e ${stamp}`,
  ]);
  const parentId = parent.rows[0]?.id;
  const child = await db.query<{ id: string }>(
    "insert into categories (slug, name, parent_id) values ($1, $2, $3) returning id",
    [childSlug, `Enfant e2e ${stamp}`, parentId],
  );
  try {
    await signInAsAdmin(page, request, db, userAgentTag);
    await page.goto("/admin/references");
    await page.getByRole("button", { name: `Modifier Parent e2e ${stamp}` }).click();
    const form = page.getByRole("form", { name: `Modifier Parent e2e ${stamp}` });
    await expect(form.getByLabel("Sous-type de").locator("option", { hasText: `Enfant e2e ${stamp}` })).toHaveCount(0);

    const res = await page.request.patch(`/api/admin/reference/categories/${parentId}`, {
      data: { parentId: child.rows[0]?.id },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "cycle" });
  } finally {
    await db.query("delete from categories where slug = $1", [childSlug]);
    await db.query("delete from categories where slug = $1", [parentSlug]);
  }
});
