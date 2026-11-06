import type { Database } from "@closyria/db";
import type { ObjectStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { purgeTransient } from "./purge-transient";
import { purgeTrash } from "./purge-trash";

export const PURGE_QUEUE = "wardrobe-purge";

type JobLike = { id?: string; data: unknown };

/** wardrobe-purge: the schedule sends no data; anything else fails the job. */
export function purgeHandler(run: () => Promise<number>) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (!empty) {
        console.error(`${PURGE_QUEUE}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${PURGE_QUEUE}`);
      }
      const purged = await run();
      if (purged > 0) console.log(`trash purge: ${purged} item(s) permanently deleted`);
    }
  };
}

/** Creates the wardrobe-purge queue, processes it and schedules it every night at 03:30. */
export async function registerWardrobeQueues(boss: PgBoss, deps: { db: Database; store: ObjectStore }): Promise<void> {
  await boss.createQueue(PURGE_QUEUE);
  await boss.work(
    PURGE_QUEUE,
    purgeHandler(async () => {
      const now = new Date();
      const { recents, imports } = await purgeTransient(deps.db, now, deps.store);
      if (recents + imports > 0)
        console.log(`transient purge: ${recents} recent link(s), ${imports} photo import(s) deleted`);
      return purgeTrash(deps.db, now, deps.store);
    }),
  );
  await boss.schedule(PURGE_QUEUE, "30 3 * * *");
}
