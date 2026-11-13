import { describe, expect, it } from "vitest";
import { catalogQuerySchema, profileSizesSchema, reportInputSchema, sizeKindOf, sizeMatches } from "./catalogue";

describe("sizeMatches", () => {
  it("ignores case and spaces", () => {
    expect(sizeMatches("m", ["S", "M"])).toBe(true);
    expect(sizeMatches(" 38 ", ["36", "38"])).toBe(true);
  });
  it("is false when the size is not there, null without a profile size", () => {
    expect(sizeMatches("38", ["36"])).toBe(false);
    expect(sizeMatches(null, ["36"])).toBeNull();
  });
});

describe("sizeKindOf", () => {
  it("maps categories by family", () => {
    expect(sizeKindOf("robe-longue")).toBe("top");
    expect(sizeKindOf("pulls-gilets")).toBe("top");
    expect(sizeKindOf("jeans")).toBe("bottom");
    expect(sizeKindOf("baskets")).toBe("shoes");
    expect(sizeKindOf("bijoux")).toBeNull();
    expect(sizeKindOf("sacs")).toBeNull();
    expect(sizeKindOf(null)).toBeNull();
  });
});

describe("schemas", () => {
  it("parses a query string", () => {
    const q = catalogQuerySchema.parse({ mySize: "true", values: "made_in_france,second_hand", priceMax: "5000" });
    expect(q).toMatchObject({ mySize: true, values: ["made_in_france", "second_hand"], priceMax: 5000, sort: "new" });
    expect(catalogQuerySchema.safeParse({ sort: "x" }).success).toBe(false);
  });
  it("limits reasons and sizes", () => {
    expect(reportInputSchema.safeParse({ reason: "shocking" }).success).toBe(true);
    expect(reportInputSchema.safeParse({ reason: "x" }).success).toBe(false);
    expect(profileSizesSchema.safeParse({ sizeTop: "12345678901", sizeBottom: null, sizeShoes: null }).success).toBe(
      false,
    );
  });
});
