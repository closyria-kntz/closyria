import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { type Mailer, senderCodeEmail } from "@closyria/auth";
import { and, asc, count, type Database, eq, schema, sql } from "@closyria/db";
import {
  MAX_SENDER_ADDRESSES,
  SENDER_CODE_LENGTH,
  SENDER_CODE_MAX_ATTEMPTS,
  SENDER_CODE_MINUTES,
  SENDER_RESEND_SECONDS,
  SENDER_SENDS_PER_HOUR,
  SENDER_TARGET_SENDS_PER_DAY,
  type SenderAddressView,
  senderAddressInputSchema,
  senderAddressListSchema,
  senderAddressViewSchema,
  senderCodeInputSchema,
  senderRateLimitedSchema,
  wardrobeErrorSchema,
} from "@closyria/shared";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { type AccessEnv, defineAccess } from "../../access";
import { pgCode } from "../../pg-code";

/**
 * « Mes adresses d'envoi » (spec §11): the other mailboxes she forwards her order e-mails from. Adding one sends a
 * 6-digit code to it; once the code is typed back the address counts as hers for the reception (inbound/receive.ts),
 * with the same authentication checks as her account address. The code is never returned nor logged: only its
 * HMAC-SHA256 under a random salt of its own is kept, 15 minutes, 5 tries.
 */

