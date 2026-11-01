import type { AudienceEvent, DeviceFamily } from "@closyria/shared";
import type { Database } from "./index";
import { events } from "./schema/events";

/** An event as stored: already validated (`eventSchema`), with the server-side facts added. */
export type TrackedEvent = Pick<AudienceEvent, "name" | "path" | "props"> & {
  /** Defaults to now. */
  occurredAt?: Date;
  /** The session's user, or absent for a visitor with no session. */
  userId?: string | null;
  /** Derived from the user agent by the caller; absent for events born on the server. */
  device?: DeviceFamily | null;
};

/**
 * The single place where audience events are inserted: the `POST /api/events` route and server-side tracking
 * (API, worker) both go through it. Takes one event or a batch (one INSERT).
 */
export async function trackServer(db: Database, event: TrackedEvent | TrackedEvent[]): Promise<void> {
  const list = Array.isArray(event) ? event : [event];
  if (list.length === 0) return;
  await db.insert(events).values(
    list.map((e) => ({
      userId: e.userId ?? null,
      name: e.name,
      path: e.path,
      device: e.device ?? null,
      props: e.props ?? null,
      occurredAt: e.occurredAt ?? new Date(),
    })),
  );
}
