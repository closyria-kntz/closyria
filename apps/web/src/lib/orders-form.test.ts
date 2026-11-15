import { describe, expect, it } from "vitest";
import { checkLines, emptyLine, isTrackingInput, lineDraftOf, lineHref, trackableItem } from "./orders-form";

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