export type OrderSenderDeps = {
  db: Database;
  /** E-mails are received here (INBOUND_EMAIL_SECRET set); false: every route answers 409 `inbound_off`. */
  receiving: boolean;
  /** The sign-in codes' mailer (Brevo, or the memory one of the tests). */
  mailer?: Mailer;
  now?: () => Date;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_EMAIL_ROWS = MAX_SENDER_ADDRESSES - 1; // the account address takes one place

const invalidRequest = { error: "invalid_request" } as const;
const accountRequired = { error: "account_required" } as const;
const inboundOff = { error: "inbound_off" } as const;
const notFound = { error: "not_found" } as const;
const emailUnverified = { error: "email_unverified" } as const;
const mailFailed = { error: "mail_failed" } as const;

const errorContent = (description: string) => ({
  description,
  content: { "application/json": { schema: wardrobeErrorSchema } },
});
const viewContent = (description: string) => ({
  description,
  content: { "application/json": { schema: senderAddressViewSchema } },
});
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({ id: z.uuid() });
const common = {
  400: errorContent("Invalid body or id (invalid_request)"),
  403: errorContent("A guest (account_required), or an account whose e-mail is not verified (email_unverified)"),
  409: errorContent("E-mails are not received in this environment (inbound_off), or a state that refuses it"),
};
const notFoundContent = errorContent("Unknown, or another account's, address (not_found)");
const rateLimitedContent = (description: string) => ({
  description,
  content: { "application/json": { schema: senderRateLimitedSchema } },
});
const PATH = "/me/order-inbox/senders";

const listRoute = defineAccess(
  createRoute({
    method: "get",
    path: PATH,
    summary: "« Mes adresses d'envoi »: her account address and those she added",
    description:
      "The account address first (always hers, never removable), then the added ones, oldest first, verified or " +
      "waiting for their code. Accounts only; 409 `inbound_off` while e-mails are not received here.",
    responses: {
      200: { description: "Her addresses", content: { "application/json": { schema: senderAddressListSchema } } },
      403: common[403],
      409: common[409],
    },
  }),
  "user",
);

const addRoute = defineAccess(
  createRoute({
    method: "post",
    path: PATH,
    summary: "Add an address: a 6-digit code is sent to it",
    description:
      "The address is trimmed and lowercased (plain ASCII only). 409 `sender_exists` for her account address or one " +
      `already added, \`sender_limit\` beyond ${MAX_SENDER_ADDRESSES} (the account's included). Each code sent counts: ` +
      `${SENDER_SENDS_PER_HOUR} an hour per account and ${SENDER_TARGET_SENDS_PER_DAY} a day to one address, whatever ` +
      "the account (429 `rate_limited` with `retryAfterSeconds`, nothing added). 502 `mail_failed` when the e-mail " +
      "did not leave: nothing added, nothing counted.",
    request: body(senderAddressInputSchema),
    responses: {
      201: viewContent("Added, waiting for its code"),
      400: common[400],
      403: common[403],
      409: common[409],
      429: rateLimitedContent("Too many codes sent (rate_limited), and how long to wait"),
      502: errorContent("The e-mail did not leave (mail_failed): nothing added nor counted"),
    },
  }),
  "user",
);

const verifyRoute = defineAccess(
  createRoute({
    method: "post",
    path: `${PATH}/{id}/verify`,
    summary: "Type back the code: the address is verified",
    description:
      `422 \`code_wrong\` (a try spent), \`code_locked\` after ${SENDER_CODE_MAX_ATTEMPTS} tries, \`code_expired\` ` +
      `after ${SENDER_CODE_MINUTES} minutes: « Renvoyer le code » sends a new one. 409 \`sender_verified\` when done.`,
    request: { params: idParams, ...body(senderCodeInputSchema) },
    responses: {
      200: viewContent("Verified"),
      400: common[400],
      403: common[403],
      404: notFoundContent,
      409: common[409],
      422: errorContent("Wrong, locked or expired code (code_wrong, code_locked, code_expired)"),
    },
  }),
  "user",
);

const resendRoute = defineAccess(
  createRoute({
    method: "post",
    path: `${PATH}/{id}/resend`,
    summary: "« Renvoyer le code »: a new code, the former one stops",
    description:
      `Once every ${SENDER_RESEND_SECONDS} seconds per address and ${SENDER_SENDS_PER_HOUR} codes an hour per ` +
      `account, ${SENDER_TARGET_SENDS_PER_DAY} a day to one address (429 \`rate_limited\` with \`retryAfterSeconds\`). ` +
      "New tries, new 15 minutes. 409 `sender_verified` once verified. A code that did not leave (502 `mail_failed`) " +
      "changes nothing: the former code still works, nothing is counted.",
    request: { params: idParams },
    responses: {
      200: viewContent("A new code sent"),
      400: common[400],
      403: common[403],
      404: notFoundContent,
      409: common[409],
      429: rateLimitedContent("Too soon, or too many codes (rate_limited), and how long to wait"),
      502: errorContent("The e-mail did not leave (mail_failed): nothing changed"),
    },
  }),
  "user",
);

const deleteRoute = defineAccess(
  createRoute({
    method: "delete",
    path: `${PATH}/{id}`,
    summary: "« Retirer » an added address: its e-mails are no longer read",
    request: { params: idParams },
    responses: {
      204: { description: "Removed" },
      400: common[400],
      403: common[403],
      404: notFoundContent,
      409: common[409],
    },
  }),
  "user",
);

function userIdOf(c: Context<AccessEnv>): string {
  const id = c.var.session?.user.id;
  if (!id) throw new Error("me route reached without a session");
  return id;
}

function drawCode(): string {
  return String(randomInt(10 ** SENDER_CODE_LENGTH)).padStart(SENDER_CODE_LENGTH, "0");
}

const hashCode = (code: string, salt: string) =>
  createHmac("sha256", Buffer.from(salt, "hex")).update(code).digest("hex");

/** Constant-time comparison of the typed code with the stored hash. */
function codeMatches(code: string, salt: string, hash: string): boolean {
  const typed = Buffer.from(hashCode(code, salt), "hex");
  const stored = Buffer.from(hash, "hex");
  return typed.length === stored.length && timingSafeEqual(typed, stored);
}

/** A new code for a row: what to store (hash, salt, expiry, tries back to 0), and the code to send. */
function freshCode(now: Date) {
  const code = drawCode();
  const salt = randomBytes(16).toString("hex");
  return {
    code,
    columns: {
      codeHash: hashCode(code, salt),
      codeSalt: salt,
      codeExpiresAt: new Date(now.getTime() + SENDER_CODE_MINUTES * 60_000),
      attempts: 0,
      lastSentAt: now,
    },
  };
}

type Row = typeof schema.orderSenderAddresses.$inferSelect;
const viewOf = (row: Pick<Row, "id" | "email" | "verifiedAt" | "createdAt">): SenderAddressView => ({
  id: row.id,
  email: row.email,
  verified: row.verifiedAt !== null,
  createdAt: row.createdAt.toISOString(),
});

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A code may not leave yet (a limit reached): the whole transaction is undone, nothing counted. */
class Refused extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("refused");
  }
}
/** The e-mail did not leave: the whole transaction is undone (no row, no count, no `last_sent_at`). */
class MailFailed extends Error {}

