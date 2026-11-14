import {
  CAPTURE_QUEUES,
  CATALOGUE_IMPORT_QUEUE,
  CATALOGUE_IMPORT_QUEUE_OPTIONS,
  CATALOGUE_SHEET_FRESH_MS,
  type CatalogueImportJob,
  PHOTO_IMPORT_QUEUE,
} from "@closyria/shared";

export type CaptureQueueName =
  | typeof CAPTURE_QUEUES.user
  | typeof CAPTURE_QUEUES.admin
  // An admin's retry of a revisit (alerts) goes back to its queue.
  | typeof CAPTURE_QUEUES.revisit;
export type QueueName = CaptureQueueName | typeof PHOTO_IMPORT_QUEUE;

/**
 * Where the API hands work to the worker: a capture (`{ captureId }`) or a photo import (`{ importId }` on
 * `photo-import`), and the Shopify catalogue import of a shop (« Importer maintenant »). Tests inject a recording fake.
 */
export type CaptureQueue = {
  enqueue(queue: QueueName, id: string): Promise<void>;
  /**
   * Queues the import of a shop's catalogue like the nightly planning does (`singletonKey` = shop id); false when an
   * import of that shop is already queued or running.
   */
  importCatalogue(shopId: string): Promise<boolean>;
  /**
   * Hands a sheet's refresh (`{ captureId }` on `capture-refresh`, its own queue: never in the way of the pasted
   * links) to the worker, at most one per product in each 15-minute window (`singletonKey` = product id); false when
   * one was already sent in that window.
   */
  refreshProduct(productId: string, captureId: string): Promise<boolean>;
};

/**
 * Sending-only pg-boss queue: the instance is started without supervision, maintenance or scheduling
 * (those belong to the worker), on the first job. `send` fails when the queue does not exist, and the
 * worker creates the queues, so both are created here too (`createQueue` does nothing when it exists):
 * a capture or import asked for before the worker has ever run still waits for it.
 */
export function pgBossQueue(boss: {
  start(): Promise<unknown>;
  createQueue(name: string, options?: object): Promise<unknown>;
  send(name: string, data: object, options?: { singletonKey: string; singletonSeconds?: number }): Promise<unknown>;
}): CaptureQueue {
  let ready: Promise<void> | undefined;
  const start = () =>
    (ready ??= (async () => {
      await boss.start();
      await boss.createQueue(CAPTURE_QUEUES.user);
      await boss.createQueue(CAPTURE_QUEUES.admin);
      await boss.createQueue(CAPTURE_QUEUES.refresh);
      await boss.createQueue(CAPTURE_QUEUES.revisit);
      await boss.createQueue(PHOTO_IMPORT_QUEUE);
      // Same options as the worker's: the first `createQueue` wins.
      await boss.createQueue(CATALOGUE_IMPORT_QUEUE, { ...CATALOGUE_IMPORT_QUEUE_OPTIONS });
    })().catch((error) => {
      ready = undefined; // try again on the next capture
      throw error;
    }));
  return {
    async enqueue(queue, id) {
      await start();
      await boss.send(queue, queue === PHOTO_IMPORT_QUEUE ? { importId: id } : { captureId: id });
    },
    async importCatalogue(shopId) {
      await start();
      // Marked as asked by the admin: resumed after a worker restart even when the nightly import is off.
      const job: CatalogueImportJob = { shopId, manual: true };
      // pg-boss answers null instead of a job id when the singleton is taken (policy `exclusive`).
      const id = await boss.send(CATALOGUE_IMPORT_QUEUE, job, { singletonKey: shopId });
      return id !== null && id !== undefined;
    },
    async refreshProduct(productId, captureId) {
      await start();
      const id = await boss.send(
        CAPTURE_QUEUES.refresh,
        { captureId },
        { singletonKey: productId, singletonSeconds: CATALOGUE_SHEET_FRESH_MS / 1000 },
      );
      return id !== null && id !== undefined;
    },
  };
}
