import { createHmac } from "node:crypto";
import { schema } from "@closyria/db";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./owned-data";

/** Sign-in codes sent to one e-mail address per window, whatever the client IP. */
export const EMAIL_SEND_MAX = 5;
export const EMAIL_SEND_WINDOW_SECONDS = 3600;
/** Rows whose window ended longer ago than this are deleted. */
export const EMAIL_LIMIT_RETENTION_SECONDS = 24 * 3600;

const { emailRateLimit } = schema;

/** Keyed with the auth secret: without it, the table cannot confirm who requested a code. */
function emailKey(email: string, secret: string): string {
  return createHmac("sha256", secret).update(`email-otp-send:${email.trim().toLowerCase()}`).digest("hex");
}

/**
 * Counts one code sending for `email` and tells whether it is allowed.
 * One atomic upsert: concurrent requests cannot both slip under the limit.
 * Each call also purges stale rows; sends are rare (limited per IP and per e-mail), so this stays cheap.
 */
export async function consumeEmailSend(
  db: DbExecutor,
  email: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  const windowStartedBefore = now - EMAIL_SEND_WINDOW_SECONDS * 1000;
  await db.execute(
    sql`delete from ${emailRateLimit} where ${emailRateLimit.windowStart} < ${windowStartedBefore - EMAIL_LIMIT_RETENTION_SECONDS * 1000}`,
  );
  const result = await db.execute<{ count: number }>(sql`
    insert into ${emailRateLimit} (key, count, window_start)
    values (${emailKey(email, secret)}, 1, ${now})
    on conflict (key) do update set
      count = case when ${emailRateLimit.windowStart} <= ${windowStartedBefore} then 1 else ${emailRateLimit.count} + 1 end,
      window_start = case when ${emailRateLimit.windowStart} <= ${windowStartedBefore} then ${now} else ${emailRateLimit.windowStart} end
    returning count`);
  return (result.rows[0]?.count ?? Number.POSITIVE_INFINITY) <= EMAIL_SEND_MAX;
}
