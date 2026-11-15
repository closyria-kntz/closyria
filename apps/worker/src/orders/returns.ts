import { and, asc, type Database, eq, gte, isNull, lte, orderAwaitingNews, schema, sql } from "@closyria/db";
import {
  ALERT_TIME_ZONE,
  addParisDays,
  nextSendAt,
  parisDay,
  parisDayStart,
  RECEIVED_QUESTION_AGAIN_DAYS,
  RECEIVED_QUESTION_DAYS,
  RETURN_REMINDER_DAYS,
  receivedQuestionDue,
} from "@closyria/shared";
import type { PgBoss } from "pg-boss";

/**
 * « Après la commande », Task 6: every morning at 9:00 Paris,
 * - « Plus que 3 jours pour retourner {article} »: her received items (« Reçu », `owned`, not in the trash) whose
 *   return deadline is 3 Paris days ahead, once per item ever (`alert_events_return_reminder_idx`). A day the job
 *   missed is caught up (deadlines 1 to 3 days ahead never reminded), never a deadline already reached;
 * - « Tu as reçu ta commande {boutique} ? »: her validated orders without news (`orderAwaitingNews`: no parcel
 *   delivered, an article still « Commandé ») 10 Paris calendar days after the shipping — the first parcel's earliest
 *   step or creation —, else after the validation; once more at 20 days after her « Pas encore »; never a third time.
 * Both are immediate alerts held by the quiet hours, outside the daily cap (alerts/send.ts).
 */

export const ORDER_DAILY_QUEUE = "order-daily";
/** 9:00, Europe/Paris (the schedule's time zone). */
export const ORDER_DAILY_CRON = "0 9 * * *";
/** Orders looked at per run at most (the rest the next morning). */
const QUESTION_BUDGET = 2000;

/** Reminders written per statement (well under Postgres' 65 535 parameters), and per run at most. */
export const REMINDER_BATCH = 500;
const REMINDER_BUDGET = 20_000;

/** Creates the return reminders due at `now`, by batches; returns how many. */
export async function remindReturns(db: Database, now: Date, batch = REMINDER_BATCH): Promise<number> {
  const today = parisDay(now);
  const sendAfter = nextSendAt(now);
  const i = schema.items;
  let created = 0;
  for (let looked = 0; looked < REMINDER_BUDGET; ) {
    const due = await db
      .select({ id: i.id, userId: i.userId, profileId: i.profileId, productId: i.productId })
      .from(i)
      .where(
        and(
          eq(i.stage, "owned"),
          isNull(i.deletedAt),
          gte(i.returnDeadline, addParisDays(today, 1)),
          lte(i.returnDeadline, addParisDays(today, RETURN_REMINDER_DAYS)),
          // Qualified by hand: drizzle writes the outer column bare (`"id"`), which the sub-select would read as its own.
          sql`not exists (select 1 from "alert_events" as rem where rem.item_id = "items"."id" and rem.kind = 'return_reminder')`,
        ),
      )
      .orderBy(asc(i.returnDeadline), asc(i.id))
      .limit(batch);
    if (due.length === 0) break;
    const rows = await db
      .insert(schema.alertEvents)
      .values(
        due.map((item) => ({
          userId: item.userId,
          profileId: item.profileId,
          itemId: item.id,
          productId: item.productId,
          kind: "return_reminder",
          sendAfter,
          createdAt: now,
        })),
      )
      // Once per item ever: a concurrent run's reminder stands (and the item is not picked again).
      .onConflictDoNothing()
      .returning({ id: schema.alertEvents.id });
    created += rows.length;
    looked += due.length;
    if (due.length < batch) break;
  }
  return created;
}

/**
 * When the order shipped: its first parcel's earliest step, else that parcel's creation; null without a parcel (the
 * validation stands for it, else the order's creation).
 */
const referenceAt = sql<Date>`coalesce(
  (select min(coalesce((select min(ref_e.at) from "parcel_events" as ref_e where ref_e.parcel_id = ref_p.id), ref_p.created_at))
    from "parcels" as ref_p where ref_p.order_id = "orders"."id"),
  "orders"."confirmed_at", "orders"."created_at")`;

