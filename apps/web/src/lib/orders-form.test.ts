import { describe, expect, it } from "vitest";
import {
  checkLines,
  checkOrderEdit,
  emptyLine,
  isTrackingInput,
  lineDraftOf,
  lineHref,
  orderEditDraftOf,
  parisDay,
  trackableItem,
} from "./orders-form";

const id = "00000000-0000-4000-8000-000000000001";

describe("isTrackingInput", () => {
  it("takes a number with spaces or dashes, 6 to 40 letters and digits", () => {
    expect(isTrackingInput("6a 1234 5678 902")).toBe(true);
    expect(isTrackingInput("12-34-56")).toBe(true);
    expect(isTrackingInput("12345")).toBe(false);
    expect(isTrackingInput("6A1234/5678")).toBe(false);
    expect(isTrackingInput("1".repeat(41))).toBe(false);
  });
});

describe("checkLines", () => {
  it("reads names, sizes, quantities and euros", () => {
    const result = checkLines(
      [
        { name: " Robe Lina ", sizeLabel: "M", color: "", quantity: "2", price: "89,90" },
        { ...emptyLine(), name: "Ceinture", quantity: "abc" },
      ],
      ["GBP"],
    );
    expect(result).toEqual({
      ok: true,
      lines: [
        { name: "Robe Lina", sizeLabel: "M", color: null, quantity: 2, priceCents: 8990, currency: "GBP" },
        { name: "Ceinture", sizeLabel: null, color: null, quantity: 1, priceCents: null, currency: null },
      ],
    });
  });

  it("refuses a line without a name, or a price that is not one", () => {
    expect(checkLines([{ ...emptyLine(), name: "  " }])).toEqual({ ok: false, error: "name", index: 0 });
    expect(
      checkLines([
        { ...emptyLine(), name: "Robe" },
        { ...emptyLine(), name: "Jupe", price: "douze" },
      ]),
    ).toEqual({
      ok: false,
      error: "price",
      index: 1,
    });
  });

  it("puts a line back into the form", () => {
    expect(
      lineDraftOf({
        id,
        itemId: null,
        productId: null,
        name: "Robe",
        sizeLabel: null,
        color: "Rouge",
        quantity: 1,
        priceCents: 8900,
        currency: "EUR",
        itemStage: null,
      }),
    ).toEqual({ name: "Robe", sizeLabel: "", color: "Rouge", quantity: "1", price: "89,00" });
  });
});

describe("lineHref", () => {
  it("leads to the product's sheet, else the article's own sheet, else nowhere", () => {
    expect(lineHref({ productId: id, itemId: id })).toBe(`/produits/${id}`);
    expect(lineHref({ productId: null, itemId: id })).toBe(`/articles/${id}`);
    expect(lineHref({ productId: null, itemId: null })).toBeNull();
  });
});

describe("trackableItem", () => {
  it("offers « Ajouter un numéro de suivi » through an article still « Commandé », never once received", () => {
    const other = "00000000-0000-4000-8000-000000000002";
    expect(
      trackableItem({
        lines: [
          { itemId: null, itemStage: null },
          { itemId: id, itemStage: "owned" },
          { itemId: other, itemStage: "ordered" },
        ],
      }),
    ).toBe(other);
    expect(trackableItem({ lines: [{ itemId: id, itemStage: "owned" }] })).toBeNull();
    expect(trackableItem({ lines: [] })).toBeNull();
  });
});

describe("« Modifier » a validated order", () => {
  const NOW = new Date("2026-11-15T09:00:00Z");
  const order = { shopName: "Maison Lune", externalRef: "1042", orderedAt: "2026-11-09T23:30:00.000Z" };

  it("reads a Paris day (the order of 23:30 UTC was on the 10th in Paris)", () => {
    expect(parisDay("2026-11-09T23:30:00.000Z")).toBe("2026-11-10");
    expect(orderEditDraftOf(order)).toEqual({ shopName: "Maison Lune", externalRef: "1042", orderedOn: "2026-11-10" });
    expect(orderEditDraftOf({ shopName: null, externalRef: null, orderedAt: null })).toEqual({
      shopName: "",
      externalRef: "",
      orderedOn: "",
    });
  });

  it("sends only what changed: a new name, a cleared number, a new day (noon in Paris)", () => {
    expect(checkOrderEdit(order, orderEditDraftOf(order), NOW)).toEqual({ ok: true, patch: {} });
    expect(
      checkOrderEdit(order, { shopName: " Lune  Paris ", externalRef: " ", orderedOn: "2026-11-12" }, NOW),
    ).toEqual({
      ok: true,
      patch: { shopName: "Lune Paris", externalRef: null, orderedAt: "2026-11-12T11:00:00.000Z" },
    });
    expect(checkOrderEdit(order, { shopName: "Maison Lune", externalRef: "1042", orderedOn: "" }, NOW)).toEqual({
      ok: true,
      patch: { orderedAt: null },
    });
  });

  it("refuses an emptied shop name, a day to come and a number the shops never write", () => {
    expect(checkOrderEdit(order, { ...orderEditDraftOf(order), shopName: "  " }, NOW)).toEqual({
      ok: false,
      error: "shop",
    });
    // No name before, none now: nothing to send.
    expect(checkOrderEdit({ ...order, shopName: null }, { ...orderEditDraftOf(order), shopName: "" }, NOW)).toEqual({
      ok: true,
      patch: {},
    });
    expect(checkOrderEdit(order, { ...orderEditDraftOf(order), orderedOn: "2026-11-16" }, NOW)).toEqual({
      ok: false,
      error: "date",
    });
    expect(checkOrderEdit(order, { ...orderEditDraftOf(order), orderedOn: "2026-11-15" }, NOW)).toMatchObject({
      ok: true,
    });
    expect(checkOrderEdit(order, { ...orderEditDraftOf(order), externalRef: "x".repeat(65) }, NOW)).toEqual({
      ok: false,
      error: "ref",
    });
  });
});
