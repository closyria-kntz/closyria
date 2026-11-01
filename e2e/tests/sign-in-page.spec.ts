import AxeBuilder from "@axe-core/playwright";
import { readCode, sessionsOf, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

test("on se connecte depuis la page /connexion, et la session anonyme devient le compte (R19)", async ({
  page,
  request,
  db,
  userAgentTag,
}, testInfo) => {
  // A visitor who already used the app anonymously.
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const anonymous = await page.evaluate(() => window.closyriaE2E.session());
  expect(anonymous).toMatchObject({ isAnonymous: true });

  // `next` pointing to another site is ignored: back to the home page after sign-in.
  await page.goto("/connexion?next=//evil.example/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).analyze();
  for (const v of violations) testInfo.annotations.push({ type: `axe (${v.impact})`, description: v.id });
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  const email = uniqueEmail();
  await page.getByLabel("Ton e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir mon code" }).click();

  const codeField = page.getByLabel("Code à 6 chiffres");
  await expect(codeField).toBeFocused();
  await expect(codeField).toHaveAttribute("autocomplete", "one-time-code");
  await expect(codeField).toHaveAttribute("inputmode", "numeric");

  // A wrong code first: a plain message, and one can try again.
  await codeField.fill("000000");
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("alert")).toContainText("Ce code ne marche pas");

  await codeField.fill(await readCode(request, email));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await page.waitForURL((url) => url.pathname === "/" && url.host !== "evil.example");

  const session = await page.evaluate(() => window.closyriaE2E.session());
  // Linked: the same browser now holds the account, and the anonymous user is gone.
  expect(session).toMatchObject({ email, isAnonymous: false });
  const rows = await sessionsOf(db, userAgentTag);
  expect(rows).toEqual([expect.objectContaining({ email, isAnonymous: false, authMethod: "email-otp" })]);
  const { rowCount } = await db.query('select 1 from "user" where id = $1', [anonymous?.userId]);
  expect(rowCount).toBe(0);
});