/** Asks « Tu as reçu ta commande ? » where due at `now`; returns how many questions were asked. */
export async function askReceived(db: Database, now: Date, budget = QUESTION_BUDGET): Promise<number> {
  const o = schema.orders;
  // Paris calendar days (`receivedQuestionDue`): shipped before 00:00 Paris RECEIVED_QUESTION_DAYS − 1 days ago.
  const firstDue = parisDayStart(addParisDays(parisDay(now), -(RECEIVED_QUESTION_DAYS - 1)));
  // The second question at 20 days: an order answered « Pas encore » and not due again yet never takes a place in
  // the day's budget from one that is due.
  const againDue = parisDayStart(addParisDays(parisDay(now), -(RECEIVED_QUESTION_AGAIN_DAYS - 1)));
  const candidates = await db
    .select({ id: o.id })
    .from(o)
    .where(
      and(
        eq(o.status, "confirmed"),
        sql`((${o.receivedAskedAt} is null and ${referenceAt} < ${firstDue.toISOString()})
          or (${o.receivedNotYetAt} is not null and ${o.receivedAskedAgainAt} is null
            and ${referenceAt} < ${againDue.toISOString()}))`,
        orderAwaitingNews(),
      ),
    )
    .orderBy(o.createdAt)
    .limit(budget);
  let asked = 0;
  for (const { id } of candidates) {
    try {
      if (await askOne(db, id, now)) asked += 1;
    } catch (error) {
      // One order's failure (a deadlock, the database busy) does not stop the others; it is asked tomorrow.
      console.error(`${ORDER_DAILY_QUEUE}: order not asked (${error instanceof Error ? error.name : "error"})`);
    }
  }
  return asked;
}

/** Under her profiles' lock then the order's (the lock order of every order action), asks again only if still due. */
async function askOne(db: Database, orderId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ userId: schema.orders.userId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    if (!owner) return false;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`profiles:${owner.userId}`}, 0))`);
    const [order] = await tx
      .select({
        id: schema.orders.id,
        userId: schema.orders.userId,
        profileId: schema.orders.profileId,
        shopId: schema.orders.shopId,
        askedAt: schema.orders.receivedAskedAt,
        notYetAt: schema.orders.receivedNotYetAt,
        askedAgainAt: schema.orders.receivedAskedAgainAt,
        referenceAt,
        awaiting: sql<boolean>`${orderAwaitingNews()}`,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), eq(schema.orders.status, "confirmed")))
      .for("update");
    if (!order?.awaiting) return false;
    const due = receivedQuestionDue({ ...order, referenceAt: new Date(order.referenceAt) }, now);
    if (!due) return false;
    await tx
      .update(schema.orders)
      .set(due === "first" ? { receivedAskedAt: now } : { receivedAskedAgainAt: now })
      .where(eq(schema.orders.id, order.id));
    await tx.insert(schema.alertEvents).values({
      userId: order.userId,
      profileId: order.profileId,
      orderId: order.id,
      shopId: order.shopId,
      kind: "order_received_check",
      sendAfter: nextSendAt(now),
      createdAt: now,
    });
    return true;
  });
}

type JobLike = { id?: string; data: unknown };
export type OrderDailyResult = { reminders: number; questions: number };

/** order-daily: the schedule sends no data; anything else fails the job. */
export function orderDailyHandler(run: () => Promise<OrderDailyResult>) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (!empty) {
        console.error(`${ORDER_DAILY_QUEUE}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${ORDER_DAILY_QUEUE}`);
      }
      const { reminders, questions } = await run();
      if (reminders + questions > 0) {
        console.log(`orders daily: ${reminders} return reminder(s), ${questions} « reçue ? » question(s)`);
      }
    }
  };
}

/** Creates order-daily, processes it and schedules it every morning at 9:00 Paris. */
export async function registerOrderDailyQueue(boss: PgBoss, db: Database): Promise<void> {
  await boss.createQueue(ORDER_DAILY_QUEUE, { policy: "singleton" });
  await boss.work(
    ORDER_DAILY_QUEUE,
    orderDailyHandler(async () => {
      const now = new Date();
      return { reminders: await remindReturns(db, now), questions: await askReceived(db, now) };
    }),
  );
  await boss.schedule(ORDER_DAILY_QUEUE, ORDER_DAILY_CRON, undefined, { tz: ALERT_TIME_ZONE, key: "daily-orders" });
}
