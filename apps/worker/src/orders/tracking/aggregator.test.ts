import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGGREGATOR_BASE_URL, aggregatorConnector, aggregatorStatus } from "./aggregator";
import { TrackingError } from "./index";

/** Answers written from 17TRACK's API v2.2 documentation (api.17track.net/en/doc): invented parcels. */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");

function fakeFetch(answers: { status: number; body: string }[]) {
  const calls: { url: string; init: RequestInit; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

const parcel = { carrier: "mondial_relay" as const, trackingNumber: "12345678" };
const noWait = async () => {};

describe("aggregator connector (17TRACK)", () => {
  it("asks for the parcel with the key in its header and the carrier's code", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: fixture("aggregator-delivered") }]);
    await aggregatorConnector({ apiKey: "secret-17", fetch, wait: noWait }).track(parcel);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${AGGREGATOR_BASE_URL}/gettrackinfo`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("17token")).toBe("secret-17");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
    expect(calls[0]?.body).toEqual([{ number: "12345678", carrier: 100304 }]);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads a delivered parcel: status, dated steps only, delivery date", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: fixture("aggregator-delivered") }]);
    const result = await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.status).toBe("delivered");
    expect(result.deliveredAt?.toISOString()).toBe("2026-11-13T14:20:00.000Z");
    expect(result.estimatedAt).toBeNull();
    expect(result.events).toEqual([
      { at: new Date("2026-11-13T14:20:00Z"), status: "delivered", label: "Colis livré au destinataire" },
      { at: new Date("2026-11-12T08:00:00Z"), status: "pickup_ready", label: "Colis disponible en Point Relais" },
      // No stage: the step reads as on its way.
      { at: new Date("2026-11-11T01:00:00Z"), status: "in_transit", label: "Colis en cours d'acheminement" },
    ]);
  });

  it("a number it does not follow yet is registered first, then read at the next check", async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: fixture("aggregator-not-registered") },
      { status: 200, body: fixture("aggregator-register") },
    ]);
    const result = await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel);
    expect(result).toEqual({ kind: "waiting" });
    expect(calls.map((c) => c.url)).toEqual([`${AGGREGATOR_BASE_URL}/gettrackinfo`, `${AGGREGATOR_BASE_URL}/register`]);
    expect(calls[1]?.body).toEqual([{ number: "12345678", carrier: 100304 }]);
  });

  it("a number registered meanwhile (already registered) is waiting too", async () => {
    const { fetch } = fakeFetch([
      { status: 200, body: fixture("aggregator-not-registered") },
      {
        status: 200,
        body: JSON.stringify({
          code: 0,
          data: {
            accepted: [],
            rejected: [{ number: "12345678", error: { code: -18019901, message: "already registered" } }],
          },
        }),
      },
    ]);
    expect(await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel)).toEqual({ kind: "waiting" });
  });

  it("a number the registration refuses (bad format) is not found", async () => {
    const { fetch } = fakeFetch([
      { status: 200, body: fixture("aggregator-not-registered") },
      {
        status: 200,
        body: JSON.stringify({
          code: 0,
          data: {
            accepted: [],
            rejected: [
              { number: "12345678", error: { code: -18010012, message: "The format of '12345678' is invalid." } },
            ],
          },
        }),
      },
    ]);
    expect(await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel)).toEqual({
      kind: "not_found",
    });
  });

  it("NotFound from the carrier is not found", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: fixture("aggregator-not-found") }]);
    expect(await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel)).toEqual({
      kind: "not_found",
    });
  });

  it("reads the estimated date and out-for-delivery", async () => {
    const body = JSON.parse(fixture("aggregator-delivered"));
    const info = body.data.accepted[0].track_info;
    info.latest_status = { status: "OutForDelivery", sub_status: "OutForDelivery_Other" };
    info.time_metrics.estimated_delivery_date = { source: "17TRACK", from: "2026-11-14T08:00:00+01:00", to: null };
    const { fetch } = fakeFetch([{ status: 200, body: JSON.stringify(body) }]);
    const result = await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track(parcel);
    expect(result).toMatchObject({ kind: "found", status: "out_for_delivery", deliveredAt: null });
    if (result.kind === "found") expect(result.estimatedAt?.toISOString()).toBe("2026-11-14T07:00:00.000Z");
  });

  it("leaves the carrier to 17TRACK for DHL (several services share the name)", async () => {
    const body = fixture("aggregator-delivered").replaceAll('"12345678"', '"JJD000000000000000001"');
    const { fetch, calls } = fakeFetch([{ status: 200, body }]);
    await aggregatorConnector({ apiKey: "k", fetch, wait: noWait }).track({
      carrier: "dhl",
      trackingNumber: "JJD000000000000000001",
    });
    expect(calls[0]?.body).toEqual([{ number: "JJD000000000000000001" }]);
  });

  it("waits between two requests (3 per second at most)", async () => {
    const waits: number[] = [];
    let clock = 0;
    const { fetch } = fakeFetch([
      { status: 200, body: fixture("aggregator-delivered") },
      { status: 200, body: fixture("aggregator-delivered") },
    ]);
    const connector = aggregatorConnector({
      apiKey: "k",
      fetch,
      now: () => clock,
      wait: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await connector.track(parcel);
    await connector.track(parcel);
    expect(waits).toEqual([400]);
  });

  it("an error answer, a busy service or an unreadable answer is a failure without the key in it", async () => {
    for (const answer of [
      { status: 401, body: '{"code":-18010002,"data":{"errors":[{"code":-18010002,"message":"Invalid token"}]}}' },
      { status: 429, body: "{}" },
      { status: 200, body: '{"code":-18010002,"data":{"errors":[]}}' },
      { status: 200, body: '{"code":0,"data":{"accepted":[{"number":"12345678","track_info":"x"}],"rejected":[]}}' },
      { status: 200, body: '{"code":0,"data":{"accepted":[],"rejected":[]}}' },
      { status: 500, body: "oops" },
    ]) {
      const { fetch } = fakeFetch([answer]);
      const error = await aggregatorConnector({ apiKey: "secret-17", fetch, wait: noWait })
        .track(parcel)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TrackingError);
      expect(String((error as Error).message)).not.toContain("secret-17");
    }
  });

  it("maps 17TRACK's statuses to a parcel status", () => {
    expect(aggregatorStatus("InfoReceived")).toBe("pending");
    expect(aggregatorStatus("InTransit")).toBe("in_transit");
    expect(aggregatorStatus("OutForDelivery")).toBe("out_for_delivery");
    expect(aggregatorStatus("AvailableForPickup")).toBe("pickup_ready");
    expect(aggregatorStatus("Delivered")).toBe("delivered");
    expect(aggregatorStatus("DeliveryFailure")).toBe("exception");
    expect(aggregatorStatus("Exception")).toBe("exception");
    expect(aggregatorStatus("Expired")).toBe("unknown");
    expect(aggregatorStatus("Something new")).toBe("in_transit");
  });
});
