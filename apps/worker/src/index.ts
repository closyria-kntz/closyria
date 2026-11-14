import { createDb } from "@closyria/db";
import { memoryStore, s3Store } from "@closyria/storage";
import { PgBoss } from "pg-boss";
import { registerSalePeriodQueue } from "./alerts/sales";
import { checkNetworkBarrier } from "./capture/network-barrier";
import { registerCaptureQueues } from "./capture/queues";
import { seedReference } from "./capture/seed-reference";
import { seedStartingShops } from "./capture/seed-shops";
import { env } from "./env";
import { stopWorker } from "./shutdown";
import { registerWardrobeQueues } from "./wardrobe/queues";

const HEARTBEAT = "heartbeat";

const boss = new PgBoss(env.DATABASE_URL);
boss.on("error", (error) => console.error("pg-boss error:", error));
const { db, pool } = createDb(env.DATABASE_URL, { max: 6 });

// env.ts requires every S3 variable outside development; locally, photos may live in memory until restart.
const store =
  env.S3_ENDPOINT && env.S3_REGION && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? s3Store({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      })
    : memoryStore();

const barrier = await checkNetworkBarrier();
if (barrier.state === "active") {
  console.log(`network barrier: active (${barrier.reason})`);
} else if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
  console.warn(`network barrier: ABSENT (${barrier.reason})`);
} else {
  console.log(`network barrier: absent (${barrier.reason})`);
}

await boss.start();
await boss.createQueue(HEARTBEAT);
// Proves end-to-end that scheduling and job processing work.
await boss.schedule(HEARTBEAT, "*/5 * * * *");
await boss.work(HEARTBEAT, async () => {
  console.log(`heartbeat ${new Date().toISOString()}`);
});

const added = await seedStartingShops(db);
if (added > 0) console.log(`starting shops: ${added} added`);
const referenceAdded = await seedReference(db);
if (referenceAdded > 0) console.log(`starting reference lists: ${referenceAdded} added`);
await registerCaptureQueues(boss, { db, store });
await registerWardrobeQueues(boss, { db, store });
await registerSalePeriodQueue(boss, db);

console.log(`worker ${env.APP_VERSION} (${env.APP_ENV}) started`);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  // Imports stop and clear their state while the pool is still open; systemd's limit is 20 s (TimeoutStopSec).
  await stopWorker(boss, { timeoutMs: 10_000 });
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
