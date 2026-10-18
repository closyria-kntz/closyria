import { PgBoss } from "pg-boss";
import { env } from "./env";

const HEARTBEAT = "heartbeat";

const boss = new PgBoss(env.DATABASE_URL);
boss.on("error", (error) => console.error("pg-boss error:", error));

await boss.start();
await boss.createQueue(HEARTBEAT);
// Proves end-to-end that scheduling and job processing work.
await boss.schedule(HEARTBEAT, "*/5 * * * *");
await boss.work(HEARTBEAT, async () => {
  console.log(`heartbeat ${new Date().toISOString()}`);
});

console.log(`worker ${env.APP_VERSION} (${env.APP_ENV}) started`);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
