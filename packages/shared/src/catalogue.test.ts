import { describe, expect, it } from "vitest";
import {
  catalogDetailSchema,
  catalogQuerySchema,
  isHttpUrl,
  reportInputSchema,
  SIZE_SUGGESTIONS,
  sizeKindOf,
  sizeKindsByCategory,
  sizeMatches,
} from "./catalogue";
import { profileSizesSchema } from "./wardrobe";

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

describe("SIZE_SUGGESTIONS", () => {
  it("offers the letters and 32 to 48 for tops, 24 to 48 for bottoms, 35 to 42 for shoes", () => {
    expect(SIZE_SUGGESTIONS.top).toEqual([
      "XS",
      "S",
      "M",
      "L",
      "XL",
      "XXL",
      "32",
      "34",
      "36",
      "38",
      "40",
      "42",
      "44",
      "46",
      "48",
    ]);
    expect(SIZE_SUGGESTIONS.bottom.slice(0, 11)).toEqual([
      "24",
      "25",
      "26",
      "27",
      "28",
      "29",
      "30",
      "31",
      "32",
      "33",
      "34",
    ]);
    expect(SIZE_SUGGESTIONS.bottom.slice(11)).toEqual(["36", "38", "40", "42", "44", "46", "48"]);
    expect(SIZE_SUGGESTIONS.shoes).toEqual(["35", "36", "37", "38", "39", "40", "41", "42"]);
  });
  it("only holds sizes the profile accepts in their own field, without duplicates", () => {
    const fields = { top: "sizeTop", bottom: "sizeBottom", shoes: "sizeShoes" } as const;
    for (const [kind, list] of Object.entries(SIZE_SUGGESTIONS) as [keyof typeof fields, readonly string[]][]) {
      expect(new Set(list).size).toBe(list.length);
      for (const size of list) {
        expect(profileSizesSchema.shape[fields[kind]].safeParse(size).success, `${kind} ${size}`).toBe(true);
      }
    }
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

describe("sizeKindsByCategory", () => {
  const tree = [
    { id: "vetements", parentId: null, slug: "vetements" },
    { id: "bas", parentId: "vetements", slug: "bas" },
    { id: "jupes", parentId: "bas", slug: "jupes" },
    { id: "jupe-crayon", parentId: "jupes", slug: "jupe-crayon" },
    { id: "pyjamas", parentId: "vetements", slug: "pyjamas" },
    { id: "chaussures", parentId: null, slug: "chaussures" },
    { id: "mules", parentId: "chaussures", slug: "mules" },
    { id: "accessoires", parentId: null, slug: "accessoires" },
    { id: "ceintures", parentId: "accessoires", slug: "ceintures" },
    { id: "loop-a", parentId: "loop-b", slug: "loop-a" },
    { id: "loop-b", parentId: "loop-a", slug: "loop-b" },
  ];

  it("gives a sub-category its nearest ancestor's kind", () => {
    const kinds = sizeKindsByCategory(tree);
    expect(kinds.get("jupes")).toBe("bottom");
    expect(kinds.get("jupe-crayon")).toBe("bottom");
    expect(kinds.get("pyjamas")).toBe("top");
    expect(kinds.get("mules")).toBe("shoes");
  });

  it("gives none to accessories, their children, or a broken (cyclic) branch", () => {
    const kinds = sizeKindsByCategory(tree);
    expect(kinds.has("accessoires")).toBe(false);
    expect(kinds.has("ceintures")).toBe(false);
    expect(kinds.has("loop-a")).toBe(false);
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) addresses only", () => {
    expect(isHttpUrl("https://shop.test/p/1")).toBe(true);
    expect(isHttpUrl("http://shop.test/")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("data:text/html,x")).toBe(false);
    expect(isHttpUrl("/relative")).toBe(false);
  });

  it("is required of a sheet's shop address", () => {
    expect(catalogDetailSchema.shape.url.safeParse("https://shop.test/p/1").success).toBe(true);
    expect(catalogDetailSchema.shape.url.safeParse("javascript:alert(1)").success).toBe(false);
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
