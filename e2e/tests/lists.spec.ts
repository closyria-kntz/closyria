import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 16: lists and sharing, the public page, settings (profiles, tags, trash), the iPhone help.

async function pasteAndWish(page: Page, details?: { size: string; notes: string }): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  if (details) {
    await page.getByLabel("Taille", { exact: true }).fill(details.size);
    await page.getByLabel("Notes").fill(details.notes);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(toast(page)).toContainText("Modifications enregistrées");
  }
}

const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });
const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.length }))).toEqual([]);
};

test("créer une liste, y mettre un article, la partager, l'ouvrir ailleurs, arrêter le partage", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  await pasteAndWish(page, { size: "XL-secrète", notes: "Note-privée-42" });
  await page.getByRole("button", { name: "Ajouter une photo" }).click();
  await page.getByTestId("photo-input").setInputFiles({
    name: "p.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByRole("list", { name: "Mes photos" }).getByRole("img")).toBeVisible();

  await page.goto("/listes");
  await expect(page.getByRole("heading", { name: "Aucune liste pour l’instant" })).toBeVisible();
  await page.getByLabel("Nom de la nouvelle liste").fill("Été à Nice");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été à Nice » créée");
  await axe(page);

  await page.goto("/envies");
  await page.getByTestId("item-card").getByRole("button", { name: "Plus d’actions" }).click();
  await page
    .getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` })
    .getByRole("button", { name: "Ajouter à une liste" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Été à Nice" }).click();
  await expect(toast(page)).toContainText("Ajouté à Été à Nice");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Été à Nice" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/listes");
  await page.getByRole("link", { name: /Été à Nice/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Été à Nice" })).toBeVisible();
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await expect(page.getByText("Cette liste n’est pas partagée.")).toBeVisible();

  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  const shareUrl = await field.inputValue();
  // The link stays on the page: back later, it is shown again, in full.
  await page.reload();
  await expect(field).toHaveValue(shareUrl);
  await expect(field).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("list-shared.png"), fullPage: true });
  await axe(page);

  // Another visitor, no cookies, no account.
  const visitor = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: "10.200.1.1" },
  });
  const other = await visitor.newPage();
  const response = await other.goto(shareUrl);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex");
  await expect(other.getByRole("heading", { level: 1, name: "Été à Nice" })).toBeVisible();
  // She is a guest (no account): no « Liste de Anonymous ».
  await expect(other.getByText(/Liste de/)).toHaveCount(0);
  await expect(other.getByText(/Anonymous/)).toHaveCount(0);
  const items = other.getByRole("list", { name: "Articles" }).getByRole("listitem");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(PRODUCT.name);
  await expect(items.first().getByRole("button", { name: `Agrandir la photo de ${PRODUCT.name}` })).toBeVisible();
  await expect(items.first().getByRole("link", { name: /Voir chez Fausse boutique/ })).toHaveAttribute("href", /^http/);
  const body = await other.locator("body").innerText();
  expect(body).not.toContain("XL-secrète");
  expect(body).not.toContain("Note-privée-42");
  expect(await other.content()).not.toContain("/api/me/media");
  await expect(other.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await axe(other);

  // « Changer le lien » asks first; the old link stops working, the new one is shown.
  await page.getByRole("button", { name: "Changer le lien" }).click();
  const confirm = page.getByRole("dialog", { name: "Changer le lien ?" });
  await expect(confirm.getByText("L'ancien lien ne marchera plus.")).toBeVisible();
  await axe(page);
  await confirm.getByRole("button", { name: "Annuler" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(field).toHaveValue(shareUrl);
  await page.getByRole("button", { name: "Changer le lien" }).click();
  await confirm.getByRole("button", { name: "Changer le lien" }).click();
  await expect(field).not.toHaveValue(shareUrl);
  const second = await field.inputValue();
  expect((await other.goto(shareUrl))?.status()).toBe(404);
  expect((await other.goto(second))?.status()).toBe(200);

  // « Arrêter le partage » asks first: « Annuler » changes nothing.
  await page.getByRole("button", { name: "Arrêter le partage" }).click();
  const stop = page.getByRole("dialog", { name: "Arrêter le partage ?" });
  await expect(
    stop.getByText("L'ancien lien ne marchera plus. Les avis des amies restent visibles pour toi."),
  ).toBeVisible();
  await axe(page);
  await stop.getByRole("button", { name: "Annuler" }).click();
  await expect(stop).toHaveCount(0);
  await expect(field).toHaveValue(second);
  expect((await other.goto(second))?.status()).toBe(200);
  await page.getByRole("button", { name: "Arrêter le partage" }).click();
  await stop.getByRole("button", { name: "Arrêter", exact: true }).click();
  await expect(stop).toHaveCount(0);
  await expect(toast(page)).toContainText("Partage arrêté");
  const gone = await other.goto(second);
  expect(gone?.status()).toBe(404);
  await expect(other.getByRole("heading", { name: "Ce lien ne marche plus" })).toBeVisible();
  await visitor.close();
});

/** A new list « {name} » with one wish, shared; its page is open. Returns the link. */
async function sharedList(page: Page, name: string): Promise<string> {
  await pasteAndWish(page);
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill(name);
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText(`Liste « ${name} » créée`);
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  return field.inputValue();
}

test("le lien se copie depuis la fenêtre « Partager » (refonte, task 9)", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(baseURL ?? "").origin });
  const shareUrl = await sharedList(page, "Copie");
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Partager" });
  await sheet.getByRole("button", { name: "Copier le lien" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Copié ✓");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
});

test("une liste partagée avant que les liens soient gardés : « Créer un lien à garder »", async ({
  page,
  browser,
  baseURL,
  db,
}) => {
  const shareUrl = await sharedList(page, "Ancienne");
  // Shared before this version: only the link's hash was kept.
  const listId = new URL(page.url()).pathname.split("/").pop();
  await db.query("update wishlists set share_token_encrypted = null where id = $1", [listId]);
  await page.reload();
  await expect(page.getByText("Ce lien ne peut pas être réaffiché.")).toBeVisible();
  await expect(page.getByLabel("Lien de partage")).toHaveCount(0);
  await axe(page);

  const visitor = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: "10.200.2.1" },
  });
  const other = await visitor.newPage();
  // The old link works until she makes a new one.
  expect((await other.goto(shareUrl))?.status()).toBe(200);

  await page.getByRole("button", { name: "Créer un lien à garder" }).click();
  const confirm = page.getByRole("dialog", { name: "Créer un lien à garder ?" });
  await expect(confirm.getByText("L'ancien lien ne marchera plus.")).toBeVisible();
  await confirm.getByRole("button", { name: "Créer le lien" }).click();
  const field = page.getByLabel("Lien de partage");
  await expect(field).toHaveValue(/\/l\/[A-Za-z0-9_-]{20,}$/);
  // The button she pressed is gone: the focus is on « Partager », not lost on the page.
  await expect(page.getByRole("button", { name: "Partager", exact: true })).toBeFocused();
  await expect(page.getByText("Ce lien ne peut pas être réaffiché.")).toHaveCount(0);
  const kept = await field.inputValue();
  expect((await other.goto(shareUrl))?.status()).toBe(404);
  expect((await other.goto(kept))?.status()).toBe(200);
  await page.reload();
  await expect(field).toHaveValue(kept);
  await visitor.close();
});

test("une liste se renomme, se réordonne au clavier et se supprime", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/listes");
  for (const name of ["Première", "Seconde"]) {
    await page.getByLabel("Nom de la nouvelle liste").fill(name);
    await page.getByRole("button", { name: "Créer la liste" }).click();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
  const rows = page.getByTestId("wishlist-row");
  await expect(rows.first()).toContainText("Première");
  await page.getByRole("button", { name: "Monter Seconde" }).focus();
  await page.keyboard.press("Enter");
  await expect(rows.first()).toContainText("Seconde");
  await expect(page.getByRole("button", { name: "Monter Seconde" })).toBeDisabled();
  await page.reload();
  await expect(rows.first()).toContainText("Seconde");

  await page.getByRole("link", { name: /Seconde/ }).click();
  await page.getByRole("button", { name: "Renommer" }).click();
  await page.getByLabel("Nom de la liste").fill("Voyage");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Voyage" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer la liste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer la liste" }).click();
  await expect(page).toHaveURL(/\/listes$/);
  await expect(page.getByRole("link", { name: /Voyage/ })).toHaveCount(0);
});

test("sur la page d'une liste, retirer un article de la liste par son « … » le fait partir de la page", async ({
  page,
}) => {
  await pasteAndWish(page);
  await page.goto("/listes");
  await page.getByLabel("Nom de la nouvelle liste").fill("Été");
  await page.getByRole("button", { name: "Créer la liste" }).click();
  await expect(toast(page)).toContainText("Liste « Été » créée");
  await page.goto("/envies");
  await page.getByRole("button", { name: "Sélectionner", exact: true }).click();
  await page.getByTestId("item-card").getByRole("button", { name: PRODUCT.name }).click();
  await page
    .getByRole("region", { name: "Actions sur la sélection" })
    .getByRole("button", { name: "Liste", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("1 article ajouté à Été");

  await page.goto("/listes");
  await page.getByRole("link", { name: /Été/ }).click();
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await page.getByTestId("item-card").getByRole("button", { name: "Plus d’actions" }).click();
  await page
    .getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` })
    .getByRole("button", { name: "Ajouter à une liste" })
    .click();
  await page.getByRole("dialog", { name: "Ajouter à une liste" }).getByRole("button", { name: "Été" }).click();
  await expect(toast(page)).toContainText("Retiré de Été");
  // The card leaves the page, its window with it.
  await expect(page.getByTestId("item-card")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cette liste est vide" })).toBeVisible();
});

