import { describe, expect, it } from "vitest";
import { connectorFor, type TrackingConnector } from "./index";

const fake = (name: string) => ({ name, track: async () => ({ kind: "waiting" as const }) }) as TrackingConnector;
const laPoste = fake("laposte");
const aggregator = fake("aggregator");

describe("connectorFor", () => {
  it("La Poste's carriers go to La Poste when its key is set", () => {
    expect(connectorFor("colissimo", { laPoste, aggregator })).toBe(laPoste);
    expect(connectorFor("chronopost", { laPoste, aggregator })).toBe(laPoste);
  });

  it("without La Poste's key, its carriers go to the aggregator", () => {
    for (const carrier of ["colissimo", "lettre_suivie", "chronopost"] as const) {
      expect(connectorFor(carrier, { laPoste: null, aggregator })).toBe(aggregator);
    }
  });

  it("the others go to the aggregator; nothing without a carrier or without keys", () => {
    expect(connectorFor("mondial_relay", { laPoste, aggregator })).toBe(aggregator);
    expect(connectorFor(null, { laPoste, aggregator })).toBeNull();
    expect(connectorFor("colissimo", { laPoste: null, aggregator: null })).toBeNull();
  });
});
