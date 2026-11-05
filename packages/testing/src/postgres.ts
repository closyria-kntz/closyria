import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  /** Idempotent. */
  stop(): Promise<void>;
};

/** A PostgreSQL server for a whole test run, with a migrated template database to copy per test file. */
export type TestServer = {
  /** Serializable part, handed to test files through Vitest's `provide`/`inject`. */
  info: TestServerInfo;
  /** Best-effort synchronous stop, for `process.on("exit")` and signals. */
  stopSync(): void;
  /** Idempotent. */
  stop(): Promise<void>;
};

export type TestServerInfo = { serverUrl: string; template: string };

/**
 * Starts a disposable PostgreSQL database.
 * - With TEST_DATABASE_URL (CI service): creates a throwaway `test_<random>` database on that server.
 * - Otherwise: runs an ephemeral cluster owned by the current user, reachable only through a Unix
 *   socket in a temp directory (no sudo, no TCP).
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (!serverUrl) return startEphemeralCluster().then(({ url, stop }) => ({ url, stop }));
  return createDatabase(serverUrl, `test_${randomBytes(8).toString("hex")}`);
}

/** Applies the packages/db migrations to `url`. No-op while no migration exists yet. */
export async function migrateTestDatabase(url: string): Promise<void> {
  if (!existsSync(join(MIGRATIONS_DIR, "meta", "_journal.json"))) return;
  await runMigrations(url, MIGRATIONS_DIR);
}

/**
 * One server for a test run (vitest globalSetup): an ephemeral cluster, or TEST_DATABASE_URL in CI,
 * holding a template database migrated once. Test files copy it with `createDatabaseFromTemplate`.
 */
export async function startTestServer(): Promise<TestServer> {
  const template = `template_${randomBytes(8).toString("hex")}`;
  const ciUrl = process.env.TEST_DATABASE_URL;
  if (ciUrl) {
    const database = await createDatabase(ciUrl, template);
    await migrateTestDatabase(database.url);
    return { info: { serverUrl: ciUrl, template }, stop: database.stop, stopSync: () => {} };
  }

  const cluster = await startEphemeralCluster();
  try {
    await withAdminClient(cluster.url, (client) => client.query(`create database ${ident(template)}`));
    await migrateTestDatabase(databaseUrl(cluster.url, template));
  } catch (error) {
    await cluster.stop();
    throw error;
  }
  return { info: { serverUrl: cluster.url, template }, stop: cluster.stop, stopSync: cluster.stopSync };
}

/** A fresh database copied from the migrated template: no migration per test file. */
export async function createDatabaseFromTemplate({ serverUrl, template }: TestServerInfo): Promise<TestDatabase> {
  return createDatabase(serverUrl, `test_${randomBytes(8).toString("hex")}`, template);
}

/** `url` pointing at database `name` instead (works for socket URLs with an empty host too). */
export function databaseUrl(url: string, name: string): string {
  const match = /^([a-z]+:\/\/[^/?]*)(\/[^?]*)?(\?.*)?$/.exec(url);
  if (!match) throw new Error("Unrecognised PostgreSQL URL");
  return `${match[1]}/${encodeURIComponent(name)}${match[3] ?? ""}`;
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function createDatabase(serverUrl: string, name: string, template?: string): Promise<TestDatabase> {
  const from = template ? ` template ${ident(template)}` : "";
  await withAdminClient(serverUrl, (client) => client.query(`create database ${ident(name)}${from}`));
  let stopping: Promise<void> | undefined;
  return {
    url: databaseUrl(serverUrl, name),
    stop: () => {
      stopping ??= withAdminClient(serverUrl, async (client) => {
        await waitForSessionsToEnd(client, name);
        await client.query(`drop database if exists ${ident(name)} with (force)`);
      });
      return stopping;
    },
  };
}

/**
 * `pool.end()` resolves once the pool has sent its Terminate messages, not once the backends are gone.
 * Dropping with `(force)` in that window kills a backend whose client is still closing, and `pg` raises
 * the resulting FATAL 57P01 as an uncaught error in the test run. So wait (bounded) until the sessions
 * have left on their own; `with (force)` stays as the fallback for a test that leaked a connection.
 */
async function waitForSessionsToEnd(client: pg.Client, name: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await client.query<{ n: number }>(
      "select count(*)::int as n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [name],
    );
    if (rows[0]?.n === 0 || Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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

type Cluster = TestDatabase & { stopSync(): void };

/** Exported for tests; `config` lines are appended to postgresql.auto.conf. */
export async function startEphemeralCluster(options: { config?: string[] } = {}): Promise<Cluster> {
  const root = await mkdtemp(join(tmpdir(), "closyria-pg-"));
  const dataDir = join(root, "data");
  const logFile = join(root, "server.log");
  // The port only names the socket file (.s.PGSQL.<port>); pick one unlikely to clash.
  const port = 20000 + Math.floor(Math.random() * 40000);
  const user = "postgres";

  const pgCtlArgs = (...args: string[]) => ["-D", dataDir, ...args];
  const pgCtl = (...args: string[]) => run(join(PG_BIN, "pg_ctl"), pgCtlArgs(...args));
  const stopArgs = pgCtlArgs("-w", "-s", "-m", "immediate", "stop");

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
        ...(options.config ?? []),
        "",
      ].join("\n"),
      { flag: "a" },
    );
    await pgCtl("-w", "-s", "-l", logFile, "start");
  } catch (error) {
    // A postmaster may be up even though `pg_ctl start` failed (e.g. its wait timed out): stop it
    // before removing its directory, and keep the server log, which holds the actual cause.
    await pgCtl(...stopArgs.slice(2)).catch(() => {});
    const serverLog = await readFile(logFile, "utf8").catch(() => "");
    await rm(root, { recursive: true, force: true });
    const detail = serverLog.trim() ? `\n--- server.log ---\n${serverLog.trim()}` : "";
    throw new Error(`Could not start the test PostgreSQL cluster: ${(error as Error).message}${detail}`, {
      cause: error,
    });
  }

  let stopping: Promise<void> | undefined;
  let stopped = false;
  return {
    url: `postgresql://${user}@/postgres?host=${encodeURIComponent(root)}&port=${port}`,
    stop: () => {
      stopping ??= (async () => {
        if (stopped) return; // already stopped by stopSync()
        try {
          await pgCtl(...stopArgs.slice(2));
        } finally {
          stopped = true;
          await rm(root, { recursive: true, force: true });
        }
      })();
      return stopping;
    },
    stopSync: () => {
      if (stopped || stopping) return;
      stopped = true;
      try {
        execFileSync(join(PG_BIN, "pg_ctl"), stopArgs, { stdio: "ignore" });
      } catch {
        // Best effort: the process is exiting anyway.
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
