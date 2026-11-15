import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { signInAsAdmin } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// « Après la commande » Task 8 (docs/specs/2026-11-14-apres-commande.md §4): a shop's return delay and returns page,
// « E-mails de commande » (figures only, the AI's monthly cap) and the dashboard's parcel tiles. The database is shared
// by the whole suite: the shop is tagged, the cap is put back as it was.

const axe = async (page: Page) => {
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

test("une admin règle le délai et la page des retours d’une boutique", async ({ page, request, db, userAgentTag }) => {
  const tag = randomUUID().slice(0, 8);
  const { rows } = await db.query<{ id: string }>(
    "insert into shops (name, slug, status) values ($1, $2, 'published') returning id",
    [`Retours ${tag}`, `retours-${tag}`],
  );
  const shopId = rows[0]?.id as string;
  try {
    await signInAsAdmin(page, request, db, userAgentTag);
    await page.goto(`/admin/boutiques/${shopId}`);
    const block = page.getByRole("region", { name: "Retours et colis" });
    await expect(block.getByTestId("return-days")).toHaveValue("14");
    await expect(block.getByTestId("carriers-seen")).toHaveText(
      "Aucun colis suivi pour cette boutique pour l’instant.",
    );

    await block.getByLabel("Délai de retour (jours)").fill("400");
    await block.getByRole("button", { name: "Enregistrer les retours" }).click();
    await expect(block.getByText("Le délai doit être un nombre entier de jours, de 0 à 365.")).toBeVisible();

    await block.getByLabel("Délai de retour (jours)").fill("30");
    await block.getByLabel("Page des retours").fill("http://retours.example/lila");
    await block.getByRole("button", { name: "Enregistrer les retours" }).click();
    await expect(block.getByText("La page des retours doit être une adresse complète en https://.")).toBeVisible();

    await block.getByLabel("Page des retours").fill("https://retours.example/lila");
    await block.getByRole("button", { name: "Enregistrer les retours" }).click();
    await expect(block.getByText("Retours enregistrés.")).toBeVisible();
    await expect
      .poll(async () => (await db.query("select return_days, returns_url from shops where id = $1", [shopId])).rows[0])
      .toEqual({ return_days: 30, returns_url: "https://retours.example/lila" });
    await axeLightAndDark(page);
  } finally {
    await db.query("delete from shops where id = $1", [shopId]);
  }
});

test("« E-mails de commande » donne les chiffres et le plafond IA, sans contenu personnel", async ({
  page,
  request,
  db,
  userAgentTag,
}, testInfo) => {
  const key = "ai_monthly_cap_cents";
  // The cap is one row shared by the whole suite: changed by one device only, so two never race on it.
  const editsCap = testInfo.project.name === "Desktop Chrome";
  const before = (await db.query<{ value: unknown }>("select value from app_settings where key = $1", [key])).rows[0];
  try {
    await signInAsAdmin(page, request, db, userAgentTag);
    await page.goto("/admin");
    await expect(page.getByTestId("parcel-figures").getByText("Colis suivis")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Navigation de l’administration" })
      .getByRole("link", { name: "E-mails de commande" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "E-mails de commande" })).toBeVisible();
    await expect(page.getByTestId("order-email-counts").getByText("Reçus")).toBeVisible();
    // Figures only: no sender address anywhere on the page.
    await expect(page.locator("main")).not.toContainText("@");
    if (!editsCap) return await axeLightAndDark(page);

    const cap = page.getByLabel("Plafond du mois (€)");
    await cap.fill("dix");
    await page.getByRole("button", { name: "Enregistrer le plafond" }).click();
    await expect(
      page.getByText("Indique un montant en euros, de 0 à 1 000, avec au plus deux décimales."),
    ).toBeVisible();

    await cap.fill("12,50");
    await page.getByRole("button", { name: "Enregistrer le plafond" }).click();
    await expect(page.getByText("Plafond enregistré.")).toBeVisible();
    await expect(page.getByTestId("ai-month")).toContainText("12,50");
    await expect
      .poll(async () => (await db.query("select value from app_settings where key = $1", [key])).rows[0]?.value)
      .toBe(1250);
    await axeLightAndDark(page);
  } finally {
    if (editsCap && before) {
      await db.query("update app_settings set value = $2 where key = $1", [key, JSON.stringify(before.value)]);
    } else if (editsCap) {
      await db.query("delete from app_settings where key = $1", [key]);
    }
  }
});
