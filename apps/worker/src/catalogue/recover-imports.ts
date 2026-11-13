import { and, type Database, eq, inArray, isNull, or, schema } from "@closyria/db";
import { CATALOGUE_IMPORT_QUEUE, type CatalogueImportJob, catalogueImportJobSchema } from "@closyria/shared";
import type { PgBoss } from "pg-boss";

export type RecoveryQueue = Pick<PgBoss, "findJobs" | "fail" | "send">;

const PAGE = 1000;

/** The import job of a shop as pg-boss holds it: the newest one under its key, else null. */
async function lastJobOf(boss: RecoveryQueue, shopId: string): Promise<CatalogueImportJob | null> {
  const jobs = await boss.findJobs(CATALOGUE_IMPORT_QUEUE, { key: shopId });
  const newest = jobs.reduce<(typeof jobs)[number] | null>(
    (last, job) => (!last || job.createdOn.getTime() > last.createdOn.getTime() ? job : last),
    null,
  );
  const data = catalogueImportJobSchema.safeParse(newest?.data);
  return data.success ? data.data : null;
}

/**
 * Worker start (one worker process only, which has not taken any import yet): every catalogue import still `active`
 * in pg-boss, or `running` on its shop, belongs to a process that is gone (killed, or stopped before it could settle).
 * Its jobs are failed through pg-boss (else they stay active until their 6 h expiry, and the shop's singleton key
 * blocks « Importer maintenant » and the nightly plan meanwhile). Those shops, and the ones whose import a clean stop
 * interrupted (`last_import_error` = `interrupted`), are queued again so the work resumes, when:
 * - the shop is still in the catalogue (Shopify, not merged, not refused), and
 * - its nightly import is on, or the cut import was asked by the admin (`manual` on its job: « Importer maintenant »,
 *   possible on a shop without the nightly import). A nightly import of a shop whose import was turned off since is
 *   not resumed.
 * Otherwise the shop only loses its « en cours ». The figures of the last complete import stay.
 */
export async function recoverInterruptedImports(
  db: Database,
  boss: RecoveryQueue,
  now = new Date(),
): Promise<{ failed: number; requeued: string[] }> {
  const active = new Map<string, { id: string; job: CatalogueImportJob | null }>();
  const activeIds: string[] = [];
  for (let after: string | undefined; ; ) {
    const jobs = await boss.findJobs(CATALOGUE_IMPORT_QUEUE, { limit: PAGE, ...(after ? { after } : {}) });
    for (const job of jobs) {
      if (job.state !== "active") continue;
      activeIds.push(job.id);
      const data = catalogueImportJobSchema.safeParse(job.data);
      if (data.success) active.set(data.data.shopId, { id: job.id, job: data.data });
    }
    if (jobs.length < PAGE) break;
    after = jobs.at(-1)?.id;
  }
  if (activeIds.length > 0) {
    await boss.fail(CATALOGUE_IMPORT_QUEUE, activeIds, { message: "worker restarted while the import was under way" });
    console.warn(`catalogue import: ${activeIds.length} job(s) of a previous process failed`);
  }

  const fromJobs = [...active.keys()];
  const left = await db
    .select({
      id: schema.shops.id,
      platform: schema.shops.platform,
      status: schema.shops.status,
      mergedIntoId: schema.shops.mergedIntoId,
      importEnabled: schema.shops.importEnabled,
      isMajorBrand: schema.shops.isMajorBrand,
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
    // The cut job: the active one failed above, else the shop's newest (settled at a clean stop, or by pg-boss).
    const job = active.has(shop.id) ? (active.get(shop.id)?.job ?? null) : await lastJobOf(boss, shop.id);
    const manual = job?.manual === true;
    const resumable =
      shop.platform === "shopify" &&
      shop.status !== "refused" &&
      shop.mergedIntoId === null &&
      // A « grande enseigne » is never imported by the planner: only an import the admin asked for resumes.
      ((shop.importEnabled && !shop.isMajorBrand) || manual);
    // A state left by the dead process. « En attente » only when its job was the one failed above (taken, not yet
    // started); otherwise a job is still waiting in the queue to run it.
    const leftBehind = and(
      eq(schema.shops.id, shop.id),
      active.has(shop.id) ? undefined : or(isNull(schema.shops.importState), eq(schema.shops.importState, "running")),
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
      const data: CatalogueImportJob = { shopId: shop.id, ...(manual ? { manual } : {}) };
      // Null: a job of the shop already waits in the queue (singleton key); it runs the import, « En attente » holds.
      const id = await boss.send(CATALOGUE_IMPORT_QUEUE, data, { singletonKey: shop.id });
      if (id) requeued.push(shop.id);
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
  return { failed: activeIds.length, requeued };
}
