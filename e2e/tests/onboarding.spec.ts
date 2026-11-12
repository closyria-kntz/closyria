import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { sessionsOf, signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { CLIENT_IP_HEADER } from "../fixtures/proxy";
import { autoProductUrl, keepWish, PRODUCT } from "../fixtures/shops";
import { expect, test } from "../fixtures/test";

// Refonte Boudoir, task 7 (spec R8): the first-opening discovery in 3 screens, once per account, guests included
// (skipped or finished, it never comes back, on any browser of the account); an account that already keeps articles
// never gets it; a tip closed on one browser stays closed on the others. The real answers of /api/me/preferences
// here (the other specs count the discovery as seen, see fixtures/test.ts).

test.use({ discovery: true });

const STEPS = [
  {
    title: "Garde tes envies, on veille pour toi",
    text: "Colle le lien d'un vêtement : on te prévient quand le prix baisse ou quand ta taille revient.",
  },
  {
    title: "Demande l'avis de tes amies",
    text: "Partage une liste : elles donnent leur avis, t'offrent un article ou commandent avec toi.",
  },
  {
    title: "Range ton dressing",
    text: "Retrouve tout ce que tu as, ce que tu attends et ce que tu vends au même endroit.",
  },
] as const;

const axe = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }))).toEqual([]);
};

const discovery = (page: Page) => page.getByRole("dialog", { name: /Garde tes envies|Demande l'avis|Range ton/ });

/** A new account on this page: signed in with a code, the discovery not marked as seen. */
async function newAccount(page: Page, request: Parameters<typeof signInWithEmailCode>[1], email = uniqueEmail()) {
  await page.goto("/");
  await signInWithEmailCode(page, request, email);
  return email;
}

/** Clicks `name` in `scope` and waits until her account saved the change. */
async function clickAndSave(page: Page, scope: Locator, name: string) {
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/me/preferences") && r.request().method() === "PATCH" && r.ok(),
  );
  await scope.getByRole("button", { name }).click();
  await saved;
}

async function pasteAndWish(page: Page) {
  await page.goto("/");
  await page.getByLabel("Coller un lien").fill(autoProductUrl());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCT.name })).toBeVisible({ timeout: 10_000 });
  await keepWish(page);
}

test("la découverte s’affiche à la première ouverture d’un compte, en 3 écrans, puis plus jamais", async ({
  page,
  request,
  db,
}) => {
  const email = await newAccount(page, request);
  await page.goto("/");
  const dialog = discovery(page);
  await expect(dialog).toBeVisible();
  for (const [index, step] of STEPS.entries()) {
    await expect(dialog.getByText(`${index + 1} sur 3`)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: step.title })).toBeVisible();
    await expect(dialog.getByText(step.text)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Passer" })).toBeVisible();
    if (index === 0) {
      await page.emulateMedia({ colorScheme: "light" });
      await axe(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await axe(page);
      await page.emulateMedia({ colorScheme: "light" });
    }
    await dialog.getByRole("button", { name: index < 2 ? "Continuer" : "C’est parti" }).click();
  }
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const { rows } = await db.query<{ onboarded_at: Date | null }>(
        `select onboarded_at from "user" where email = $1`,
        [email],
      );
      return rows[0]?.onboarded_at !== null && rows[0]?.onboarded_at !== undefined;
    })
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(discovery(page)).toHaveCount(0);
});

/** Her other browser (no cookie, no storage), signed in to the same account. */
async function otherBrowser(
  browser: Browser,
  baseURL: string | undefined,
  script: string,
  request: Parameters<typeof signInWithEmailCode>[1],
  email: string,
): Promise<{ page: Page; context: BrowserContext }> {
  // Her own address too (the sign-in code limits count per address).
  const address = `10.201.${randomInt(250)}.${randomInt(1, 250)}`;
  const context = await browser.newContext({
    baseURL: baseURL ?? "",
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: address },
  });
  await context.addInitScript({ content: script });
  const page = await context.newPage();
  await page.goto("/");
  await signInWithEmailCode(page, request, email);
  return { page, context };
}

test("« Passer » la ferme pour de bon, même sur un autre navigateur du même compte", async ({
  page,
  request,
  browser,
  baseURL,
  browserAuthScript,
}) => {
  const email = await newAccount(page, request);
  await page.goto("/moi");
  const dialog = discovery(page);
  await expect(dialog.getByText("1 sur 3")).toBeVisible();
  await clickAndSave(page, dialog, "Passer");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(discovery(page)).toHaveCount(0);

  const other = await otherBrowser(browser, baseURL, browserAuthScript, request, email);
  await other.page.goto("/");
  await expect(other.page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(discovery(other.page)).toHaveCount(0);
  await other.context.close();
});

test("une astuce fermée ne revient pas, même sur un autre navigateur du même compte", async ({
  page,
  request,
  browser,
  baseURL,
  browserAuthScript,
}) => {
  const email = await newAccount(page, request);
  await page.goto("/");
  await clickAndSave(page, discovery(page), "Passer");
  await pasteAndWish(page);
  await page.goto("/");
  const tip = page.getByRole("complementary", { name: "Astuce" });
  await expect(tip).toContainText("Touche deux fois la photo d’un article");
  await clickAndSave(page, tip, "Fermer l’astuce");
  await expect(tip).toHaveCount(0);

  const other = await otherBrowser(browser, baseURL, browserAuthScript, request, email);
  await other.page.goto("/");
  await expect(other.page.getByRole("region", { name: "Tes envies du moment" })).toBeVisible();
  await expect(other.page.getByRole("complementary", { name: "Astuce" })).toHaveCount(0);
  await other.context.close();
});

test("une visiteuse sans compte la voit à sa première ouverture, une seule fois", async ({
  page,
  db,
  userAgentTag,
}) => {
  await page.goto("/");
  const dialog = discovery(page);
  await expect(dialog.getByText("1 sur 3")).toBeVisible();
  // Skipping opens her guest session, which keeps it.
  await clickAndSave(page, dialog, "Passer");
  await expect(dialog).toHaveCount(0);
  const [session] = await sessionsOf(db, userAgentTag);
  expect(session?.isAnonymous).toBe(true);
  const { rows } = await db.query<{ onboarded_at: Date | null }>(`select onboarded_at from "user" where id = $1`, [
    session?.userId,
  ]);
  expect(rows[0]?.onboarded_at).not.toBeNull();
  for (const path of ["/", "/moi", "/articles"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(discovery(page)).toHaveCount(0);
  }
});

test.describe("un compte qui a déjà des articles", () => {
  // Her articles are added with the discovery counted as seen (fixtures), then the API's own answer is read.
  test.use({ discovery: false });

  test("est compté comme l’ayant vue, invitée comme après sa connexion", async ({ page, request }) => {
    const seen = async () => {
      const res = await page.request.get("/api/me/preferences");
      expect(res.status()).toBe(200);
      return ((await res.json()) as { onboardedAt: string | null }).onboardedAt;
    };
    await pasteAndWish(page);
    expect(await seen()).not.toBeNull();
    // She signs in to a new account: her articles come with her, she already knows Closyria.
    await signInWithEmailCode(page, request, uniqueEmail());
    expect(await seen()).not.toBeNull();
  });
});
