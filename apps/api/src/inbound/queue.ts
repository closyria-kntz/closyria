import { ORDER_EMAIL_PARSE_QUEUE, type OrderEmailParseJob } from "@closyria/shared";
import type { OrderEmailQueue } from "./receive";

/**
 * Sending-only, like `pgBossQueue`: started on the first e-mail; the queue is created here too (`createQueue` does
 * nothing when it exists), so an e-mail received before the worker ever ran still waits for it.
 */
export function pgBossOrderEmailQueue(boss: {
  start(): Promise<unknown>;
  createQueue(name: string): Promise<unknown>;
  send(name: string, data: object): Promise<unknown>;
}): OrderEmailQueue {
  let ready: Promise<void> | undefined;
  const start = () =>
    (ready ??= (async () => {
      await boss.start();
      await boss.createQueue(ORDER_EMAIL_PARSE_QUEUE);
    })().catch((error) => {
      ready = undefined; // try again on the next e-mail
      throw error;
    }));
  return {
    async parse(inboundEmailId) {
      await start();
      const job: OrderEmailParseJob = { inboundEmailId };
      await boss.send(ORDER_EMAIL_PARSE_QUEUE, job);
    },
  };
}
