import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Chantier 2a, task 16: lists and sharing, the public page, settings (profiles, tags, trash), the iPhone help.

async function keepFavorite(page: Page, details?: { size: string; notes: string }): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Favori" }).click();
  await expect(page.getByRole("heading", { name: "Mon article" })).toBeVisible();
  if (details) {
    await page.getByLabel("Taille", { exact: true }).fill(details.size);
    await page.getByLabel("Notes").fill(details.notes);
    await page.getByRole("button", { name: "Enregistrer" }).click();
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
  await keepFavorite(page, { size: "XL-secrète", notes: "Note-privée-42" });
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
    .getByRole("region", { name: `Actions sur ${PRODUCT.name}` })
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
  await expect(page.getByText("Cliquer de nouveau sur « Partager » crée un nouveau lien")).toBeVisible();
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

  // The old link stops working when sharing again; the new one is shown.
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  await expect(field).not.toHaveValue(shareUrl);
  const second = await field.inputValue();
  expect((await other.goto(shareUrl))?.status()).toBe(404);
  expect((await other.goto(second))?.status()).toBe(200);

  await page.getByRole("button", { name: "Arrêter le partage" }).click();
  await expect(toast(page)).toContainText("Partage arrêté");
  const gone = await other.goto(second);
  expect(gone?.status()).toBe(404);
  await expect(other.getByRole("heading", { name: "Ce lien ne marche plus" })).toBeVisible();
  await visitor.close();
});

test("une liste se renomme, se réordonne au clavier et se supprime", async ({ page }) => {
  await keepFavorite(page);
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
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Voyage" })).toBeVisible();

  await page.getByRole("button", { name: "Supprimer la liste" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer la liste" }).click();
  await expect(page).toHaveURL(/\/listes$/);
  await expect(page.getByRole("link", { name: /Voyage/ })).toHaveCount(0);
});

test("corbeille : restaurer un article, en supprimer un autre pour toujours", async ({ page }) => {
  await keepFavorite(page);
  await keepFavorite(page);
  await page.goto("/envies");
  await expect(page.getByTestId("item-card")).toHaveCount(2);
  const remove = async () => {
    await page.getByTestId("item-card").first().getByRole("button", { name: "Plus d’actions" }).click();
    await page
      .getByRole("region", { name: `Actions sur ${PRODUCT.name}` })
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
  await keepFavorite(page);
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
  await rows.first().getByRole("button", { name: "Enregistrer" }).click();
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
  await row.getByRole("button", { name: "Enregistrer" }).click();
  await expect(toast(page)).toContainText("Étiquette « Offert » enregistrée");
  await page.getByRole("button", { name: "Supprimer Offert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer l’étiquette" }).click();
  await expect(page.getByText("Aucune étiquette pour l’instant.")).toBeVisible();
});

test("l'aide iPhone explique le Raccourci en 4 étapes, depuis les réglages", async ({ page }) => {
  await page.goto("/reglages/profils");
  await page.getByRole("link", { name: "Aide iPhone" }).click();
  await expect(page).toHaveURL(/\/aide\/iphone$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ajouter Closyria au menu Partager" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Les 4 étapes" }).getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("https://closyria.com/partager?url=")).toBeVisible();
  await expect(page.getByText("Ouvrir les URL")).toBeVisible();
  await axe(page);
});

test("un jeton inconnu donne une page 404 sans rien révéler", async ({ page }) => {
  const response = await page.goto("/l/AbCdEfGhIjKlMnOpQrStUv");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Ce lien ne marche plus" })).toBeVisible();
});
