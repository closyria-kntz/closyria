import { createDb, pingDb } from "@closyria/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./env";

const { db, pool } = createDb(env.DATABASE_URL);
const app = createApp({ env: env.APP_ENV, version: env.APP_VERSION, pingDb: () => pingDb(db) });

const server = serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`api ${env.APP_VERSION} (${env.APP_ENV}) listening on ${info.address}:${info.port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
