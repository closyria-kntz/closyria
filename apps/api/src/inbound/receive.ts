import { and, count, type Database, eq, gt, isNotNull, ne, schema } from "@closyria/db";
import {
  INBOUND_EMAIL_RETENTION_DAYS,
  MAX_IGNORED_INBOUND_EMAILS_PER_DAY,
  MAX_INBOUND_EMAILS_PER_DAY,
  rawEmailKey,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import { pgCode } from "../pg-code";
import type { SenderCheck, SenderVerdict } from "./sender";
import type { Envelope } from "./signature";

/** Hands an accepted e-mail to the worker (`order-email-parse`, `{ inboundEmailId }`). */
export type OrderEmailQueue = { parse(inboundEmailId: string): Promise<void> };

export type InboundDeps = {
  db: Database;
  store: ObjectStore;
  /** The order addresses' domain (`orderInboxDomain`). */
  domain: string;
  checkSender: SenderCheck;
  queue: OrderEmailQueue;
  now?: () => Date;
};

/**
 * - `queued`: accepted, raw message stored, reading queued;
 * - `ignored`: on one of her active addresses but not from her (or not authenticated): a row without the message;
 * - `confirmation`: Gmail's forwarding confirmation for her own Gmail address, its code kept on the address;
 * - `duplicate`: this delivery (Postfix queue id, recipient) was already filed: a retry or a replay, nothing more;
 * - `dropped`: nothing stored (unknown or former address, another domain, today's quota, account gone meanwhile);
 * - `failed`: accepted but not stored or not queued (the row says `failed`, no object left behind);
 * - `retry`: the DNS did not answer (temperror): nothing stored, Postfix tries again later.
 */
export type ReceiveOutcome = "queued" | "ignored" | "confirmation" | "duplicate" | "dropped" | "failed" | "retry";

const DAY_MS = 86_400_000;

/** Only the error's name and Postgres code: a query's parameters (an address) never reach the journal. */
function errorLabel(error: unknown): string {
  const e = error as { name?: string; code?: string; cause?: { code?: string } };
  return [e?.name ?? "error", e?.cause?.code ?? e?.code].filter(Boolean).join(" ");
}

/** Her sender addresses that passed their code (« Mes adresses d'envoi »). */
async function verifiedSendersOf(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ email: schema.orderSenderAddresses.email })
    .from(schema.orderSenderAddresses)
    .where(and(eq(schema.orderSenderAddresses.userId, userId), isNotNull(schema.orderSenderAddresses.verifiedAt)));
  return rows.map((r) => r.email);
}

/**
 * Files one e-mail received for `envelope.rcptTo` (Postfix delivers one recipient at a time). Order of the writes
 * (no object without its row, no object left behind): the row first, then the object, then its key on the row; a
 * failed write marks the row `failed` and removes what may have been written; a row deleted meanwhile (account
 * deletion locks her addresses, then reads the keys) has its object removed here. Should marking it failed fail
 * too, the purge fails rows left `queued` without a message after an hour.
 */
