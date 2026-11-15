import type { ParcelStatus } from "@closyria/shared";
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
 * La Poste's « Suivi » API v2 (developer.laposte.fr, key « Okapi » in `X-Okapi-Key`): Colissimo, Lettre suivie and
 * Chronopost. `GET /suivi/v2/idships/{number}?lang=fr_FR` answers the parcel (`shipment`) with its steps (`event`,
 * most recent first, each a code, a label and a date), `isFinal` once delivered, and `deliveryDate` / `estimDate`
 * when known. An unknown number answers 404 (an invalid one 400), with a `returnCode` and no `shipment`.
 */

export const LA_POSTE_TRACKING_URL = "https://api.laposte.fr/suivi/v2/idships";
const NAME = "laposte";

const nullableString = z.string().nullish();

const eventSchema = z.object({ code: z.string(), label: nullableString, date: nullableString });

const answerSchema = z.object({
  returnCode: z.number().int().optional(),
  shipment: z.object({
    idShip: z.string().optional(),
    isFinal: z.boolean().optional(),
    deliveryDate: nullableString,
    estimDate: nullableString,
    event: z.array(eventSchema).default([]),
  }),
});

/**
 * A step's code (La Poste's documented codes): DR1 announced by the sender; PC (taken in), ET (on its way), EP1
 * (waiting to be presented), DO (customs): on its way; MD2 out for delivery; AG1 waiting at a counter or pickup point;
 * DI1 delivered; DI2 delivered back to the sender, RE1 sent back, ND1 not deliverable, PB problem: exception. Any
 * other code reads as on its way.
 */
export function laPosteStatus(code: string): ParcelStatus {
  const c = code.trim().toUpperCase();
  if (c === "DR1") return "pending";
  if (c === "MD2") return "out_for_delivery";
  if (c === "AG1") return "pickup_ready";
  if (c === "DI1") return "delivered";
  if (c === "DI2" || c === "RE1" || c === "ND1" || c.startsWith("PB")) return "exception";
  return "in_transit";
}

export function laPosteConnector(options: { apiKey: string; fetch: FetchLike }): TrackingConnector {
  return {
    name: NAME,
    async track(parcel: TrackedParcel): Promise<TrackingResult> {
      const url = `${LA_POSTE_TRACKING_URL}/${encodeURIComponent(parcel.trackingNumber)}?lang=fr_FR`;
      const response = await fetchWithTimeout(NAME, options.fetch, url, {
        method: "GET",
        headers: { Accept: "application/json", "X-Okapi-Key": options.apiKey },
      });
      if (response.status === 404 || response.status === 400) {
        await response.body?.cancel();
        return { kind: "not_found" };
      }
      // 207: a partial answer (some of the parcel's data missing), read like a 200.
      if (response.status !== 200 && response.status !== 207) {
        await response.body?.cancel();
        throw new TrackingError(NAME, `HTTP ${response.status}`);
      }
      const { shipment } = await readJson(NAME, response, answerSchema);

      const events: TrackingEvent[] = [];
      for (const event of shipment.event) {
        const at = parseCarrierDate(event.date);
        const label = eventLabel(event.label);
        if (at && label) events.push({ at, status: laPosteStatus(event.code), label });
      }
      const latest = shipment.event[0];
      let status: ParcelStatus = latest ? laPosteStatus(latest.code) : "pending";
      if (shipment.isFinal === true && status !== "exception") status = "delivered";
      const deliveredAt =
        status === "delivered"
          ? (parseCarrierDate(shipment.deliveryDate) ?? events.find((e) => e.status === "delivered")?.at ?? null)
          : null;
      return {
        kind: "found",
        status,
        events,
        estimatedAt: status === "delivered" ? null : parseCarrierDate(shipment.estimDate),
        deliveredAt,
      };
    },
  };
}
