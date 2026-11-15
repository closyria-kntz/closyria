import { describe, expect, it } from "vitest";
import { MAX_PARCEL_EVENTS_SHOWN, PARCEL_STEPS, type ParcelStatus, parcelProgress, parcelViewSchema } from "./orders";

const events = (...statuses: ParcelStatus[]) => statuses.map((status) => ({ status }));

describe("parcelProgress (the frise of a parcel's main steps, 2026-11-16)", () => {
  it("has four steps, from « Expédié » to « Livré »", () => {
    expect(PARCEL_STEPS).toEqual(["shipped", "on_the_way", "out_for_delivery", "delivered"]);
  });

  it("maps each step the carrier gives to the frise", () => {
    expect(parcelProgress({ status: "pending", events: events("pending") })).toEqual({
      current: 0,
      pickup: false,
      exception: false,
    });
    expect(parcelProgress({ status: "in_transit", events: events("in_transit", "pending") })).toEqual({
      current: 1,
      pickup: false,
      exception: false,
    });
    expect(parcelProgress({ status: "out_for_delivery", events: [] })).toEqual({
      current: 2,
      pickup: false,
      exception: false,
    });
    expect(parcelProgress({ status: "pickup_ready", events: events("pickup_ready") })).toEqual({
      current: 2,
      pickup: true,
      exception: false,
    });
    expect(parcelProgress({ status: "delivered", events: [] })).toEqual({
      current: 3,
      pickup: false,
      exception: false,
    });
  });

  it("shows no frise while nothing is known yet", () => {
    expect(parcelProgress({ status: "pending", events: [] })).toBeNull();
    expect(parcelProgress({ status: "unknown", events: events("in_transit") })).toBeNull();
    expect(parcelProgress({ status: "exception", events: [] })).toBeNull();
  });

  it("keeps an incident on the last step reached, whatever the order of the events", () => {
    expect(parcelProgress({ status: "exception", events: events("exception", "in_transit", "pending") })).toEqual({
      current: 1,
      pickup: false,
      exception: true,
    });
    // A step back in the carrier's history does not take the frise back.
    expect(
      parcelProgress({ status: "exception", events: events("exception", "in_transit", "out_for_delivery") }),
    ).toEqual({ current: 2, pickup: false, exception: true });
    expect(parcelProgress({ status: "exception", events: events("exception", "pickup_ready") })).toEqual({
      current: 2,
      pickup: true,
      exception: true,
    });
    // Only incidents: the carrier has the parcel, so it is shipped.
    expect(parcelProgress({ status: "exception", events: events("exception", "unknown") })).toEqual({
      current: 0,
      pickup: false,
      exception: true,
    });
  });
});

describe("a parcel's events in its view", () => {
  it("are part of the parcel's view, 50 at most", () => {
    expect(MAX_PARCEL_EVENTS_SHOWN).toBe(50);
    const parcel = {
      id: "00000000-0000-4000-8000-000000000001",
      carrier: "colissimo",
      trackingNumber: "6A12345678902",
      status: "in_transit",
      lastEventAt: "2026-11-15T13:02:00.000Z",
      lastEventLabel: "En cours d'acheminement",
      estimatedAt: null,
      deliveredAt: null,
      events: [{ at: "2026-11-15T13:02:00.000Z", status: "in_transit", label: "En cours d'acheminement" }],
    };
    expect(parcelViewSchema.parse(parcel).events).toHaveLength(1);
    expect(() => parcelViewSchema.parse({ ...parcel, events: undefined })).toThrow();
  });
});
