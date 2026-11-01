import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runMigrations } from "@closyria/db";
import pg from "pg";

const run = promisify(execFile);

const PG_BIN = "/usr/lib/postgresql/18/bin";
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

export type TestDatabase = {
  url: string;
  stop(): Promise<void>;
};

/**
 * Starts a disposable PostgreSQL database.
 * - With TEST_DATABASE_URL (CI service): creates a throwaway `test_<random>` database on that server.
 * - Otherwise: runs an ephemeral cluster owned by the current user, reachable only through a Unix
 *   socket in a temp directory (no sudo, no TCP).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  return serverUrl ? createThrowawayDatabase(serverUrl) : startEphemeralCluster();
}

/** Applies the packages/db migrations to `url`. No-op while no migration exists yet. */
export async function migrateTestDatabase(url: string): Promise<void> {
  if (!existsSync(join(MIGRATIONS_DIR, "meta", "_journal.json"))) return;
  await runMigrations(url, MIGRATIONS_DIR);
}

async function createThrowawayDatabase(serverUrl: string): Promise<TestDatabase> {
  const name = `test_${randomBytes(8).toString("hex")}`;
  await withAdminClient(serverUrl, (client) => client.query(`create database ${name}`));

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    stop: () =>
      withAdminClient(serverUrl, (client) => client.query(`drop database if exists ${name} with (force)`)).then(
        () => undefined,
      ),
  };
}

async function withAdminClient<T>(serverUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: serverUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function startEphemeralCluster(): Promise<TestDatabase> {
  const root = await mkdtemp(join(tmpdir(), "closyria-pg-"));
  const dataDir = join(root, "data");
  // The port only names the socket file (.s.PGSQL.<port>); pick one unlikely to clash.
  const port = 20000 + Math.floor(Math.random() * 40000);
  const user = "postgres";
  let started = false;

  const pgCtl = (...args: string[]) => run(join(PG_BIN, "pg_ctl"), ["-D", dataDir, ...args]);

  try {
    await run(join(PG_BIN, "initdb"), ["-D", dataDir, "-U", user, "--auth=trust", "--no-sync"]);
    await writeFile(
      join(dataDir, "postgresql.auto.conf"),
      [
        "listen_addresses = ''",
        `port = ${port}`,
        `unix_socket_directories = '${root}'`,
        "fsync = off",
        "synchronous_commit = off",
        "full_page_writes = off",
        "",
      ].join("\n"),
      { flag: "a" },
    );
    await pgCtl("-w", "-s", "-l", join(root, "server.log"), "start");
    started = true;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }

  const url = `postgresql://${user}@/postgres?host=${encodeURIComponent(root)}&port=${port}`;

  return {
    url,
    stop: async () => {
      try {
        if (started) await pgCtl("-w", "-s", "-m", "immediate", "stop");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}
