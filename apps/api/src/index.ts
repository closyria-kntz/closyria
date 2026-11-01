import { brevoMailer, createAuth, memoryMailer } from "@closyria/auth";
import { createDb, pingDb } from "@closyria/db";
import { parseEnv } from "@closyria/shared";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { envSchema } from "./env";

const env = parseEnv(envSchema);

const { db, pool } = createDb(env.DATABASE_URL);
const mailer =
  env.MAIL_TRANSPORT === "brevo" && env.BREVO_API_KEY
    ? brevoMailer({ apiKey: env.BREVO_API_KEY, from: env.MAIL_FROM })
    : // The code is printed only in local development, so one can sign in without Brevo.
      memoryMailer({ logContent: env.APP_ENV === "development" });
const auth = createAuth({ db, mailer, baseUrl: env.BETTER_AUTH_URL, secret: env.BETTER_AUTH_SECRET });
const app = createApp({ env: env.APP_ENV, version: env.APP_VERSION, pingDb: () => pingDb(db), auth });

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
