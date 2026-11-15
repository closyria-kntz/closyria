import type { Carrier, ParcelStatus } from "@closyria/shared";
import { z } from "zod";
import {
  eventLabel,
  type FetchLike,
  fetchWithTimeout,
  parseCarrierDate,
  readJson,
  type TrackedParcel,
  type TrackingConnector,
  TrackingError,
  type TrackingEvent,
  type TrackingResult,
} from "./index";

/**
 * 17TRACK's API v2.2 (api.17track.net/en/doc), the aggregator for the carriers La Poste does not cover (Mondial Relay,
 * GLS, DPD, Colis Privé, UPS, DHL). Key in the `17token` header, JSON arrays posted. A number must be registered
 * (`/register`) before it can be read (`/gettrackinfo`): an unregistered one answers the error -18019902; it is then
 * registered and read at the next check (17TRACK fetches it meanwhile). 3 requests per second at most.
 */

export const AGGREGATOR_BASE_URL = "https://api.17track.net/track/v2.2";
const NAME = "aggregator";
/** Two requests at least this far apart (3 per second at most, with a margin). */
export const AGGREGATOR_MIN_INTERVAL_MS = 400;

const NOT_REGISTERED = -18019902;
const ALREADY_REGISTERED = -18019901;

/**
 * 17TRACK's carrier codes (its published carrier list); none for DHL, whose several services (Express, Paket,
 * eCommerce) 17TRACK tells apart from the number better than we do.
 */
const CARRIER_CODES: Partial<Record<Carrier, number>> = {
  mondial_relay: 100304,
  gls: 100005,
  dpd: 100072,
  colis_prive: 100027,
  ups: 100002,
};

const nullableString = z.string().nullish();

const eventSchema = z.object({
  time_utc: nullableString,
  time_iso: nullableString,
  description: nullableString,
  stage: nullableString,
});

const trackInfoSchema = z.object({
  latest_status: z.object({ status: z.string() }),
  time_metrics: z
    .object({
      estimated_delivery_date: z.object({ from: nullableString, to: nullableString }).nullish(),
    })
    .nullish(),
  milestone: z.array(z.object({ key_stage: z.string(), time_utc: nullableString, time_iso: nullableString })).nullish(),
  tracking: z
    .object({ providers: z.array(z.object({ events: z.array(eventSchema).default([]) })).default([]) })
    .nullish(),
});

const rejectedSchema = z.object({
  number: z.string(),
  error: z.object({ code: z.number().int(), message: nullableString }),
});

const trackAnswerSchema = z.object({
  code: z.literal(0),
  data: z.object({
    accepted: z.array(z.object({ number: z.string(), track_info: trackInfoSchema })).default([]),
    rejected: z.array(rejectedSchema).default([]),
  }),
});

const registerAnswerSchema = z.object({
  code: z.literal(0),
  data: z.object({
    accepted: z.array(z.object({ number: z.string() })).default([]),
    rejected: z.array(rejectedSchema).default([]),
  }),
});

/**
 * 17TRACK's main status: InfoReceived announced; InTransit; OutForDelivery; AvailableForPickup; Delivered;
 * DeliveryFailure and Exception (returned, lost…): exception; Expired (no news for a long time): unknown. Any other
 * value reads as on its way.
 */
export function aggregatorStatus(status: string): ParcelStatus {
  switch (status) {
    case "InfoReceived":
      return "pending";
    case "OutForDelivery":
      return "out_for_delivery";
    case "AvailableForPickup":
      return "pickup_ready";
    case "Delivered":
      return "delivered";
    case "DeliveryFailure":
    case "Exception":
      return "exception";
    case "Expired":
      return "unknown";
    default:
      return "in_transit";
  }
}

type Options = {
  apiKey: string;
  fetch: FetchLike;
  /** For the tests: the clock and the pause between two requests. */
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export function aggregatorConnector(options: Options): TrackingConnector {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastRequestAt = Number.NEGATIVE_INFINITY;

  async function post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const gap = lastRequestAt + AGGREGATOR_MIN_INTERVAL_MS - now();
    if (gap > 0) await wait(gap);
    lastRequestAt = now();
    const response = await fetchWithTimeout(NAME, options.fetch, `${AGGREGATOR_BASE_URL}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "17token": options.apiKey },
      body: JSON.stringify(body),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new TrackingError(NAME, `HTTP ${response.status}`);
    }
    return readJson(NAME, response, schema);
  }

  return {
    name: NAME,
    async track(parcel: TrackedParcel): Promise<TrackingResult> {
      const code = CARRIER_CODES[parcel.carrier];
      const query = [{ number: parcel.trackingNumber, ...(code ? { carrier: code } : {}) }];
      const answer = await post("gettrackinfo", query, trackAnswerSchema);
      const accepted = answer.data.accepted.find((a) => a.number === parcel.trackingNumber);
      if (accepted) return readTrackInfo(accepted.track_info);

      const rejected = answer.data.rejected.find((r) => r.number === parcel.trackingNumber);
      if (rejected?.error.code !== NOT_REGISTERED) throw new TrackingError(NAME, "parcel missing from the answer");
      const registered = await post("register", query, registerAnswerSchema);
      if (registered.data.accepted.some((a) => a.number === parcel.trackingNumber)) return { kind: "waiting" };
      const refused = registered.data.rejected.find((r) => r.number === parcel.trackingNumber);
      if (!refused) throw new TrackingError(NAME, "parcel missing from the registration");
      // Registered meanwhile (another check): read at the next one. Any other refusal (a number it cannot follow).
      return refused.error.code === ALREADY_REGISTERED ? { kind: "waiting" } : { kind: "not_found" };
    },
  };
}

function readTrackInfo(info: z.infer<typeof trackInfoSchema>): TrackingResult {
  if (info.latest_status.status === "NotFound") return { kind: "not_found" };
  const status = aggregatorStatus(info.latest_status.status);
  const events: TrackingEvent[] = [];
  for (const event of info.tracking?.providers.flatMap((p) => p.events) ?? []) {
    const at = parseCarrierDate(event.time_utc ?? event.time_iso);
    const label = eventLabel(event.description);
    if (at && label) events.push({ at, status: event.stage ? aggregatorStatus(event.stage) : "in_transit", label });
  }
  let deliveredAt: Date | null = null;
  if (status === "delivered") {
    const milestone = info.milestone?.find((m) => m.key_stage === "Delivered");
    deliveredAt =
      parseCarrierDate(milestone?.time_utc ?? milestone?.time_iso) ??
      events.find((e) => e.status === "delivered")?.at ??
      null;
  }
  const estimate = info.time_metrics?.estimated_delivery_date;
  return {
    kind: "found",
    status,
    events,
    estimatedAt: status === "delivered" ? null : parseCarrierDate(estimate?.from ?? estimate?.to),
    deliveredAt,
  };
}
