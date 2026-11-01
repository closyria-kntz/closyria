import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { migrateTestDatabase, startTestDatabase } from "@closyria/testing";
import { startProxy } from "./proxy";

export const ROOT = join(import.meta.dirname, "../..");
const API_BUNDLE = join(ROOT, "apps/api/dist/index.mjs");
const WEB_DIR = join(ROOT, "apps/web");
const NEXT_BIN = join(WEB_DIR, "node_modules/next/dist/bin/next");

/** Ports the browser tests must never bind: the prod and dev services run on this machine. */
const RESERVED_PORTS = new Set([3000, 3001, 3100, 3101]);

export type Stack = {
  /** The same-origin front (proxy): what the browser opens. */
  baseUrl: string;
  databaseUrl: string;
  stop(): Promise<void>;
};

/**
 * Starts everything the browser tests need, on free ports: a disposable PostgreSQL (migrated), the built
 * API (APP_ENV=test, memory mailer), the built web app and the same-origin proxy. Server output goes to
 * `logFile`, so the test output stays clean. `stop` undoes only what was started, in reverse order.
 */
export async function startStack(logFile: string): Promise<Stack> {
  for (const [path, build] of [
    [API_BUNDLE, "the API"],
    [join(WEB_DIR, ".next/BUILD_ID"), "the web app"],
  ] as const) {
    if (!existsSync(path)) throw new Error(`Build ${build} first (pnpm build): ${path} is missing`);
  }
  const log = createWriteStream(logFile);
  const cleanups: (() => Promise<void>)[] = [];
  const stop = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
    await new Promise((resolve) => log.end(resolve));
  };

  try {
    const database = await startTestDatabase();
    cleanups.push(() => database.stop());
    await migrateTestDatabase(database.url);

    const [apiPort, webPort] = [await freePort(), await freePort()];
    const api = `http://127.0.0.1:${apiPort}`;
    const web = `http://127.0.0.1:${webPort}`;
    // The proxy's port is the origin Better Auth must know, so it starts (and listens) first.
    const proxy = await startProxy({ api, web });
    cleanups.push(() => proxy.close());

    const apiProcess = launch("api", [API_BUNDLE], ROOT, log, {
      APP_ENV: "test",
      APP_VERSION: "e2e",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_URL: proxy.url,
      MAIL_TRANSPORT: "memory",
    });
    cleanups.push(() => terminate(apiProcess));
    const webProcess = launch(
      "web",
      [NEXT_BIN, "start", "--port", String(webPort), "--hostname", "127.0.0.1"],
      WEB_DIR,
      log,
      {
        APP_ENV: "test",
        INTERNAL_API_URL: api,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    );
    cleanups.push(() => terminate(webProcess));

    await Promise.all([waitForOk(`${api}/api/health`, apiProcess, logFile), waitForOk(`${web}/`, webProcess, logFile)]);
    return { baseUrl: proxy.url, databaseUrl: database.url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function launch(
  name: string,
  args: string[],
  cwd: string,
  log: NodeJS.WritableStream,
  env: Record<string, string>,
): ChildProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "production", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => log.write(`[${name}] ${chunk}`));
  }
  return child;
}

/** SIGTERM, then SIGKILL if the process is still there after 10 s. Only ever the process we started. */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  await exited;
  clearTimeout(timer);
}

/** Polls `url` until it answers 200; fails at once if the server exits, or after 60 s. */
async function waitForOk(url: string, child: ChildProcess, logFile: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${url}: the server exited (${child.exitCode}), see ${logFile}`);
    const ok = await fetch(url).then(
      (res) => res.ok,
      () => false,
    );
    if (ok) return;
    await delay(250);
  }
  throw new Error(`${url} did not answer within 60 s, see ${logFile}`);
}

/** A free TCP port on 127.0.0.1, never one of the prod or dev services. */
async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
      });
    });
    if (port && !RESERVED_PORTS.has(port)) return port;
  }
}
