import { PARCEL_STEPS, type ParcelStatus, type ParcelStep, parcelProgress } from "@closyria/shared";

/** A step of the frise as drawn: its words (`Orders.parcel.frise.{key}`) and whether it is passed, current or to come. */
export type FriseStep = { key: ParcelStep | "pickup"; state: "passed" | "current" | "upcoming" };

/**
 * The frise of a parcel (« Expédié », « En route », « En livraison » or « En point relais », « Livré »), or null when
 * there is nothing to draw yet (today's words then).
 */
export function friseOf(parcel: {
  status: ParcelStatus;
  events: readonly { status: ParcelStatus }[];
}): { steps: FriseStep[]; exception: boolean } | null {
  const progress = parcelProgress(parcel);
  if (!progress) return null;
  return {
    steps: PARCEL_STEPS.map((key, i) => ({
      key: key === "out_for_delivery" && progress.pickup ? "pickup" : key,
      state: i < progress.current ? "passed" : i === progress.current ? "current" : "upcoming",
    })),
    exception: progress.exception,
  };
}
