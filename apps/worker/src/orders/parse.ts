import { and, asc, type Database, eq, findOrCreateShop, inArray, schema, sql } from "@closyria/db";
import { decodeEmail, parseOrderEmail, shopHostOf } from "@closyria/extract";
import {
  canonicalizeUrl,
  nextParcelCheck,
  nextSendAt,
  ORDER_EMAIL_PARSE_QUEUE,
  type OrderParseMethod,
  orderEmailParseJobSchema,
  type ParsedOrder,
  type ParsedOrderLine,
  parcelCheckUntil,
} from "@closyria/shared";
import { ObjectNotFoundError, type ObjectStore } from "@closyria/storage";
import { isLastAttempt, type MetadataJob } from "../alerts/send";

/**
 * Reads the AI's way an e-mail no known format could (`aiParseOrderEmail` of `packages/ai`, with her text): null when
 * it read nothing, or when the month's cap is reached. Null itself when the AI is off (no `ANTHROPIC_API_KEY`).
 */
export type AiReader = ((text: string) => Promise<ParsedOrder | null>) | null;
export type ParseDeps = { db: Database; store: ObjectStore; ai: AiReader };
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Statuses an e-mail may complete; a dismissed order (« Ce n'est pas une commande ») is left alone. */
const OPEN_ORDER = ["draft", "confirmed"] as const;

const markFailed = async (db: Database, id: string) => {
  await db
    .update(schema.inboundEmails)
    .set({ status: "failed" })
    .where(and(eq(schema.inboundEmails.id, id), eq(schema.inboundEmails.status, "queued")));
  return "failed" as const;
};

const sameArticle = (a: { name: string; sizeLabel: string | null }, b: ParsedOrderLine) =>
  a.name.toLocaleLowerCase("fr") === b.name.toLocaleLowerCase("fr") &&
  (a.sizeLabel === null ||
    b.sizeLabel === null ||
    a.sizeLabel.toLocaleLowerCase("fr") === b.sizeLabel.toLocaleLowerCase("fr"));

/** An order line to store: what was read, its product when its link names a known one. */
type LineRow = Omit<ParsedOrderLine, "productUrl"> & { productId: string | null };

/**
 * The lines with the product their link names (RF 3): a product already known by that canonical address, of the
 * order's shop when it is known. A product is never created and its page never fetched.
 *
 * Without a shop (no plausible domain), the address alone decides: `products.canonical_url` is unique, so it names one
 * page of one shop at most, the very page the e-mail's line links to (Task 8 review: kept, not unsafe). Only the
 * known formats keep a line's link (the AI keeps none), and only on that line's own title or photo.
 */
async function withProducts(db: Database, shopId: string | null, lines: ParsedOrderLine[]): Promise<LineRow[]> {
  const urls = lines.map((line) => (line.productUrl ? canonicalizeUrl(line.productUrl) : null));
  const wanted = [...new Set(urls.filter((u): u is string => u !== null))];
  const found =
    wanted.length === 0
      ? []
      : await db
          .select({ id: schema.products.id, url: schema.products.canonicalUrl })
          .from(schema.products)
          .where(
            and(inArray(schema.products.canonicalUrl, wanted), ...(shopId ? [eq(schema.products.shopId, shopId)] : [])),
          );
  const byUrl = new Map(found.map((p) => [p.url, p.id]));
  return lines.map(({ productUrl: _url, ...line }, i) => {
    const url = urls[i];
    return { ...line, productId: (url ? byUrl.get(url) : undefined) ?? null };
  });
}

/**
 * The order this e-mail completes (RF 2): hers, not dismissed, from the same shop with the same order number, or
 * holding one of its tracking numbers (the same shipping e-mail forwarded twice). The caller holds the advisory locks;
 * the order row is locked here (`for update`), so a « C'est bon » under way (Task 4) finishes first and its status is
 * the one read: a validated order then gets no article.
 */
async function existingOrder(tx: Tx, userId: string, shopId: string | null, parsed: ParsedOrder) {
  const o = schema.orders;
  if (shopId && parsed.externalRef) {
    const [byRef] = await tx
      .select()
      .from(o)
      .where(
        and(
          eq(o.userId, userId),
          eq(o.shopId, shopId),
          eq(o.externalRef, parsed.externalRef),
          inArray(o.status, OPEN_ORDER),
        ),
      )
      .orderBy(asc(o.createdAt))
      .limit(1)
      .for("update");
    if (byRef) return byRef;
  }
  const numbers = parsed.trackings.map((t) => t.trackingNumber);
  if (numbers.length === 0) return null;
  const [byParcel] = await tx
    .select({ order: o })
    .from(schema.parcels)
    .innerJoin(o, eq(o.id, schema.parcels.orderId))
    .where(and(eq(o.userId, userId), inArray(schema.parcels.trackingNumber, numbers), inArray(o.status, OPEN_ORDER)))
    .orderBy(asc(o.createdAt))
    .limit(1)
    .for("update", { of: o });
  return byParcel?.order ?? null;
}

async function addParcels(tx: Tx, orderId: string, parsed: ParsedOrder, now: Date) {
  if (parsed.trackings.length === 0) return;
  await tx
    .insert(schema.parcels)
    .values(
      parsed.trackings.map((t) => ({
        orderId,
        carrier: t.carrier,
        trackingNumber: t.trackingNumber,
        status: "pending",
        // Task 5's planner picks parcels up by `next_check_at`.
        nextCheckAt: nextParcelCheck("pending", now),
        checkUntil: parcelCheckUntil(now),
      })),
    )
    .onConflictDoNothing({ target: [schema.parcels.orderId, schema.parcels.trackingNumber] });
}

/**
 * A draft gets the articles it lacks, and what its known articles lacked (size, colour, price, product); a confirmed
 * one none.
 */
async function completeLines(tx: Tx, orderId: string, lines: LineRow[]) {
  const l = schema.orderLines;
  const existing = await tx.select().from(l).where(eq(l.orderId, orderId)).orderBy(asc(l.position));
  let position = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  for (const line of lines) {
    const known = existing.find((row) => sameArticle(row, line));
    if (!known) {
      const [row] = await tx
        .insert(l)
        .values({ orderId, ...line, position: position++ })
        .returning();
      if (row) existing.push(row);
      continue;
    }
    const priced = known.priceCents === null && line.priceCents !== null;
    const patch = {
      ...(known.sizeLabel === null && line.sizeLabel !== null ? { sizeLabel: line.sizeLabel } : {}),
      ...(known.color === null && line.color !== null ? { color: line.color } : {}),
      ...(priced ? { priceCents: line.priceCents, currency: line.currency } : {}),
      ...(known.productId === null && line.productId !== null ? { productId: line.productId } : {}),
    };
    if (Object.keys(patch).length > 0) await tx.update(l).set(patch).where(eq(l.id, known.id));
  }
}

/**
 * Reads one accepted e-mail (`queued`) into a draft order (spec C2, Task 3): known formats first
 * (`parseOrderEmail`), the AI when they fail and it is on. The shop is the one owning the e-mail's site (created as
 * `pending`, like a capture, when unknown). An e-mail of an order she already has (same shop and order number, or
 * one of its tracking numbers) completes it instead (RF 2): parcels added, a draft's missing articles and date
 * filled. A new order is announced (« Commande reçue de {boutique} », alert `order_received`, same rules as the
 * other alerts). The e-mail ends `parsed`, or `failed` when nothing was read (« On n'a pas su lire cet e-mail »).
 *
 * Idempotent: a second run of the same job finds the e-mail no longer `queued` and does nothing (`none`). Two e-mails
 * of one order read at once are serialised by transaction-scoped advisory locks on (her, shop, order number) and
 * (her, tracking number). Links are never followed, attachments never read.
 */
export async function parseInboundEmail(
  deps: ParseDeps,
  inboundEmailId: string,
  now: Date,
): Promise<"parsed" | "failed" | "none"> {
  const { db, store } = deps;
  const e = schema.inboundEmails;
  const [row] = await db
    .select({ userId: e.userId, status: e.status, key: e.rawObjectKey, from: e.fromAddress })
    .from(e)
    .where(eq(e.id, inboundEmailId));
  if (row?.status !== "queued") return "none";
  if (!row.userId || !row.key) return markFailed(db, inboundEmailId);
  const userId = row.userId;

  let raw: Buffer;
  try {
    raw = await store.get(row.key);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return markFailed(db, inboundEmailId);
    throw error;
  }
  const [profile] = await db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .orderBy(asc(schema.profiles.position), asc(schema.profiles.createdAt), asc(schema.profiles.id))
    .limit(1);
  if (!profile) return markFailed(db, inboundEmailId);
  const email = await decodeEmail(raw);
  let parsed = parseOrderEmail(email, { now, ownAddress: row.from });
  let method: OrderParseMethod = "known";
  if (!parsed && deps.ai) {
    // The subject often holds the order number (« Commande #1042 confirmée »).
    const read = await deps.ai(email.subject ? `Objet : ${email.subject}\n${email.text}` : email.text);
    if (read) {
      parsed = { ...read, shopHost: read.shopHost ?? shopHostOf(email, row.from) };
      method = "ai";
    }
  }
  if (!parsed) return markFailed(db, inboundEmailId);

  const shop = parsed.shopHost ? await findOrCreateShop(db, `https://${parsed.shopHost}/`) : null;
  const order = parsed;
  const lines = await withProducts(db, shop?.id ?? null, parsed.lines);
  return db.transaction(async (tx) => {
    const keys = [
      ...(shop && order.externalRef ? [`order:${userId}:${shop.id}:${order.externalRef}`] : []),
      ...order.trackings.map((t) => `parcel:${userId}:${t.trackingNumber}`),
    ].sort();
    for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const [locked] = await tx.select({ status: e.status }).from(e).where(eq(e.id, inboundEmailId)).for("update");
    if (locked?.status !== "queued") return "none";

    const existing = await existingOrder(tx, userId, shop?.id ?? null, order);
    if (existing) {
      if (existing.status === "draft") {
        await completeLines(tx, existing.id, lines);
        if (!existing.orderedAt && order.orderedAt) {
          await tx
            .update(schema.orders)
            .set({ orderedAt: new Date(order.orderedAt) })
            .where(eq(schema.orders.id, existing.id));
        }
      }
      await addParcels(tx, existing.id, order, now);
      await tx.update(schema.orders).set({ updatedAt: now }).where(eq(schema.orders.id, existing.id));
    } else {
      const [created] = await tx
        .insert(schema.orders)
        .values({
          userId,
          profileId: profile.id,
          shopId: shop?.id ?? null,
          externalRef: order.externalRef,
          orderedAt: order.orderedAt ? new Date(order.orderedAt) : null,
          status: "draft",
          source: "email",
          parseMethod: method,
          inboundEmailId,
        })
        .returning({ id: schema.orders.id });
      const orderId = created?.id as string;
      if (lines.length > 0) {
        await tx.insert(schema.orderLines).values(lines.map((line, position) => ({ orderId, ...line, position })));
      }
      await addParcels(tx, orderId, order, now);
      await tx.insert(schema.alertEvents).values({
        userId,
        profileId: profile.id,
        kind: "order_received",
        orderId,
        shopId: shop?.id ?? null,
        sendAfter: nextSendAt(now),
      });
    }
    await tx.update(e).set({ status: "parsed" }).where(eq(e.id, inboundEmailId));
    return "parsed";
  });
}

/** Retries of a job (the AI or the store busy): 3 more, a minute apart then longer. */
export const ORDER_EMAIL_PARSE_QUEUE_OPTIONS = { retryLimit: 3, retryDelay: 60, retryBackoff: true } as const;

/**
 * order-email-parse: `{ inboundEmailId }`; anything else fails the job. A passing error (the AI unavailable, the
 * store or the database down) is thrown for pg-boss to try again; on the last attempt the e-mail is marked `failed`
 * instead (she types it in), never left `queued`.
 */
export function orderEmailParseHandler(deps: ParseDeps, clock: () => Date = () => new Date()) {
  return async (jobs: MetadataJob[]): Promise<void> => {
    for (const job of jobs) {
      const parsed = orderEmailParseJobSchema.safeParse(job.data);
      if (!parsed.success) {
        console.error(`${ORDER_EMAIL_PARSE_QUEUE}: invalid job data (job ${job.id}), failing it`);
        throw new Error(`invalid job data on ${ORDER_EMAIL_PARSE_QUEUE}`);
      }
      const { inboundEmailId } = parsed.data;
      try {
        await parseInboundEmail(deps, inboundEmailId, clock());
      } catch (error) {
        const name = error instanceof Error ? error.name : "error";
        if (!isLastAttempt(job)) throw error;
        console.error(`${ORDER_EMAIL_PARSE_QUEUE}: e-mail not read after the last attempt (${name}), marked failed`);
        await markFailed(deps.db, inboundEmailId);
      }
    }
  };
}
