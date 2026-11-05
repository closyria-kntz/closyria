import type { Database } from "@closyria/db";
import { CAPTURE_QUEUES } from "@closyria/shared";
import type { ObjectStore } from "@closyria/storage";
import type { PgBoss } from "pg-boss";
import { type AddressPolicy, strictPolicy } from "./address-policy";
import { scheduleMonitors } from "./monitor";
import { createRobotsCache, safeRobotsFetcher } from "./robots";
import { runCapture } from "./run-capture";
import { sweepStuckCaptures } from "./sweep";
import { createThrottle } from "./throttle";

export const SWEEP_QUEUE = "capture-sweep";

export type CaptureQueueDeps = { db: Database; store: ObjectStore; policy?: AddressPolicy };

/**
 * Creates the capture queues (same default options as the API, which creates them too), processes them and
 * schedules the daily monitor (04:00) and the 5-minute sweep of stuck captures.
 */
export async function registerCaptureQueues(boss: PgBoss, deps: CaptureQueueDeps): Promise<void> {
  const { db, store } = deps;
  const policy = deps.policy ?? strictPolicy;
  const robots = createRobotsCache(safeRobotsFetcher(policy), Date.now);
  const throttle = createThrottle();
  const captureDeps = { db, store, policy, robots, throttle };

  for (const name of [CAPTURE_QUEUES.user, CAPTURE_QUEUES.admin, CAPTURE_QUEUES.monitor, SWEEP_QUEUE]) {
    await boss.createQueue(name);
  }
  const handle = (jobs: { data: { captureId?: string } | null }[]) =>
    Promise.all(jobs.map((job) => (job.data?.captureId ? runCapture(job.data.captureId, captureDeps) : undefined)));
  await boss.work(CAPTURE_QUEUES.user, { localConcurrency: 4 }, handle);
  await boss.work(CAPTURE_QUEUES.admin, { localConcurrency: 1 }, handle);
  // The schedule sends a job without a capture: it plans the day's monitor captures, which come back here.
  await boss.work(CAPTURE_QUEUES.monitor, { localConcurrency: 1 }, async (jobs) => {
    for (const job of jobs) {
      const captureId = (job.data as { captureId?: string } | null)?.captureId;
      if (captureId) await runCapture(captureId, captureDeps);
      else await scheduleMonitors(db, boss);
    }
  });
  await boss.work(SWEEP_QUEUE, async () => {
    const swept = await sweepStuckCaptures(db, new Date());
    if (swept > 0) console.warn(`capture sweep: ${swept} stuck capture(s) marked as timeout`);
  });

  await boss.schedule(CAPTURE_QUEUES.monitor, "0 4 * * *", undefined, { key: "daily-monitor" });
  await boss.schedule(SWEEP_QUEUE, "*/5 * * * *");
}
