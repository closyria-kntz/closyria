import type { PgBoss } from "pg-boss";
import {
  ALERT_DIGEST_PLAN_QUEUE,
  ALERT_DIGEST_QUEUE,
  ALERT_DIGEST_QUEUE_OPTIONS,
  digestHandler,
  planDigests,
} from "./digest";
import {
  ALERT_SEND_PLAN_QUEUE,
  ALERT_SEND_QUEUE,
  ALERT_SEND_QUEUE_OPTIONS,
  alertSendHandler,
  planAlertSends,
  type SendDeps,
} from "./send";

/**
 * The alert queues: immediate sends (swept every minute, one at a time so the daily cap holds) and the digests
 * (planned every 15 minutes, one person at a time).
 */
export async function registerAlertSendQueues(boss: PgBoss, deps: SendDeps): Promise<void> {
  await boss.createQueue(ALERT_SEND_QUEUE, { ...ALERT_SEND_QUEUE_OPTIONS });
  await boss.createQueue(ALERT_SEND_PLAN_QUEUE);
  await boss.createQueue(ALERT_DIGEST_QUEUE, { ...ALERT_DIGEST_QUEUE_OPTIONS });
  await boss.createQueue(ALERT_DIGEST_PLAN_QUEUE);

  await boss.work(ALERT_SEND_QUEUE, { localConcurrency: 1, includeMetadata: true }, alertSendHandler(deps));
  await boss.work(ALERT_DIGEST_QUEUE, { localConcurrency: 1, includeMetadata: true }, digestHandler(deps));
  await boss.work(ALERT_SEND_PLAN_QUEUE, async () => {
    await planAlertSends(deps.db, boss, new Date());
  });
  await boss.work(ALERT_DIGEST_PLAN_QUEUE, async () => {
    const planned = await planDigests(deps.db, boss, new Date());
    if (planned > 0) console.log(`alerts: ${planned} digest(s) queued`);
  });

  await boss.schedule(ALERT_SEND_PLAN_QUEUE, "* * * * *", undefined, { key: "plan-alert-sends" });
  await boss.schedule(ALERT_DIGEST_PLAN_QUEUE, "*/15 * * * *", undefined, { key: "plan-digests" });
}
