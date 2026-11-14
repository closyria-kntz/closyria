import { and, type Database, lt, notInArray, schema } from "@closyria/db";
import { ALERT_EVENT_RETENTION_DAYS, ALERT_SEND_RETENTION_DAYS, DIGEST_WAITING_STATUSES } from "@closyria/shared";

const DAY_MS = 86_400_000;

/**
 * The nightly purge of the alerts: those older than 35 days that no longer wait for a send or a digest (« Nouvelles »
 * shows 30 days; every « once per … » rule looks back 7 days at most), and the dashboard's sends older than 30 days
 * (it counts 7).
 */
export async function purgeAlerts(db: Database, now: Date): Promise<{ events: number; sends: number }> {
  const events = await db
    .delete(schema.alertEvents)
    .where(
      and(
        lt(schema.alertEvents.createdAt, new Date(now.getTime() - ALERT_EVENT_RETENTION_DAYS * DAY_MS)),
        notInArray(schema.alertEvents.status, [...DIGEST_WAITING_STATUSES]),
      ),
    )
    .returning({ id: schema.alertEvents.id });
  const sends = await db
    .delete(schema.alertSends)
    .where(lt(schema.alertSends.sentAt, new Date(now.getTime() - ALERT_SEND_RETENTION_DAYS * DAY_MS)))
    .returning({ id: schema.alertSends.id });
  return { events: events.length, sends: sends.length };
}
