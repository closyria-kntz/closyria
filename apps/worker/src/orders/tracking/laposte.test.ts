import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TrackingError } from "./index";
import { LA_POSTE_TRACKING_URL, laPosteConnector, laPosteStatus } from "./laposte";

/** Answers written from La Poste's « Suivi » v2 documentation (developer.laposte.fr): invented parcels. */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");

function fakeFetch(answers: { status: number; body: string }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

const parcel = { carrier: "colissimo" as const, trackingNumber: "6A12345678901" };

describe("La Poste connector", () => {
  it("asks « Suivi » v2 with the key in its header, in French, with a timeout", async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: fixture("laposte-delivered") }]);
    await laPosteConnector({ apiKey: "secret-okapi", fetch }).track(parcel);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${LA_POSTE_TRACKING_URL}/6A12345678901?lang=fr_FR`);
    expect(calls[0]?.url).not.toContain("secret-okapi");
    expect(calls[0]?.init.method).toBe("GET");
    expect(new Headers(calls[0]?.init.headers).get("X-Okapi-Key")).toBe("secret-okapi");
    expect(new Headers(calls[0]?.init.headers).get("Accept")).toBe("application/json");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads a delivered parcel: status, steps, delivery date", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: fixture("laposte-delivered") }]);
    const result = await laPosteConnector({ apiKey: "k", fetch }).track(parcel);
    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.status).toBe("delivered");
    expect(result.deliveredAt?.toISOString()).toBe("2026-11-13T10:42:00.000Z");
    expect(result.events.map((e) => e.status)).toEqual([
      "delivered",
      "out_for_delivery",
      "in_transit",
      "in_transit",
      "pending",
    ]);
    expect(result.events[0]?.label).toBe("Votre colis est livré dans votre boîte aux lettres.");
  });

  it("reads a parcel waiting at a pickup point, with its estimated date", async () => {
    const { fetch } = fakeFetch([{ status: 200, body: fixture("laposte-pickup") }]);
    const result = await laPosteConnector({ apiKey: "k", fetch }).track(parcel);
    expect(result).toMatchObject({ kind: "found", status: "pickup_ready", deliveredAt: null });
    if (result.kind === "found") expect(result.estimatedAt?.toISOString()).toBe("2026-11-12T23:00:00.000Z");
  });

  it("an unknown number (404) or a refused one (400) is not found, not a failure", async () => {
    for (const status of [404, 400]) {
      const { fetch } = fakeFetch([{ status, body: fixture("laposte-not-found") }]);
      expect(await laPosteConnector({ apiKey: "k", fetch }).track(parcel)).toEqual({ kind: "not_found" });
    }
  });

  it("a refused key, a busy service or an unreadable answer is a failure without the key in it", async () => {
    for (const answer of [
      { status: 401, body: '{"code":"UNAUTHORIZED","message":"Invalid key"}' },
      { status: 429, body: "{}" },
      { status: 503, body: "<html>busy</html>" },
      { status: 200, body: '{"returnCode":200,"shipment":{"event":"not a list"}}' },
      { status: 200, body: "not json" },
    ]) {
      const { fetch } = fakeFetch([answer]);
      const error = await laPosteConnector({ apiKey: "secret-okapi", fetch })
        .track(parcel)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TrackingError);
      expect(String((error as Error).message)).not.toContain("secret-okapi");
    }
  });

  it("a network failure or a timeout is a failure", async () => {
    const fetch = async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    };
    await expect(laPosteConnector({ apiKey: "k", fetch }).track(parcel)).rejects.toThrow(/no answer \(TimeoutError\)/);
  });

  it("maps La Poste's event codes to a parcel status", () => {
    expect(laPosteStatus("DR1")).toBe("pending");
    expect(laPosteStatus("PC1")).toBe("in_transit");
    expect(laPosteStatus("ET3")).toBe("in_transit");
    expect(laPosteStatus("MD2")).toBe("out_for_delivery");
    expect(laPosteStatus("AG1")).toBe("pickup_ready");
    expect(laPosteStatus("DI1")).toBe("delivered");
    expect(laPosteStatus("DI2")).toBe("exception");
    expect(laPosteStatus("RE1")).toBe("exception");
    expect(laPosteStatus("ND1")).toBe("exception");
    expect(laPosteStatus("XX9")).toBe("in_transit");
  });
});