export async function receiveInboundEmail(
  deps: InboundDeps,
  input: { raw: Buffer; envelope: Envelope },
): Promise<ReceiveOutcome> {
  const { db, store } = deps;
  const now = deps.now?.() ?? new Date();
  const recipient = input.envelope.rcptTo.trim().toLowerCase();
  const at = recipient.lastIndexOf("@");
  if (at < 1 || recipient.slice(at + 1) !== deps.domain) return "dropped";
  const localPart = recipient.slice(0, at);

  const [inbox] = await db
    .select({
      id: schema.orderInboxes.id,
      userId: schema.orderInboxes.userId,
      email: schema.user.email,
      emailVerified: schema.user.emailVerified,
      isAnonymous: schema.user.isAnonymous,
    })
    .from(schema.orderInboxes)
    .innerJoin(schema.user, eq(schema.user.id, schema.orderInboxes.userId))
    .where(and(eq(schema.orderInboxes.localPart, localPart), eq(schema.orderInboxes.active, true)));
  // A former address (« Changer d'adresse ») stops working: nothing is kept, as for an address that never existed.
  if (!inbox) return "dropped";

  const [seen] = await db
    .select({ id: schema.inboundEmails.id })
    .from(schema.inboundEmails)
    .where(and(eq(schema.inboundEmails.inboxId, inbox.id), eq(schema.inboundEmails.queueId, input.envelope.queueId)));
  if (seen) return "duplicate";

  // Her verified addresses only: a guest has none (and cannot have an address), an unverified one proves nothing.
  // Besides the account's, those she verified in « Mes adresses d'envoi » (spec §11), never one waiting for its code.
  const verdict: SenderVerdict =
    inbox.emailVerified && inbox.isAnonymous !== true
      ? await deps.checkSender({
          raw: input.raw,
          envelope: input.envelope,
          accountEmail: inbox.email,
          verifiedSenders: await verifiedSendersOf(db, inbox.userId),
        })
      : { kind: "ignored", fromAddress: input.envelope.mailFrom.toLowerCase().slice(0, 320) || "(inconnu)" };
  if (verdict.kind === "retry") return "retry";
  if (verdict.kind === "gmail_confirmation") {
    const updated = await db
      .update(schema.orderInboxes)
      .set({ gmailCode: verdict.code, gmailCodeAt: now })
      .where(and(eq(schema.orderInboxes.id, inbox.id), eq(schema.orderInboxes.active, true)))
      .returning({ id: schema.orderInboxes.id });
    return updated.length > 0 ? "confirmation" : "dropped";
  }
  const accepted = verdict.kind === "accepted";

  // Today's quota, counted apart: her own e-mails (100), the ignored ones (20, so a flood fills nothing).
  const [today] = await db
    .select({ n: count() })
    .from(schema.inboundEmails)
    .where(
      and(
        eq(schema.inboundEmails.inboxId, inbox.id),
        gt(schema.inboundEmails.receivedAt, new Date(now.getTime() - DAY_MS)),
        accepted ? ne(schema.inboundEmails.status, "ignored") : eq(schema.inboundEmails.status, "ignored"),
      ),
    );
  const quota = accepted ? MAX_INBOUND_EMAILS_PER_DAY : MAX_IGNORED_INBOUND_EMAILS_PER_DAY;
  if ((today?.n ?? 0) >= quota) return "dropped";

  const purgeAfter = new Date(now.getTime() + INBOUND_EMAIL_RETENTION_DAYS * DAY_MS);
  // The address is locked (shared) while the row goes in: a rotation or an account deletion waits, and a row is
  // never filed on an address that just stopped working. Her account row first (key share), in the order an account
  // deletion takes them (user, then her addresses): the two wait for each other, never deadlock.
  let id: string | null;
  try {
    id = await db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.id, inbox.userId))
        .for("key share");
      if (!owner) return null;
      const [still] = await tx
        .select({ id: schema.orderInboxes.id })
        .from(schema.orderInboxes)
        .where(and(eq(schema.orderInboxes.id, inbox.id), eq(schema.orderInboxes.active, true)))
        .for("share");
      if (!still) return null;
      const [row] = await tx
        .insert(schema.inboundEmails)
        .values({
          inboxId: inbox.id,
          userId: accepted ? inbox.userId : null,
          receivedAt: now,
          queueId: input.envelope.queueId,
          fromAddress: verdict.fromAddress,
          authOk: accepted,
          status: accepted ? "queued" : "ignored",
          purgeAfter,
        })
        .returning({ id: schema.inboundEmails.id });
      return row?.id ?? null;
    });
  } catch (error) {
    // The same delivery filed at the same moment (a retry racing the first try).
    if (pgCode(error) === "23505") return "duplicate";
    throw error;
  }
  if (!id) return "dropped";
  if (!accepted) return "ignored";

  const markFailed = () =>
    db
      .update(schema.inboundEmails)
      .set({ status: "failed" })
      .where(eq(schema.inboundEmails.id, id))
      .catch((error: unknown) => console.error(`inbound e-mail ${id}: not marked failed (${errorLabel(error)})`));
  const removeObject = (key: string) =>
    store
      .delete(key)
      .catch((error: unknown) => console.error(`inbound e-mail ${id}: object not deleted (${errorLabel(error)})`));

  const key = rawEmailKey(inbox.userId, id);
  try {
    await store.put(key, input.raw, "message/rfc822");
  } catch (error) {
    console.error(`inbound e-mail ${id}: raw message not stored (${errorLabel(error)})`);
    await markFailed();
    await removeObject(key); // a write that timed out may still have landed
    return "failed";
  }
  let kept: { id: string } | undefined;
  try {
    [kept] = await db
      .update(schema.inboundEmails)
      .set({ rawObjectKey: key })
      .where(eq(schema.inboundEmails.id, id))
      .returning({ id: schema.inboundEmails.id });
  } catch (error) {
    console.error(`inbound e-mail ${id}: key not saved (${errorLabel(error)})`);
    await markFailed();
    await removeObject(key);
    return "failed";
  }
  if (!kept) {
    // Deleted meanwhile (her account): its object must not outlive it.
    await removeObject(key);
    return "dropped";
  }
  try {
    await deps.queue.parse(id);
  } catch (error) {
    console.error(`inbound e-mail ${id}: reading not queued (${errorLabel(error)})`);
    await markFailed();
    return "failed";
  }
  return "queued";
}