const secondsUntil = (end: number, now: Date) => Math.max(1, Math.ceil((end - now.getTime()) / 1000));

/**
 * Counts one code in a fixed window (from its first code), only while under `max`: one atomic upsert, so two requests
 * at once cannot both slip under the limit, and a refused one changes nothing. Over the limit: `Refused`, with the
 * time until the window ends.
 */
async function consumeWindow(
  tx: Tx,
  table: typeof schema.orderSenderSends | typeof schema.orderSenderCodeTargets,
  keyColumn: "user_id" | "key",
  key: string,
  options: { now: Date; windowMs: number; max: number },
): Promise<void> {
  const { now, windowMs, max } = options;
  const from = new Date(now.getTime() - windowMs);
  const column = sql.identifier(keyColumn);
  const counted = await tx.execute<{ sends: number }>(sql`
    insert into ${table} as w (${column}, window_start, sends) values (${key}, ${now}, 1)
    on conflict (${column}) do update set
      sends = case when w.window_start <= ${from} then 1 else w.sends + 1 end,
      window_start = case when w.window_start <= ${from} then ${now}::timestamptz else w.window_start end
    where w.window_start <= ${from} or w.sends < ${max}
    returning sends`);
  if (counted.rows.length > 0) return;
  const held = await tx.execute<{ window_start: Date | string }>(
    sql`select window_start from ${table} where ${column} = ${key}`,
  );
  const start = held.rows[0]?.window_start;
  throw new Refused(secondsUntil(new Date(start ?? now).getTime() + windowMs, now));
}

/** The key of an address in `order_sender_code_targets`: never the address itself. */
const targetKey = (email: string) => createHash("sha256").update(`order-sender-code:${email}`).digest("hex");

/** Both limits of a code about to leave: 5 an hour for her account, 3 a day to that address (any account). */
async function consumeSend(tx: Tx, userId: string, email: string, now: Date): Promise<void> {
  await consumeWindow(tx, schema.orderSenderSends, "user_id", userId, {
    now,
    windowMs: HOUR_MS,
    max: SENDER_SENDS_PER_HOUR,
  });
  // Windows ended a day ago or more are of no use: removed as codes are sent.
  await tx.execute(
    sql`delete from ${schema.orderSenderCodeTargets} where window_start < ${new Date(now.getTime() - 2 * DAY_MS)}`,
  );
  await consumeWindow(tx, schema.orderSenderCodeTargets, "key", targetKey(email), {
    now,
    windowMs: DAY_MS,
    max: SENDER_TARGET_SENDS_PER_DAY,
  });
}

