import { brevoMailer, createAuth, memoryMailer } from "@closyria/auth";
import { createDb, type Database, pingDb } from "@closyria/db";
import { memoryStore, s3Store } from "@closyria/storage";
import { createApp } from "./app";
import type { Env } from "./env";
import { registerOwnedTables } from "./owned-tables";

export type Api = { app: ReturnType<typeof createApp>; db: Database; pool: ReturnType<typeof createDb>["pool"] };

/**
 * Builds the API process from its validated configuration: database, mailer, auth, storage, the owned
 * tables registry, and the Hono app. index.ts only adds the HTTP server; tests use the same function.
 */
export function bootstrap(env: Env): Api {
  const { db, pool } = createDb(env.DATABASE_URL);
  // The code is printed only in local development, so one can sign in without Brevo.
  const memory = env.MAIL_TRANSPORT === "memory" ? memoryMailer({ logContent: env.APP_ENV === "development" }) : null;
  const mailer = memory ?? brevoMailer({ apiKey: env.BREVO_API_KEY ?? "", from: env.MAIL_FROM });
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
    origin: env.BETTER_AUTH_URL,
    pingDb: () => pingDb(db),
    auth,
    media: { db, store },
    events: { db },
    admin: { db },
    // R18: the browser tests read their codes here; env.ts guarantees the memory mailer with APP_ENV=test.
    ...(env.APP_ENV === "test" && memory ? { testMail: memory } : {}),
  });
  return { app, db, pool };
}
