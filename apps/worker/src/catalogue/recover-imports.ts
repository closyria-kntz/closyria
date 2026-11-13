import { and, type Database, eq, inArray, isNull, or, schema } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE, catalogueImportJobSchema } from "@closyria/shared";
import type { PgBoss } from "pg-boss";

export type RecoveryQueue = Pick<PgBoss, "findJobs" | "fail" | "send">;

const PAGE = 1000;

/**
 * Worker start (one worker process only, which has not taken any import yet): every catalogue import still `active`
 * in pg-boss, or `running` on its shop, belongs to a process that is gone (killed, or stopped before it could settle).
 * Its jobs are failed through pg-boss (else they stay active until their 6 h expiry, and the shop's singleton key
 * blocks « Importer maintenant » and the nightly plan meanwhile). Those shops, and the ones whose import a clean stop
 * interrupted (`last_import_error` = `interrupted`), are queued again so the work resumes; a shop that left the
 * catalogue since (merged, refused) only loses its « en cours ». The figures of the last complete import stay.
 */
export async function recoverInterruptedImports(
  db: Database,
  boss: RecoveryQueue,
  now = new Date(),
): Promise<{ failed: number; requeued: string[] }> {
  const active: { id: string; shopId: string | null }[] = [];
  for (let after: string | undefined; ; ) {
    const jobs = await boss.findJobs(CATALOGUE_IMPORT_QUEUE, { limit: PAGE, ...(after ? { after } : {}) });
    for (const job of jobs) {
      if (job.state !== "active") continue;
      const data = catalogueImportJobSchema.safeParse(job.data);
      active.push({ id: job.id, shopId: data.success ? data.data.shopId : null });
    }
    if (jobs.length < PAGE) break;
    after = jobs.at(-1)?.id;
  }
  if (active.length > 0) {
    await boss.fail(
      CATALOGUE_IMPORT_QUEUE,
      active.map((job) => job.id),
      { message: "worker restarted while the import was under way" },
    );
    console.warn(`catalogue import: ${active.length} job(s) of a previous process failed`);
  }

  const fromJobs = active.flatMap((job) => (job.shopId ? [job.shopId] : []));
  const left = await db
    .select({
      id: schema.shops.id,
      platform: schema.shops.platform,
      status: schema.shops.status,
      mergedIntoId: schema.shops.mergedIntoId,
    })
    .from(schema.shops)
    .where(
      or(
        eq(schema.shops.importState, "running"),
        and(isNull(schema.shops.importState), eq(schema.shops.lastImportError, "interrupted")),
        fromJobs.length > 0 ? inArray(schema.shops.id, fromJobs) : undefined,
      ),
    );

  const requeued: string[] = [];
  for (const shop of left) {
    const resumable = shop.platform === "shopify" && shop.status !== "refused" && shop.mergedIntoId === null;
    // A state left by the dead process. « En attente » only when its job was the one failed above (taken, not yet
    // started); otherwise a job is still waiting in the queue to run it.
    const leftBehind = and(
      eq(schema.shops.id, shop.id),
      fromJobs.includes(shop.id)
        ? undefined
        : or(isNull(schema.shops.importState), eq(schema.shops.importState, "running")),
    );
    if (!resumable) {
      await db.update(schema.shops).set({ importState: null }).where(leftBehind);
      continue;
    }
    const [marked] = await db
      .update(schema.shops)
      .set({ importState: "queued", importStartedAt: now })
      .where(leftBehind)
      .returning({ id: schema.shops.id });
    if (!marked) continue;
    try {
      await boss.send(CATALOGUE_IMPORT_QUEUE, { shopId: shop.id }, { singletonKey: shop.id });
      requeued.push(shop.id);
    } catch (error) {
      console.error(`catalogue import: cannot queue shop ${shop.id} again`, error);
      await db
        .update(schema.shops)
        .set({ importState: null })
        .where(
          and(
            eq(schema.shops.id, shop.id),
            eq(schema.shops.importState, "queued"),
            eq(schema.shops.importStartedAt, now),
          ),
        );
    }
  }
  if (requeued.length > 0) console.warn(`catalogue import: ${requeued.length} interrupted import(s) queued again`);
  return { failed: active.length, requeued };
}
