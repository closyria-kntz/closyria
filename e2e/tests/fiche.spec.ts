import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 4: the article's sheet shows where it is (« Envie · Commandé · Reçu · Dans mon dressing ») and
// « Que veux-tu faire ? », written buttons by step, the main one first; none of them hides behind « … ».

const STEPS = ["Envie", "Commandé", "Reçu", "Dans mon dressing"];
const SHOP = "Voir chez Fausse boutique";

const progress = (page: Page) => page.getByRole("list", { name: "Où en est cet article" });
const todo = (page: Page) => page.getByRole("region", { name: "Que veux-tu faire ?" });
const toast = (page: Page) => page.getByRole("status", { name: "Notifications" });

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

/** Pastes a fresh address of the fake shop's product, keeps it as a wish; returns her item's id. */
async function keptSheet(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
  const { items } = (await (await page.request.get("/api/me/items")).json()) as { items: { id: string }[] };
  const id = items[0]?.id;
  if (!id) throw new Error("no item");
  return id;
}

/** The line names the four steps, `current` underlined and marked as the current step; `status` the chip after it. */
async function expectStep(page: Page, current: string, status: string | null = null) {
  const line = progress(page);
  await expect(line.getByRole("listitem")).toHaveText(STEPS.map((step) => new RegExp(`^${step}`)));
  await expect(line.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(line.locator('[aria-current="step"]')).toContainText(current);
  const chip = page.getByTestId("stage-status");
  if (status) await expect(chip).toHaveText(status);
  else await expect(chip).toHaveCount(0);
}

/** The written buttons, in order, every one visible and a finger tall; the first is the main one. */
async function expectActions(page: Page, names: string[]) {
  const targets = todo(page).locator("a, button");
  await expect(targets).toHaveText(names);
  for (const target of await targets.all()) {
    await expect(target).toBeVisible();
    expect((await boxOf(target)).height).toBeGreaterThanOrEqual(44);
  }
  await expect(targets.first()).toHaveAttribute("data-primary", "true");
  await expect(todo(page).locator('[data-primary="true"]')).toHaveCount(1);
}

const boxOf = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error("no box");
  return found;
};

