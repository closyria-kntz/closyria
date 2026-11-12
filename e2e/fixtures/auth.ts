import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import type pg from "pg";
import { z } from "zod";
import { expect } from "./test";

const emailsSchema = z.object({
  messages: z.array(z.object({ to: z.string(), subject: z.string(), text: z.string() })),
});

/** A fresh address per call: the per-address send limit never carries over between tests. */
export const uniqueEmail = () => `e2e-${randomUUID()}@example.com`;

/** The last sign-in code sent to `email`, read through the APP_ENV=test e-mail route (R18). */
export async function readCode(request: APIRequestContext, email: string): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/test/emails?to=${encodeURIComponent(email)}`);
        expect(res.status()).toBe(200);
        const { messages } = emailsSchema.parse(await res.json());
        code = messages.at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
        return code;
      },
      { message: `a sign-in code for ${email}` },
    )
    .toMatch(/^\d{6}$/);
  return code as string;
}

/** Asks for a code from the page, reads it from the test mailbox and signs in with it. */
export async function signInWithEmailCode(page: Page, request: APIRequestContext, email: string): Promise<void> {
  expect(await page.evaluate((to) => window.closyriaE2E.sendCode(to), email)).toEqual({ ok: true });
  const code = await readCode(request, email);
  expect(
    await page.evaluate(([to, otp]) => window.closyriaE2E.signInWithCode(to, otp), [email, code] as const),
  ).toEqual({ ok: true });
}

export type SessionRow = { userId: string; isAnonymous: boolean; email: string; authMethod: string };

/** The sessions opened by one test's browser (its user agent tag), oldest first. */
export async function sessionsOf(db: pg.Pool, userAgentTag: string): Promise<SessionRow[]> {
  const { rows } = await db.query<SessionRow>(
    `select s.user_id as "userId", coalesce(u.is_anonymous, false) as "isAnonymous", u.email,
            s.auth_method as "authMethod"
       from session s join "user" u on u.id = s.user_id
      where right(s.user_agent, length($1)) = $1
      order by s.created_at`,
    [userAgentTag],
  );
  return rows;
}

/**
 * An admin session as the access rule sees it: role `admin`, session opened with a passkey. The browser
 * signs in with an e-mail code, then the test database marks the user admin and this test's session
 * (`userAgentTag`) as a passkey one. A real WebAuthn ceremony is impossible here: the suite runs on
 * http://127.0.0.1, and an IP address is never a valid WebAuthn relying party.
 */
export async function signInAsAdmin(
  page: Page,
  request: APIRequestContext,
  db: pg.Pool,
  userAgentTag: string,
): Promise<void> {
  const email = uniqueEmail();
  await page.goto("/");
  await signInWithEmailCode(page, request, email);
  await db.query(`update "user" set role = 'admin' where email = $1`, [email]);
  const { rowCount } = await db.query(
    `update session s set auth_method = 'passkey' from "user" u
      where u.id = s.user_id and u.email = $1 and right(s.user_agent, length($2)) = $2`,
    [email, userAgentTag],
  );
  expect(rowCount).toBe(1);
}
