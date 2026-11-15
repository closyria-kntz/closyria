import { describe, expect, it } from "vitest";
import { bareItemHref, carrierSchema, carrierTrackingUrl, orderHref } from "./orders";

describe("carrierTrackingUrl (« Suivre chez le transporteur »)", () => {
  it("opens the carrier's own tracking page, the number encoded", () => {
    expect(carrierTrackingUrl("colissimo", "6A12345678902")).toBe(
      "https://www.laposte.fr/outils/suivre-vos-envois?code=6A12345678902",
    );
    expect(carrierTrackingUrl("mondial_relay", "12345678")).toBe(
      "https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=12345678",
    );
    expect(carrierTrackingUrl("dpd", "A B")).toBe("https://trace.dpd.fr/fr/trace/A%20B");
  });

  it("has a page for every carrier, and a search on every carrier when unknown", () => {
    for (const carrier of carrierSchema.options) expect(carrierTrackingUrl(carrier, "X1")).toMatch(/^https:\/\//);
    expect(carrierTrackingUrl(null, "12345678")).toBe("https://t.17track.net/fr#nums=12345678");
  });
});

describe("addresses of the screens", () => {
  it("leads to an order on « Mes commandes » and to an article's own sheet", () => {
    expect(orderHref("o1")).toBe("/mes-commandes#commande-o1");
    expect(bareItemHref("i1")).toBe("/articles/i1");
  });
});