/** Through the stage window of the sheet (date today), as « Je l'ai commandé » and its kin open it. */
async function confirmStage(page: Page, button: string, stage: string) {
  await todo(page).getByRole("button", { name: button }).click();
  const dialog = page.getByRole("dialog", { name: `Passer à « ${stage} »` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Valider" }).click();
  await expect(dialog).toBeHidden();
  await expect(toast(page)).toContainText(`Étape : ${stage}`);
}

test("d'Envie à À vendre : la ligne marque la bonne étape et chaque action principale est un bouton qui marche", async ({
  page,
  db,
}) => {
  test.slow();
  const id = await keptSheet(page);

  // Envie.
  await expectStep(page, "Envie");
  await expect(todo(page).getByRole("heading", { name: "Que veux-tu faire ?" })).toBeVisible();
  await expectActions(page, ["Je l’ai commandé", SHOP, "Ajouter à une liste", "Je le prends", "Partager"]);
  await todo(page).getByRole("button", { name: "Ajouter à une liste" }).click();
  const lists = page.getByRole("dialog", { name: "Ajouter à une liste" });
  await expect(lists).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lists).toBeHidden();
  await axeLightAndDark(page);

  // Commandé.
  await confirmStage(page, "Je l’ai commandé", "Commandé");
  await expectStep(page, "Commandé");
  await expectActions(page, ["Je l’ai reçu", SHOP, "Je l’ai retourné", "Reçu en cadeau", "Partager"]);
  await axeLightAndDark(page);

  // Reçu (moved today).
  await confirmStage(page, "Je l’ai reçu", "Reçu");
  await expectStep(page, "Reçu");
  await expectActions(page, ["Je le mets en vente", SHOP, "Je l’ai retourné", "Ajouter une photo", "Partager"]);
  await todo(page).getByRole("button", { name: "Ajouter une photo" }).click();
  const photo = page.getByRole("dialog", { name: "Ajouter une photo" });
  await expect(photo).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(photo).toBeHidden();

  // Dans mon dressing: received more than 30 days ago (the server tells).
  await db.query(
    "update item_events set at = now() - interval '60 days' where item_id = $1 and type = 'stage' and stage = 'owned'",
    [id],
  );
  await page.reload();
  await expectStep(page, "Dans mon dressing");
  await expectActions(page, ["Je le mets en vente", SHOP, "Ajouter une photo", "Partager"]);
  await axeLightAndDark(page);

  // À vendre: the line stays on « Dans mon dressing », a small chip says the rest.
  await confirmStage(page, "Je le mets en vente", "À vendre");
  await expectStep(page, "Dans mon dressing", "À vendre");
  await expectActions(page, ["Je l’ai vendu", SHOP, "Ajouter une photo", "Partager"]);
  await axeLightAndDark(page);
});

test("« Je l’ai retourné » depuis Commandé : la ligne garde « Dans mon dressing » et la pastille dit « Retourné »", async ({
  page,
}) => {
  await keptSheet(page);
  await confirmStage(page, "Je l’ai commandé", "Commandé");
  await confirmStage(page, "Je l’ai retourné", "Retourné");
  await expectStep(page, "Dans mon dressing", "Retourné");
  await expect(todo(page).locator('[data-primary="true"]')).toHaveCount(1);
});

test("« Reçu en cadeau » depuis Commandé passe à Reçu", async ({ page }) => {
  await keptSheet(page);
  await confirmStage(page, "Je l’ai commandé", "Commandé");
  await todo(page).getByRole("button", { name: "Reçu en cadeau" }).click();
  await expect(toast(page)).toContainText("Reçu en cadeau");
  await expectStep(page, "Reçu");
  await expect(page.getByText("Offert par une amie")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reçu en cadeau" })).toHaveCount(0);
});

test("fiche non gardée : pas de ligne d'avancée, « Voir chez » et « Partager » sous « Que veux-tu faire ? »", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await expect(progress(page)).toHaveCount(0);
  await expectActions(page, [SHOP, "Partager"]);
  // « ← Mes articles » on a phone.
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await expect(page.getByRole("link", { name: "← Mes articles" })).toHaveAttribute("href", "/articles");
  }
  await axeLightAndDark(page);
});

test("le « … » d'une carte parle comme la fiche : « Je l’ai reçu », « Je l’ai retourné »", async ({ page }) => {
  await keptSheet(page);
  await confirmStage(page, "Je l’ai commandé", "Commandé");
  await page.goto("/articles?etape=commande");
  const card = page.getByTestId("item-card").first();
  await card.getByRole("button", { name: /Plus d’actions/ }).click();
  const menu = page.getByRole("dialog", { name: /Actions sur/ });
  await expect(menu.getByRole("button", { name: "Je l’ai reçu" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Je l’ai retourné" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Reçu", exact: true })).toHaveCount(0);
});

test("« Mon article » : un seul bouton « Changer d’étape » ouvre toutes les étapes, retour en Envie compris", async ({
  page,
}) => {
  await keptSheet(page);
  await confirmStage(page, "Je l’ai commandé", "Commandé");
  const mine = page.getByRole("region", { name: "Mon article" });
  await expect(mine.getByRole("button", { name: /Passer à/ })).toHaveCount(0);
  const change = mine.getByRole("button", { name: "Changer d’étape" });
  await change.click();
  const choices = page.getByRole("dialog", { name: "Changer d’étape" });
  await expect(choices.getByRole("button")).toHaveText([
    "Fermer",
    "Envie",
    "Commandé",
    "Reçu",
    "Retourné",
    "À vendre",
    "Vendu",
  ]);
  await expect(choices.getByRole("button", { name: /Commandé \(étape actuelle\)/ })).toBeDisabled();
  await choices.getByRole("button", { name: "Passer à « Envie »" }).click();
  const dialog = page.getByRole("dialog", { name: "Passer à « Envie »" });
  await dialog.getByRole("button", { name: "Valider" }).click();
  await expect(toast(page)).toContainText("Étape : Envie");
  await expectStep(page, "Envie");
  // Back on a wish, « Reçu en cadeau » is one of the choices.
  await change.click();
  await expect(choices.getByRole("button", { name: "Reçu en cadeau" })).toBeVisible();
  await axeLightAndDark(page);
});
