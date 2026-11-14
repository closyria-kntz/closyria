import { brevoMailer, createAuth, memoryMailer } from "@closyria/auth";
import { createDb, type Database, pingDb } from "@closyria/db";
import { vapidConfig } from "@closyria/shared";
import { fsStore, memoryStore, type ObjectStore, s3Store } from "@closyria/storage";
import { PgBoss } from "pg-boss";
import { createApp } from "./app";
import { pgBossQueue } from "./catalog/capture-queue";
import type { Env } from "./env";
import { registerOwnedTables } from "./owned-tables";
import { parseShareLinkKey } from "./wardrobe/share-link";

export type Api = {
  app: ReturnType<typeof createApp>;
  db: Database;
  pool: ReturnType<typeof createDb>["pool"];
  /** Stops the job queue connection (no-op when it never started). Call before closing the pool. */
  stopQueue: () => Promise<void>;
};

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
  const store = objectStoreFor(env);
  // Sending only: no supervision (maintenance) and no scheduling, which stay with the worker. It connects on
  // the first capture, so the API starts without it.
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, max: 2, supervise: false, schedule: false });
  boss.on("error", (error) => console.error("pg-boss error:", error));
  const app = createApp({
    env: env.APP_ENV,
    version: env.APP_VERSION,
    origin: env.BETTER_AUTH_URL,
    pingDb: () => pingDb(db),
    auth,
    media: { db, store },
    events: { db },
    catalog: { db, store, queue: pgBossQueue(boss) },
    admin: { db },
    wardrobe: { db, shareLinkKey: parseShareLinkKey(env.SHARE_LINK_KEY) },
    push: { publicKey: vapidConfig(env)?.publicKey ?? null },
    // R18: the browser tests read their codes here; env.ts guarantees the memory mailer with APP_ENV=test.
    ...(env.APP_ENV === "test" && memory ? { testMail: memory } : {}),
  });
  return { app, db, pool, stopQueue: () => boss.stop({ graceful: true, timeout: 5_000 }) };
}

/**
 * Where photos live. The browser tests (APP_ENV=test with TEST_STORAGE_DIR, which env.ts refuses anywhere
 * else) keep them on disk, shared with their in-process capture worker. Otherwise S3; env.ts requires every
 * S3 variable outside development, so locally photos may live in memory until restart.
 */
export function objectStoreFor(env: Env): ObjectStore {
  if (env.APP_ENV === "test" && env.TEST_STORAGE_DIR) return fsStore(env.TEST_STORAGE_DIR);
  return env.S3_ENDPOINT && env.S3_REGION && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? s3Store({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      })
    : memoryStore();
}
