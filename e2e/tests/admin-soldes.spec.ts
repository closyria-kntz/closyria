import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { signInAsAdmin } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

// Chantier 4 « Alertes », task 7 (docs/specs/2026-11-14-alertes.md §6): the admin enters the sales periods (name, first
// and last day; the end on or after the start) and reads the notifications line of the dashboard. The database is
// shared by the whole suite: each test names its period with a unique tag, in 2031 (no notice falls due).

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

test("une admin ajoute, modifie puis supprime une période de soldes", async ({ page, request, db, userAgentTag }) => {
  const name = `Soldes e2e ${randomUUID().slice(0, 8)}`;
  try {
    await signInAsAdmin(page, request, db, userAgentTag);
    await page.goto("/admin");
    await page
      .getByRole("navigation", { name: "Navigation de l’administration" })
      .getByRole("link", { name: "Soldes" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Soldes" })).toBeVisible();

    const form = page.getByRole("form", { name: "Ajouter une période" });
    await form.getByLabel("Nom").fill(name);
    await form.getByLabel("Premier jour").fill("2031-01-08");
    await form.getByLabel("Dernier jour").fill("2031-01-07");
    await form.getByRole("button", { name: "Ajouter la période" }).click();
    await expect(form.getByText("Le dernier jour doit être le premier jour ou après.")).toBeVisible();

    await form.getByLabel("Dernier jour").fill("2031-02-04");
    await form.getByRole("button", { name: "Ajouter la période" }).click();
    await expect(form.getByText("Période enregistrée.")).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByText("Du 8 janvier 2031 au 4 février 2031")).toBeVisible();
    await expect(row.getByText("À venir")).toBeVisible();
    await axeLightAndDark(page);

    await row.getByRole("button", { name: `Modifier ${name}` }).click();
    const edit = page.getByRole("form", { name: `Modifier « ${name} »` });
    await expect(edit.getByLabel("Nom")).toHaveValue(name);
    await edit.getByLabel("Dernier jour").fill("2031-01-08");
    await edit.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByRole("form", { name: "Ajouter une période" }).getByText("Période enregistrée."),
    ).toBeVisible();
    await expect(row.getByText("Le 8 janvier 2031")).toBeVisible();

    await row.getByRole("button", { name: `Supprimer ${name}` }).click();
    await row.getByRole("button", { name: "Oui, supprimer" }).click();
    await expect(page.getByText("Période supprimée.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);

    // Every change is journalled.
    const { rows } = await db.query<{ action: string }>(
      "select action from admin_audit_log where details->>'name' = $1 order by created_at",
      [name],
    );
    expect(rows.map((r) => r.action)).toEqual(["sale_period.create", "sale_period.update", "sale_period.delete"]);
  } finally {
    await db.query("delete from sale_periods where name = $1", [name]);
  }
});

test("le tableau de bord donne la ligne des notifications sur 7 jours", async ({ page, request, db, userAgentTag }) => {
  await signInAsAdmin(page, request, db, userAgentTag);
  await page.goto("/admin");
  await expect(page.getByTestId("notifications-line")).toHaveText(
    /^Notifications : \d+ envois?, \d+ en échec \(7 j\) · \d+ appareils?$/,
  );
  await axeLightAndDark(page);
});
