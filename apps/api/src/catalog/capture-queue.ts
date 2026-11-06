import { CAPTURE_QUEUES, PHOTO_IMPORT_QUEUE } from "@closyria/shared";

export type CaptureQueueName = typeof CAPTURE_QUEUES.user | typeof CAPTURE_QUEUES.admin;
export type QueueName = CaptureQueueName | typeof PHOTO_IMPORT_QUEUE;

/**
 * Where the API hands work to the worker: a capture (`{ captureId }`) or a photo import (`{ importId }` on
 * `photo-import`). Tests inject a recording fake.
 */
export type CaptureQueue = {
  enqueue(queue: QueueName, id: string): Promise<void>;
};

/**
 * Sending-only pg-boss queue: the instance is started without supervision, maintenance or scheduling
 * (those belong to the worker), on the first job. `send` fails when the queue does not exist, and the
 * worker creates the queues, so both are created here too (`createQueue` does nothing when it exists):
 * a capture or import asked for before the worker has ever run still waits for it.
 */
export function pgBossQueue(boss: {
  start(): Promise<unknown>;
  createQueue(name: string): Promise<unknown>;
  send(name: string, data: object): Promise<unknown>;
}): CaptureQueue {
  let ready: Promise<void> | undefined;
  const start = () =>
    (ready ??= (async () => {
      await boss.start();
      await boss.createQueue(CAPTURE_QUEUES.user);
      await boss.createQueue(CAPTURE_QUEUES.admin);
      await boss.createQueue(PHOTO_IMPORT_QUEUE);
    })().catch((error) => {
      ready = undefined; // try again on the next capture
      throw error;
    }));
  return {
    async enqueue(queue, id) {
      await start();
      await boss.send(queue, queue === PHOTO_IMPORT_QUEUE ? { importId: id } : { captureId: id });
    },
  };
}
