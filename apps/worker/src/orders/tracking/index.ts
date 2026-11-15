import { type Carrier, LA_POSTE_CARRIERS, MAX_PARCEL_EVENT_LABEL, type ParcelStatus } from "@closyria/shared";
import type { z } from "zod";
import { aggregatorConnector } from "./aggregator";
import { laPosteConnector } from "./laposte";

/**
 * Parcel tracking (« Après la commande », Task 5): one connector per tracking service, behind one interface. La Poste's
 * own API (« Okapi ») for its carriers, an aggregator (17TRACK) for the others. Every answer is validated with Zod;
 * the keys never appear in a log or an error.
 */

/** One step the carrier reports (« Pris en charge », « En cours de livraison »…). */
export type TrackingEvent = { at: Date; status: ParcelStatus; label: string };

/**
 * What a check learnt:
 * - `found`: the carrier knows the parcel (its current status, its steps, most recent first or not);
 * - `not_found`: the carrier does not know the number (yet, or never);
 * - `waiting`: asked to follow it (the aggregator registers a number first), nothing to read yet.
 * A failure (network, timeout, HTTP error, unreadable answer) is thrown.
 */
export type TrackingResult =
  | {
      kind: "found";
      status: ParcelStatus;
      events: TrackingEvent[];
      estimatedAt: Date | null;
      deliveredAt: Date | null;
    }
  | { kind: "not_found" }
  | { kind: "waiting" };

export type TrackedParcel = { carrier: Carrier; trackingNumber: string };

export interface TrackingConnector {
  /** For logs only (« laposte », « aggregator »). */
  readonly name: string;
  track(parcel: TrackedParcel): Promise<TrackingResult>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Each request is abandoned after this long (then counted as a failure). */
export const TRACKING_TIMEOUT_MS = 10_000;

/** A failed check: the message never holds a key, a number or a body. */
export class TrackingError extends Error {
  constructor(connector: string, reason: string) {
    super(`${connector}: ${reason}`);
    this.name = "TrackingError";
  }
}

/** Reads a JSON answer and validates it; anything else is a `TrackingError`. */
export async function readJson<T>(connector: string, response: Response, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TrackingError(connector, `unreadable answer (HTTP ${response.status})`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new TrackingError(connector, `unexpected answer (HTTP ${response.status})`);
  return parsed.data;
}

/** `fetch` with the timeout; a network failure or a timeout is a `TrackingError`. */
export async function fetchWithTimeout(
  connector: string,
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs = TRACKING_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = error instanceof Error ? error.name : "error";
    throw new TrackingError(connector, `no answer (${name})`);
  }
}

/** An instant from a carrier's date, null when absent or unreadable. */
export function parseCarrierDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A step's label, trimmed and cut to the column's length; null when empty. */
export function eventLabel(value: string | null | undefined): string | null {
  const label = value?.replace(/\s+/g, " ").trim();
  if (!label) return null;
  return label.length > MAX_PARCEL_EVENT_LABEL ? `${label.slice(0, MAX_PARCEL_EVENT_LABEL - 1)}…` : label;
}

export type TrackingConnectors = { laPoste: TrackingConnector | null; aggregator: TrackingConnector | null };

/** The connectors whose key is set; without a key, that connector is off (its parcels wait, nothing fails). */
export function trackingConnectors(
  keys: { laPosteKey?: string | undefined; aggregatorKey?: string | undefined },
  fetchFn: FetchLike = fetch,
): TrackingConnectors {
  return {
    laPoste: keys.laPosteKey ? laPosteConnector({ apiKey: keys.laPosteKey, fetch: fetchFn }) : null,
    aggregator: keys.aggregatorKey ? aggregatorConnector({ apiKey: keys.aggregatorKey, fetch: fetchFn }) : null,
  };
}

/**
 * La Poste for Colissimo, Lettre suivie and Chronopost when its key is set, else the aggregator (17TRACK follows them
 * too, recognising the number itself); the aggregator for the others; null: no way to follow it.
 */
export function connectorFor(carrier: Carrier | null, connectors: TrackingConnectors): TrackingConnector | null {
  if (!carrier) return null;
  return (LA_POSTE_CARRIERS as readonly Carrier[]).includes(carrier)
    ? (connectors.laPoste ?? connectors.aggregator)
    : connectors.aggregator;
}
