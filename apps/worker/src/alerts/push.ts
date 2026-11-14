import { type Database, eq, schema } from "@closyria/db";
import { isPushEndpointAllowed, type VapidConfig } from "@closyria/shared";
import { sendNotification } from "web-push";

/** One of her devices, as the push service needs it. */
export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
/** What the service worker shows (`apps/web/public/sw.js`): `url` opens on a tap. */
export type PushMessage = { title: string; body: string; url: string };
/**
 * `ok` accepted; `gone` the browser removed the subscription (404/410: delete it, never retry); `retry` the service is
 * busy or unreachable (429, 5xx, network: pg-boss tries again); `failed` refused for good (other 4xx).
 */
export type PushOutcome = "ok" | "gone" | "retry" | "failed";
/**
 * `topic`: the push service keeps only the latest message with the same topic for an offline device, so a send repeated
 * after a crash replaces the first one instead of showing twice.
 */
export type PushOptions = { topic: string };
/** Sends one notification; injected, so tests never reach the network. */
export type PushSender = (target: PushTarget, message: PushMessage, options: PushOptions) => Promise<PushOutcome>;

/** Thrown to have pg-boss try the job again (its retry limit decides when to stop). */
export class PushRetryError extends Error {
  constructor() {
    super("push service busy, retrying");
    this.name = "PushRetryError";
  }
}

/** A notification older than this is dropped by the push service (a phone off for the night still gets it). */
const PUSH_TTL_SECONDS = 12 * 60 * 60;
/** A push service that does not answer within this is « busy » (a socket timeout has no status: `retry`). */
export const PUSH_TIMEOUT_MS = 10_000;

export function outcomeOfStatus(status: number | undefined): PushOutcome {
  if (status === undefined) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "failed";
}

/** `web-push`'s `sendNotification`, injectable for the tests. */
export type SendNotification = (
  target: PushTarget,
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    timeout: number;
    topic: string;
  },
) => Promise<{ statusCode: number }>;

/**
 * The real sender (`web-push`, VAPID). Logs the error message only: never an endpoint or a key. Redirects are never
 * followed: web-push 4 sends with a bare `node:https` request (no proxy, no agent given here), and a 3xx is a non-2xx
 * answer, so `failed`.
 */
export function webPushSender(vapid: VapidConfig, send: SendNotification = sendNotification): PushSender {
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return async (target, message, { topic }) => {
    try {
      const result = await send(target, JSON.stringify(message), {
        vapidDetails,
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_TIMEOUT_MS,
        topic,
      });
      return outcomeOfStatus(result.statusCode);
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
          ? error.statusCode
          : undefined;
      const outcome = outcomeOfStatus(status);
      if (outcome !== "gone") {
        console.warn(`push: ${status ?? "network"} ${error instanceof Error ? error.message : "unknown error"}`);
      }
      return outcome;
    }
  };
}

/**
 * Sends one message to each of her devices: one `alert_sends` row per attempt, `last_ok_at` on success, a device the
 * browser removed (404/410) deleted. A device whose endpoint is not a known push service (`isPushEndpointAllowed`) is
 * deleted without a send. `delivered`: devices that accepted it; `retry`: a device asked to try again;
 * `devices`: how many she had.
 */
export async function deliver(
  db: Database,
  push: PushSender,
  userId: string,
  message: PushMessage,
  options: PushOptions,
  at: Date,
): Promise<{ delivered: number; retry: boolean; devices: number }> {
  const subscriptions = await db
    .select({
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
    })
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId))
    .orderBy(schema.pushSubscriptions.createdAt, schema.pushSubscriptions.id);
  let delivered = 0;
  let retry = false;
  for (const sub of subscriptions) {
    // Checked again before every send: a row written before the check, or not by the API, is never POSTed to.
    if (!isPushEndpointAllowed(sub.endpoint)) {
      console.warn("push: subscription with an unknown push service removed");
      await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
      continue;
    }
    const outcome = await push(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      message,
      options,
    );
    await db.insert(schema.alertSends).values({ userId, sentAt: at, ok: outcome === "ok" });
    if (outcome === "ok") {
      delivered += 1;
      await db.update(schema.pushSubscriptions).set({ lastOkAt: at }).where(eq(schema.pushSubscriptions.id, sub.id));
    } else if (outcome === "gone") {
      await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id));
    } else if (outcome === "retry") {
      retry = true;
    }
  }
  return { delivered, retry, devices: subscriptions.length };
}
