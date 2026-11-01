import { parseEnv } from "@closyria/shared";
import { serve } from "@hono/node-server";
import { bootstrap } from "./bootstrap";
import { envSchema } from "./env";

const env = parseEnv(envSchema);
const { app, pool } = bootstrap(env);

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
