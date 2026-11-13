import type { PgBoss } from "pg-boss";
import { abortRunningImports, settleRunningImports } from "./catalogue/import-shopify";

/**
 * SIGTERM (a deploy restarts the worker; systemd kills it 20 s later): the catalogue imports stop first, before their
 * next request or product, record `interrupted` and clear their « en cours » (the next start queues them again);
 * pg-boss then stops, waiting `timeoutMs` at most for the handlers before it fails what is still active. The imports'
 * last writes are awaited before the caller closes the database pool.
 */
export async function stopWorker(boss: Pick<PgBoss, "stop">, options: { timeoutMs: number }): Promise<void> {
  abortRunningImports();
  await boss.stop({ graceful: true, timeout: options.timeoutMs });
  if (!(await settleRunningImports(2_000))) console.warn("catalogue import: still running at shutdown");
}
