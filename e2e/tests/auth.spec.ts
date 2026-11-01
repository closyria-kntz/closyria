import { sessionsOf, signInWithEmailCode, uniqueEmail } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

const SESSION_COOKIE = /session_token$/;

test("la première action ouvre une session anonyme, une seule", async ({ page, context, db, userAgentTag }) => {
  await page.goto("/");
  // Reading the home page creates nothing.
  expect(await page.evaluate(() => window.closyriaE2E.session())).toBeNull();
  expect(await sessionsOf(db, userAgentTag)).toEqual([]);

  // The first action calls ensureSession; a second one reuses the session.
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });

  const session = await page.evaluate(() => window.closyriaE2E.session());
  expect(session).toMatchObject({ isAnonymous: true });
  expect((await context.cookies()).some((cookie) => SESSION_COOKIE.test(cookie.name))).toBe(true);
  const rows = await sessionsOf(db, userAgentTag);
  expect(rows).toEqual([
    expect.objectContaining({ userId: session?.userId, isAnonymous: true, authMethod: "anonymous" }),
  ]);
});

test("deux onglets ouverts en même temps à la première visite n'ont qu'une session anonyme (R7)", async ({
  context,
  db,
  userAgentTag,
}) => {
  const tabs = [await context.newPage(), await context.newPage()];
  await Promise.all(tabs.map((tab) => tab.goto("/")));
  // Both first actions start together, with no cookie yet: Web Locks serialise them across tabs.
  const results = await Promise.all(tabs.map((tab) => tab.evaluate(() => window.closyriaE2E.ensureSession())));
  expect(results).toEqual([{ ok: true }, { ok: true }]);

  const sessions = await Promise.all(tabs.map((tab) => tab.evaluate(() => window.closyriaE2E.session())));
  expect(sessions[0]?.userId).toBeTruthy();
  expect(sessions[1]?.userId).toBe(sessions[0]?.userId);
  const rows = await sessionsOf(db, userAgentTag);
  expect(new Set(rows.map((row) => row.userId)).size).toBe(1);
  expect(rows).toHaveLength(1);
});

test("on se connecte avec le code reçu par e-mail", async ({ page, request, db, userAgentTag }) => {
  await page.goto("/");
  expect(await page.evaluate(() => window.closyriaE2E.ensureSession())).toEqual({ ok: true });
  const email = uniqueEmail();

  await signInWithEmailCode(page, request, email);

  expect(await page.evaluate(() => window.closyriaE2E.session())).toMatchObject({ email, isAnonymous: false });
  // The anonymous user was replaced by the account (its data would follow it).
  const rows = await sessionsOf(db, userAgentTag);
  expect(rows).toEqual([expect.objectContaining({ email, isAnonymous: false, authMethod: "email-otp" })]);
  // The session survives a reload: it lives in the cookie, not in the page.
  await page.reload();
  expect(await page.evaluate(() => window.closyriaE2E.session())).toMatchObject({ email });
});