test("corbeille : restaurer un article, en supprimer un autre pour toujours", async ({ page }) => {
  await pasteAndWish(page);
  await pasteAndWish(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(2);
  const remove = async () => {
    await page.getByTestId("item-card").first().getByRole("button", { name: "Plus d’actions" }).click();
    await page
      .getByRole("dialog", { name: `Actions sur ${PRODUCT.name}` })
      .getByRole("button", { name: "Retirer de mes envies" })
      .click();
    await expect(toast(page)).toContainText("Retiré de tes envies");
  };

  await remove();
  await page.goto("/reglages/corbeille");
  await expect(page.getByText("Effacés automatiquement après 30 jours")).toBeVisible();
  await expect(page.getByTestId("item-card")).toHaveCount(1);
  await axe(page);
  await page.getByRole("button", { name: /^Restaurer/ }).click();
  await expect(toast(page)).toContainText("restauré");
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(2);

  await remove();
  await page.goto("/reglages/corbeille");
  await page.getByRole("button", { name: /^Supprimer définitivement/ }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer définitivement ?" });
  await expect(dialog).toContainText("Tu ne pourras pas annuler");
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(toast(page)).toContainText("supprimé définitivement");
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(1);
});

test("profils : ajouter, réordonner, supprimer ; un profil qui contient des articles est refusé", async ({ page }) => {
  await pasteAndWish(page);
  await page.goto("/reglages/profils");
  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  await axe(page);

  await page.getByRole("button", { name: "Supprimer Moi" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer le profil" }).click();
  await expect(page.getByText("Déplace d’abord ses articles.")).toBeVisible();

  const add = page.getByRole("form", { name: "Nouveau profil" });
  await add.getByLabel("Nom").fill("Léa");
  await add.getByLabel("Public").selectOption("child");
  await add.getByLabel("Précision").selectOption("girl");
  await add.getByLabel("Couleur").selectOption("sky");
  await add.getByRole("button", { name: "Ajouter un profil" }).click();
  await expect(toast(page)).toContainText("Profil « Léa » ajouté");
  const rows = page.getByTestId("profile-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByLabel("Nom")).toHaveValue("Léa");

  await page.getByRole("button", { name: "Monter Léa" }).click();
  await expect(rows.first().getByLabel("Nom")).toHaveValue("Léa");
  // Léa is first now: « Monter » is disabled, the focus moves to its twin.
  await expect(page.getByRole("button", { name: "Descendre Léa" })).toBeFocused();

  await rows.first().getByLabel("Nom").fill("Léa M.");
  await rows.first().getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(toast(page)).toContainText("Profil « Léa M. » enregistré");

  await page.getByRole("button", { name: "Supprimer Léa M." }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer le profil" }).click();
  await expect(toast(page)).toContainText("Profil « Léa M. » supprimé");
  await expect(rows).toHaveCount(1);
});

test("étiquettes : créer, renommer, supprimer", async ({ page }) => {
  await page.goto("/reglages/etiquettes");
  await expect(page.getByText("Aucune étiquette pour l’instant.")).toBeVisible();
  await page.getByLabel("Nouvelle étiquette").fill("Cadeau");
  await page.getByRole("button", { name: "Créer l’étiquette" }).click();
  await expect(page.getByTestId("tag-row")).toHaveCount(1);
  await page.getByLabel("Nouvelle étiquette").fill("cadeau");
  await page.getByRole("button", { name: "Créer l’étiquette" }).click();
  await expect(page.getByText("Une étiquette porte déjà ce nom.")).toBeVisible();
  await axe(page);

  const row = page.getByTestId("tag-row").first();
  await row.getByLabel("Nom").fill("Offert");
  await row.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(toast(page)).toContainText("Étiquette « Offert » enregistrée");
  await page.getByRole("button", { name: "Supprimer Offert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer l’étiquette" }).click();
  await expect(page.getByText("Aucune étiquette pour l’instant.")).toBeVisible();
});

test("l'aide du téléphone s'ouvre depuis les réglages", async ({ page }) => {
  await page.goto("/reglages/profils");
  await page.getByRole("link", { name: "Ajouter depuis le téléphone" }).click();
  await expect(page).toHaveURL(/\/aide\/telephone$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ajouter depuis ton téléphone" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Installer le raccourci" })).toBeVisible();
  await axe(page);
});

test("un jeton inconnu donne une page 404 sans rien révéler", async ({ page }) => {
  const response = await page.goto("/l/AbCdEfGhIjKlMnOpQrStUv");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Ce lien ne marche plus" })).toBeVisible();
});
