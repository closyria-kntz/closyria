import { CAPTURE_QUEUES } from "@closyria/shared";

export type CaptureQueueName = typeof CAPTURE_QUEUES.user | typeof CAPTURE_QUEUES.admin;

/** Where the API hands a capture to the worker. Tests inject a recording fake. */
export type CaptureQueue = {
  enqueue(queue: CaptureQueueName, captureId: string): Promise<void>;
};

/**
 * Sending-only pg-boss queue: the instance is started without supervision, maintenance or scheduling
 * (those belong to the worker), on the first job. `send` fails when the queue does not exist, and the
 * worker creates the queues, so both are created here too (`createQueue` does nothing when it exists):
 * a capture asked for before the worker has ever run still waits for it.
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
    })().catch((error) => {
      ready = undefined; // try again on the next capture
      throw error;
    }));
  return {
    async enqueue(queue, captureId) {
      await start();
      await boss.send(queue, { captureId });
    },
  };
}
