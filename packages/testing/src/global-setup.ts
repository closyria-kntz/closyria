import type { TestProject } from "vitest/node";
import { startTestServer } from "./postgres";

/**
 * Vitest globalSetup: ONE PostgreSQL server per package test run, with the migrations applied once to
 * a template database. Each test file then copies the template (`createTestDatabase`), instead of
 * starting its own cluster — many clusters starting at once under turbo made runs flaky.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await startTestServer();

  // If the run is interrupted, teardown may never run: stop the postmaster on the way out anyway.
  const onExit = () => server.stopSync();
  const onSignal = (signal: NodeJS.Signals) => {
    server.stopSync();
    // Re-raise only if nobody else (Vitest) handles the signal, so the default exit still happens.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  };
  process.once("exit", onExit);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, onSignal);

  project.provide("closyriaTestServer", server.info);

  return async () => {
    process.off("exit", onExit);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, onSignal);
    await server.stop();
  };
}