/** Only the error's name: the address and the code never reach the journal. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : "error");

export function orderSenderRoutes(deps: OrderSenderDeps) {
  const { db, receiving } = deps;
  const now = deps.now ?? (() => new Date());
  const app = new OpenAPIHono<AccessEnv>({
    defaultHook: (result, c) => (result.success ? undefined : c.json(invalidRequest, 400)),
  });

  /** Her account (403 for a guest or an unverified account e-mail), reception on (409 otherwise). */
  async function gate(c: Context<AccessEnv>) {
    const userId = userIdOf(c);
    const [row] = await db
      .select({ email: schema.user.email, isAnonymous: schema.user.isAnonymous, verified: schema.user.emailVerified })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    // Read from the table, not the session: the session may be older than her account.
    if (!row || row.isAnonymous === true) return { error: "guest" } as const;
    // Codes leave only for an account whose own address is proven (the reception asks the same of it).
    if (!row.verified) return { error: "unverified" } as const;
    if (!receiving) return { error: "off" } as const;
    return { userId, accountEmail: row.email } as const;
  }

  /**
   * Sends the code, inside the transaction that counted it: an e-mail that did not leave throws `MailFailed`, which
   * undoes the row, the counts and `last_sent_at`.
   */
  async function send(to: string, code: string): Promise<void> {
    if (!deps.mailer) throw new MailFailed();
    try {
      await deps.mailer.send(senderCodeEmail(to, code));
    } catch (error) {
      console.error(`sender address: code e-mail not sent (${errorName(error)})`);
      throw new MailFailed();
    }
  }

  /** The answer to a refused or failed send, or null for any other error (rethrown). */
  const sendFailure = <C extends Context<AccessEnv>>(c: C, error: unknown) => {
    if (error instanceof Refused) {
      return c.json({ error: "rate_limited" as const, retryAfterSeconds: error.retryAfterSeconds }, 429);
    }
    if (error instanceof MailFailed) return c.json(mailFailed, 502);
    return null;
  };

  const refusal = <C extends Context<AccessEnv>>(c: C, error: "guest" | "unverified" | "off") =>
    error === "guest"
      ? c.json(accountRequired, 403)
      : error === "unverified"
        ? c.json(emailUnverified, 403)
        : c.json(inboundOff, 409);

  const own = (userId: string, id: string) =>
    and(eq(schema.orderSenderAddresses.id, id), eq(schema.orderSenderAddresses.userId, userId));

  return app
    .openapi(listRoute, async (c) => {
      const gated = await gate(c);
      if ("error" in gated) return refusal(c, gated.error);
      const rows = await db
        .select()
        .from(schema.orderSenderAddresses)
        .where(eq(schema.orderSenderAddresses.userId, gated.userId))
        .orderBy(asc(schema.orderSenderAddresses.createdAt), asc(schema.orderSenderAddresses.email));
      return c.json({ accountEmail: gated.accountEmail, max: MAX_SENDER_ADDRESSES, addresses: rows.map(viewOf) }, 200);
    })
    .openapi(addRoute, async (c) => {
      const gated = await gate(c);
      if ("error" in gated) return refusal(c, gated.error);
      const { email } = c.req.valid("json");
      const { userId } = gated;
      if (email === gated.accountEmail.trim().toLowerCase()) return c.json({ error: "sender_exists" } as const, 409);
      const at = now();
      const fresh = freshCode(at);
      let outcome: { row: Row } | { error: "sender_exists" | "sender_limit" };
      try {
        outcome = await db.transaction(async (tx) => {
          // Her account row, so that two additions at once count one after the other (the limit of 10).
          await tx
            .select({ id: schema.user.id })
            .from(schema.user)
            .where(eq(schema.user.id, userId))
            .for("no key update");
          const [taken] = await tx
            .select({ id: schema.orderSenderAddresses.id })
            .from(schema.orderSenderAddresses)
            .where(and(eq(schema.orderSenderAddresses.userId, userId), eq(schema.orderSenderAddresses.email, email)));
          if (taken) return { error: "sender_exists" } as const;
          const [held] = await tx
            .select({ n: count() })
            .from(schema.orderSenderAddresses)
            .where(eq(schema.orderSenderAddresses.userId, userId));
          if ((held?.n ?? 0) >= MAX_EMAIL_ROWS) return { error: "sender_limit" } as const;
          await consumeSend(tx, userId, email, at);
          const [row] = await tx
            .insert(schema.orderSenderAddresses)
            .values({ userId, email, ...fresh.columns })
            .returning();
          if (!row) throw new Error("sender address not inserted");
          await send(email, fresh.code);
          return { row };
        });
      } catch (error) {
        if (pgCode(error) === "23505") return c.json({ error: "sender_exists" } as const, 409);
        const failure = sendFailure(c, error);
        if (failure) return failure;
        throw error;
      }
      if ("error" in outcome) return c.json({ error: outcome.error }, 409);
      return c.json(viewOf(outcome.row), 201);
    })
    .openapi(verifyRoute, async (c) => {
      const gated = await gate(c);
      if ("error" in gated) return refusal(c, gated.error);
      const { id } = c.req.valid("param");
      const { code } = c.req.valid("json");
      const at = now();
      const outcome = await db.transaction(async (tx) => {
        const [row] = await tx.select().from(schema.orderSenderAddresses).where(own(gated.userId, id)).for("update");
        if (!row) return { error: "not_found" } as const;
        if (row.verifiedAt) return { error: "sender_verified" } as const;
        if (!row.codeHash || !row.codeSalt || !row.codeExpiresAt || row.codeExpiresAt <= at) {
          return { error: "code_expired" } as const;
        }
        if (row.attempts >= SENDER_CODE_MAX_ATTEMPTS) return { error: "code_locked" } as const;
        if (codeMatches(code, row.codeSalt, row.codeHash)) {
          const [done] = await tx
            .update(schema.orderSenderAddresses)
            .set({ verifiedAt: at, codeHash: null, codeSalt: null, codeExpiresAt: null, attempts: 0 })
            .where(eq(schema.orderSenderAddresses.id, row.id))
            .returning();
          return { row: done ?? row };
        }
        const attempts = row.attempts + 1;
        await tx
          .update(schema.orderSenderAddresses)
          .set({ attempts })
          .where(eq(schema.orderSenderAddresses.id, row.id));
        return { error: attempts >= SENDER_CODE_MAX_ATTEMPTS ? "code_locked" : "code_wrong" } as const;
      });
      if ("row" in outcome) return c.json(viewOf(outcome.row), 200);
      if (outcome.error === "not_found") return c.json(notFound, 404);
      if (outcome.error === "sender_verified") return c.json({ error: outcome.error }, 409);
      return c.json({ error: outcome.error }, 422);
    })
    .openapi(resendRoute, async (c) => {
      const gated = await gate(c);
      if ("error" in gated) return refusal(c, gated.error);
      const { id } = c.req.valid("param");
      const at = now();
      const fresh = freshCode(at);
      let outcome: { row: Row } | { error: "not_found" | "sender_verified" };
      try {
        outcome = await db.transaction(async (tx) => {
          const [row] = await tx.select().from(schema.orderSenderAddresses).where(own(gated.userId, id)).for("update");
          if (!row) return { error: "not_found" } as const;
          if (row.verifiedAt) return { error: "sender_verified" } as const;
          const next = (row.lastSentAt?.getTime() ?? 0) + SENDER_RESEND_SECONDS * 1000;
          if (next > at.getTime()) throw new Refused(secondsUntil(next, at));
          await consumeSend(tx, gated.userId, row.email, at);
          const [updated] = await tx
            .update(schema.orderSenderAddresses)
            .set(fresh.columns)
            .where(eq(schema.orderSenderAddresses.id, row.id))
            .returning();
          await send(row.email, fresh.code);
          return { row: updated ?? row };
        });
      } catch (error) {
        const failure = sendFailure(c, error);
        if (failure) return failure;
        throw error;
      }
      if ("error" in outcome) {
        return outcome.error === "not_found" ? c.json(notFound, 404) : c.json({ error: outcome.error }, 409);
      }
      return c.json(viewOf(outcome.row), 200);
    })
    .openapi(deleteRoute, async (c) => {
      const gated = await gate(c);
      if ("error" in gated) return refusal(c, gated.error);
      const { id } = c.req.valid("param");
      const removed = await db
        .delete(schema.orderSenderAddresses)
        .where(own(gated.userId, id))
        .returning({ id: schema.orderSenderAddresses.id });
      return removed.length > 0 ? c.body(null, 204) : c.json(notFound, 404);
    });
}
