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
