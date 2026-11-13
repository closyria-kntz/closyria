import type dns from "node:dns";
import type { Database } from "@closyria/db";
import {
  CAPTURE_QUEUES,
  CATALOGUE_IMPORT_QUEUE,
  CATALOGUE_IMPORT_QUEUE_OPTIONS,
  captureJobSchema,
  catalogueImportJobSchema,
} from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { type ImportDeps, importShopifyCatalog } from "../catalogue/import-shopify";
import { type ImportQueue, planCatalogueImports } from "../catalogue/plan-imports";
import { type AddressPolicy, strictPolicy } from "./address-policy";
import { type MonitorQueue, scheduleMonitors } from "./monitor";
import { createRobotsCache, safeRobotsFetcher } from "./robots";
import { type CaptureDeps, runCapture } from "./run-capture";
import { sweepStuckCaptures } from "./sweep";
import { createThrottle, type Throttle } from "./throttle";

type JobLike = { id?: string; data: unknown };

function parseJob(queue: string, job: JobLike) {
  const parsed = captureJobSchema.safeParse(job.data);
  if (!parsed.success) {
    console.error(`${queue}: invalid job data (job ${job.id ?? "?"}), failing it`);
    throw new Error(`invalid job data on ${queue}`);
  }
  return parsed.data;
}

/** capture-user and capture-admin: data that does not validate fails the job (pg-boss), runCapture is not called. */
export function captureHandler(deps: CaptureDeps, queue: string) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) await runCapture(parseJob(queue, job).captureId, deps);
  };
}

/** capture-monitor: no data or `{}` plans the monitors; `{ captureId }` runs a capture; anything else fails. */
export function monitorHandler(deps: CaptureDeps, queue: MonitorQueue) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (empty) await scheduleMonitors(deps.db, queue);
      else await runCapture(parseJob(CAPTURE_QUEUES.monitor, job).captureId, deps);
    }
  };
}

/** catalogue-import: no data or `{}` plans the night's imports; `{ shopId }` imports that shop; anything else fails. */
export function catalogueImportHandler(deps: ImportDeps, queue: ImportQueue) {
  return async (jobs: JobLike[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data;
      const empty =
        data === null ||
        data === undefined ||
        (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
      if (empty) {
        const planned = await planCatalogueImports(deps.db, queue);
        if (planned > 0) console.log(`catalogue import: ${planned} shop(s) queued`);
        continue;
      }
      const parsed = catalogueImportJobSchema.safeParse(data);
      if (!parsed.success) {
        console.error(`${CATALOGUE_IMPORT_QUEUE}: invalid job data (job ${job.id ?? "?"}), failing it`);
        throw new Error(`invalid job data on ${CATALOGUE_IMPORT_QUEUE}`);
      }
      const result = await importShopifyCatalog(deps, parsed.data.shopId);
      // Counts and a short reason only: the details are on the shop (last_import_error).
      console.log(
        `catalogue import ${parsed.data.shopId}: ${result.created} created, ${result.updated} updated, ${result.removed} removed${result.error ? `, stopped: ${result.error}` : ""}`,
      );
    }
  };
}

export const SWEEP_QUEUE = "capture-sweep";

export type CaptureQueueDeps = {
  db: Database;
  store: ObjectStore;
  policy?: AddressPolicy;
  /** Browser tests only: resolves their loopback shop names without DNS. Defaults to the system resolver. */
  lookup?: typeof dns.lookup;
  /** Browser tests only: no spacing between requests to their one local shop. Defaults to 2 s per domain. */
  throttle?: Throttle;
};

/**
 * Creates the capture queues (same default options as the API, which creates them too), processes them and
 * schedules the daily monitor (04:00) and the 5-minute sweep of stuck captures. Also the Shopify catalogue imports:
 * planned every night at 03:00 (Paris), one shop at a time.
 */
export async function registerCaptureQueues(boss: PgBoss, deps: CaptureQueueDeps): Promise<void> {
  const { db, store, lookup } = deps;
  const policy = deps.policy ?? strictPolicy;
  const robots = createRobotsCache(safeRobotsFetcher(policy, lookup), Date.now);
  const throttle = deps.throttle ?? createThrottle();
  const captureDeps: CaptureDeps = { db, store, policy, robots, throttle, ...(lookup ? { lookup } : {}) };

  for (const name of [CAPTURE_QUEUES.user, CAPTURE_QUEUES.admin, CAPTURE_QUEUES.monitor, SWEEP_QUEUE]) {
    await boss.createQueue(name);
  }
  await boss.createQueue(CATALOGUE_IMPORT_QUEUE, { ...CATALOGUE_IMPORT_QUEUE_OPTIONS });
  await boss.work(CAPTURE_QUEUES.user, { localConcurrency: 4 }, captureHandler(captureDeps, CAPTURE_QUEUES.user));
  await boss.work(CAPTURE_QUEUES.admin, { localConcurrency: 1 }, captureHandler(captureDeps, CAPTURE_QUEUES.admin));
  // The schedule sends a job without data: it plans the day's monitor captures, which come back here.
  await boss.work(CAPTURE_QUEUES.monitor, { localConcurrency: 1 }, monitorHandler(captureDeps, boss));
  // One job at a time: one shop imported at a time, and never two imports of the same shop.
  await boss.work(
    CATALOGUE_IMPORT_QUEUE,
    { localConcurrency: 1 },
    catalogueImportHandler({ db, store, policy, robots, throttle, ...(lookup ? { lookup } : {}) }, boss),
  );
  await boss.work(SWEEP_QUEUE, async () => {
    const swept = await sweepStuckCaptures(db, new Date());
    if (swept > 0) console.warn(`capture sweep: ${swept} stuck capture(s) marked as timeout`);
  });

  await boss.schedule(CAPTURE_QUEUES.monitor, "0 4 * * *", undefined, { key: "daily-monitor" });
  await boss.schedule(SWEEP_QUEUE, "*/5 * * * *");
  await boss.schedule(CATALOGUE_IMPORT_QUEUE, "0 3 * * *", undefined, { key: "nightly-import", tz: "Europe/Paris" });
}
