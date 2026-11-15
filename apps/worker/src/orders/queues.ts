import type { Database } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { type InboundPurgeResult, purgeInboundEmails } from "./purge-inbound";

export const ORDER_EMAIL_PURGE_QUEUE = "order-email-purge";

type JobLike = { id?: string; data: unknown };

/** order-email-purge: the schedule sends no data; anything else fails the job. */
export function orderEmailPurgeHandler(run: () => Promise<InboundPurgeResult>) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (!empty) {
        console.error(`${ORDER_EMAIL_PURGE_QUEUE}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${ORDER_EMAIL_PURGE_QUEUE}`);
      }
      const { deleted, cleared, failed } = await run();
      if (deleted + cleared + failed > 0) {
        console.log(
          `inbound e-mail purge: ${deleted} e-mail(s) deleted, ${cleared} raw message(s) erased, ${failed} left unfinished marked failed`,
        );
      }
    }
  };
}

/** Creates order-email-purge, processes it and schedules it every night at 03:45 (after the wardrobe purge). */
export async function registerOrderQueues(boss: PgBoss, deps: { db: Database; store: ObjectStore }): Promise<void> {
  await boss.createQueue(ORDER_EMAIL_PURGE_QUEUE);
  await boss.work(
    ORDER_EMAIL_PURGE_QUEUE,
    orderEmailPurgeHandler(() => purgeInboundEmails(deps.db, new Date(), deps.store)),
  );
  await boss.schedule(ORDER_EMAIL_PURGE_QUEUE, "45 3 * * *");
}
