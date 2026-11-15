import type { Database } from "@closyria/db";
import { ORDER_EMAIL_PARSE_QUEUE } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { checkDueParcels, PARCEL_CHECK_QUEUE, parcelCheckHandler } from "./parcel-check";
import { type AiReader, ORDER_EMAIL_PARSE_QUEUE_OPTIONS, orderEmailParseHandler } from "./parse";
import { type InboundPurgeResult, purgeInboundEmails } from "./purge-inbound";
import { registerOrderDailyQueue } from "./returns";
import type { TrackingConnectors } from "./tracking";

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
      const { deleted, cleared, failed, codes } = await run();
      if (deleted + cleared + failed + codes > 0) {
        console.log(
          `inbound e-mail purge: ${deleted} e-mail(s) deleted, ${cleared} raw message(s) erased, ${failed} left unfinished marked failed, ${codes} Gmail code(s) erased`,
        );
      }
    }
  };
}

/**
 * Creates order-email-purge, processes it and schedules it every night at 03:45 (after the wardrobe purge); works
 * order-email-parse (filled by the API), its retries set here: the API may have created the queue first, bare.
 * parcel-check sweeps the due parcels every 15 minutes (one sweep at a time: the claim skips what another holds).
 * order-daily reminds the return deadlines and asks « Tu as reçu ta commande ? » every morning at 9:00 Paris.
 */
export async function registerOrderQueues(
  boss: PgBoss,
  deps: { db: Database; store: ObjectStore; ai?: AiReader; connectors: TrackingConnectors },
): Promise<void> {
  await boss.createQueue(ORDER_EMAIL_PARSE_QUEUE, { ...ORDER_EMAIL_PARSE_QUEUE_OPTIONS });
  await boss.updateQueue(ORDER_EMAIL_PARSE_QUEUE, { ...ORDER_EMAIL_PARSE_QUEUE_OPTIONS });
  await boss.work(
    ORDER_EMAIL_PARSE_QUEUE,
    { includeMetadata: true },
    orderEmailParseHandler({ db: deps.db, store: deps.store, ai: deps.ai ?? null }),
  );
  await boss.createQueue(ORDER_EMAIL_PURGE_QUEUE);
  await boss.work(
    ORDER_EMAIL_PURGE_QUEUE,
    orderEmailPurgeHandler(() => purgeInboundEmails(deps.db, new Date(), deps.store)),
  );
  await boss.schedule(ORDER_EMAIL_PURGE_QUEUE, "45 3 * * *");
  await boss.createQueue(PARCEL_CHECK_QUEUE, { policy: "singleton" });
  await boss.work(
    PARCEL_CHECK_QUEUE,
    parcelCheckHandler(() => checkDueParcels({ db: deps.db, connectors: deps.connectors }, new Date())),
  );
  await boss.schedule(PARCEL_CHECK_QUEUE, "*/15 * * * *");
  await registerOrderDailyQueue(boss, deps.db);
}
