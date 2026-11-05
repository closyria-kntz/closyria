import { type Database, eq, schema } from "@closyria/db";
import type { CaptureQueue, CaptureQueueName } from "./capture-queue";

/**
 * Hands a capture row to the worker. When the queue is unreachable the row is kept, marked
 * `queue_unavailable`, and the error is rethrown.
 */
export async function enqueueCapture(
  db: Database,
  queue: CaptureQueue,
  name: CaptureQueueName,
  captureId: string,
  now: Date,
): Promise<void> {
  try {
    await queue.enqueue(name, captureId);
  } catch (error) {
    await db
      .update(schema.captures)
      .set({ status: "failed", errorCode: "queue_unavailable", finishedAt: now })
      .where(eq(schema.captures.id, captureId));
    throw error;
  }
}
