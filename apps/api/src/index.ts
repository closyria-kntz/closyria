import { brevoMailer, createAuth, memoryMailer } from "@closyria/auth";
import { createDb, pingDb } from "@closyria/db";
import { parseEnv } from "@closyria/shared";
import { memoryStore, s3Store } from "@closyria/storage";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { envSchema } from "./env";
import { registerOwnedTables } from "./owned-tables";

const env = parseEnv(envSchema);

const { db, pool } = createDb(env.DATABASE_URL);
const mailer =
  env.MAIL_TRANSPORT === "brevo" && env.BREVO_API_KEY
    ? brevoMailer({ apiKey: env.BREVO_API_KEY, from: env.MAIL_FROM })
    : // The code is printed only in local development, so one can sign in without Brevo.
      memoryMailer({ logContent: env.APP_ENV === "development" });
const oauthClient = (clientId?: string, clientSecret?: string) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;
const google = oauthClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
const apple = oauthClient(env.APPLE_CLIENT_ID, env.APPLE_CLIENT_SECRET);
registerOwnedTables(); // before sign-in can link accounts
const auth = createAuth({
  db,
  mailer,
  baseUrl: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  social: { ...(google ? { google } : {}), ...(apple ? { apple } : {}) },
});
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
const app = createApp({
  env: env.APP_ENV,
  version: env.APP_VERSION,
  pingDb: () => pingDb(db),
  auth,
  media: { db, store },
  events: { db },
  admin: { db },
});

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
