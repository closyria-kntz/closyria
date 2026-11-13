import { describe, expect, it } from "vitest";
import {
  CATALOGUE_IMPORT_DEAD_MS,
  CATALOGUE_IMPORT_HEARTBEAT_MS,
  CATALOGUE_IMPORT_PLATFORMS,
  canImportCatalogue,
  catalogDetailSchema,
  catalogQuerySchema,
  isHttpUrl,
  isOneSize,
  liveImportState,
  reportInputSchema,
  SIZE_SUGGESTIONS,
  sizeKindOf,
  sizeKindsByCategory,
  sizeMatches,
  sizeTokens,
  sizeTokensOf,
} from "./catalogue";
import { profileSizesSchema } from "./wardrobe";

describe("sizeTokens", () => {
  const finds = (label: string, ...sizes: string[]) =>
    it(`« ${label} » names ${sizes.join(" and ")}`, () => {
      for (const size of sizes) expect(sizeMatches([size], [label]), size).toBe(true);
    });
  finds("38 FR", "38");
  finds("FR 38", "38");
  finds("EU 38", "38");
  finds("T38", "38");
  finds("Taille 38", "38");
  finds("S/M", "S", "M");
  finds("M - 38", "M", "38");
  finds("M (38)", "M", "38");
  finds("36-38", "36", "38");
  finds("36/38", "36", "38");
  finds("2XL", "XXL", "2XL");
  finds("XXL", "2XL");
  finds("3XL", "XXXL");
  finds("XXXL", "3XL");
  finds("38,5", "38.5", "38,5", "38 1/2");
  finds("38.5", "38,5");
  finds("38 1/2", "38,5");
  finds("W28", "W28", "w 28");
  finds("W28 L32", "W28");
  finds(" m ", "M");
  finds("x l", "XL");
  finds("EU38", "38");
  finds("FR38", "38");
  finds("T.38", "38");
  finds("W28L32", "W28");
  finds("W28 L 32", "W28");
  finds("W 28 L 32", "W28");
  finds("1XL", "XL");
  finds("XL", "1XL");

  it("keeps sizes apart that only look alike", () => {
    expect(sizeMatches(["S"], ["XS", "XXS"])).toBe(false);
    expect(sizeMatches(["L"], ["XL", "2XL"])).toBe(false);
    expect(sizeMatches(["38"], ["38,5", "380", "T36"])).toBe(false);
    expect(sizeMatches(["38,5"], ["38"])).toBe(false);
    expect(sizeMatches(["W28"], ["28", "W29 L28"])).toBe(false);
    expect(sizeMatches(["M"], ["Taille unique"])).toBe(false);
    // The leg length of « W28 L 32 » is not a size 32 nor an L.
    expect(sizeMatches(["32"], ["W28 L 32", "W 28 L 32", "W28L32"])).toBe(false);
    expect(sizeMatches(["L"], ["W28 L 32", "W 28 L 32", "W28L32"])).toBe(false);
  });

  it("gives one sorted form per size, without repeats", () => {
    expect(sizeTokens("M (38)")).toEqual(["38", "m", "m(38)"]);
    expect(sizeTokens("XXL")).toEqual(["2xl", "xxl"]);
    expect(sizeTokens("38 1/2")).toEqual(["38.5"]);
    expect(sizeTokens("   ")).toEqual([]);
    expect(sizeTokensOf(["M", "m", "38"])).toEqual(["38", "m"]);
  });
});

describe("sizeMatches", () => {
  it("is true when any of her sizes is available, ignoring case and spaces", () => {
    expect(sizeMatches(["m"], ["S", "M"])).toBe(true);
    expect(sizeMatches([" 38 "], ["36", "38"])).toBe(true);
    expect(sizeMatches(["M", "40"], ["40 FR"])).toBe(true);
  });
  it("is false when none is there, null without a size of hers", () => {
    expect(sizeMatches(["38", "S"], ["36", "XL"])).toBe(false);
    expect(sizeMatches([], ["36"])).toBeNull();
    expect(sizeMatches(["  "], ["36"])).toBeNull();
  });
});

describe("isOneSize", () => {
  it("knows the ways shops write « taille unique »", () => {
    for (const label of [
      "TU",
      "T.U.",
      "t.u",
      "Taille unique",
      "TAILLE UNIQUE",
      "One size",
      "one-size",
      "OS",
      "Unique",
      "U",
    ]) {
      expect(isOneSize(label), label).toBe(true);
    }
  });
  it("is false for real sizes", () => {
    for (const label of ["M", "38", "XS", "S/M", "XXL", "Taille 38", "W28", "U 2", "TU 38"]) {
      expect(isOneSize(label), label).toBe(false);
    }
  });
});

describe("SIZE_SUGGESTIONS", () => {
  it("offers letters and 32 to 48 for tops; letters, 24 to 48 and W24 to W34 for bottoms; 35 to 42 by halves for shoes", () => {
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
    expect(SIZE_SUGGESTIONS.bottom).toEqual([
      ...["XS", "S", "M", "L", "XL", "XXL"],
      ...["24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34"],
      ...["36", "38", "40", "42", "44", "46", "48"],
      ...["W24", "W25", "W26", "W27", "W28", "W29", "W30", "W31", "W32", "W33", "W34"],
    ]);
    expect(SIZE_SUGGESTIONS.shoes).toEqual([
      ...["35", "35,5", "36", "36,5", "37", "37,5", "38", "38,5", "39", "39,5", "40", "40,5", "41", "41,5", "42"],
    ]);
  });
  it("only holds sizes the profile accepts in their own field, without duplicates", () => {
    const fields = { top: "sizesTop", bottom: "sizesBottom", shoes: "sizesShoes" } as const;
    for (const [kind, list] of Object.entries(SIZE_SUGGESTIONS) as [keyof typeof fields, readonly string[]][]) {
      expect(new Set(list).size).toBe(list.length);
      for (const size of list) {
        expect(profileSizesSchema.shape[fields[kind]].safeParse([size]).success, `${kind} ${size}`).toBe(true);
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
    const sizes = (sizesTop: string[]) => profileSizesSchema.safeParse({ sizesTop, sizesBottom: [], sizesShoes: [] });
    expect(sizes(["12345678901"]).success).toBe(false);
    expect(sizes(["1234567890"]).success).toBe(true);
    expect(sizes(["XS", "S", "M", "L", "XL", "XXL", "32", "34"]).success).toBe(true);
    expect(sizes(["XS", "S", "M", "L", "XL", "XXL", "32", "34", "36"]).success).toBe(false);
    expect(sizes([""]).success).toBe(false);
    expect(sizes([]).data?.sizesTop).toEqual([]);
  });
  it("trims her sizes and drops repeats, case aside", () => {
    const parsed = profileSizesSchema.parse({ sizesTop: [" M ", "m", "38"], sizesBottom: [], sizesShoes: ["38,5"] });
    expect(parsed).toEqual({ sizesTop: ["M", "38"], sizesBottom: [], sizesShoes: ["38,5"] });
  });
});

describe("liveImportState", () => {
  const now = new Date("2026-11-13T19:16:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const min = 60_000;

  it("keeps a running import whose heartbeat is recent, however long ago it started", () => {
    expect(liveImportState("running", ago(3 * 3_600_000), ago(min), now)).toBe("running");
  });

  it("waits for many missed heartbeats before calling an import dead", () => {
    expect(CATALOGUE_IMPORT_DEAD_MS).toBeGreaterThanOrEqual(10 * CATALOGUE_IMPORT_HEARTBEAT_MS);
  });

  it("drops a running import whose heartbeat is over 10 min old (worker stopped or killed)", () => {
    expect(CATALOGUE_IMPORT_DEAD_MS).toBe(10 * min);
    expect(liveImportState("running", ago(20 * min), ago(10 * min + 1000), now)).toBeNull();
    expect(liveImportState("running", ago(20 * min), ago(10 * min - 1000), now)).toBe("running");
  });

  it("judges a running import without heartbeat (written before it existed) by its start", () => {
    expect(liveImportState("running", ago(5 * min), null, now)).toBe("running");
    expect(liveImportState("running", ago(11 * min), null, now)).toBeNull();
  });

  it("keeps a queued import up to the job expiry (6 h): it may wait behind the others", () => {
    expect(liveImportState("queued", ago(5 * 3_600_000), null, now)).toBe("queued");
    expect(liveImportState("queued", ago(6 * 3_600_000 + 1000), null, now)).toBeNull();
  });

  it("is null without a known state or a start", () => {
    expect(liveImportState(null, ago(min), ago(min), now)).toBeNull();
    expect(liveImportState("other", ago(min), ago(min), now)).toBeNull();
    expect(liveImportState("running", null, ago(min), now)).toBeNull();
  });
});

describe("canImportCatalogue", () => {
  it("is true for Shopify and WooCommerce shops only", () => {
    expect(CATALOGUE_IMPORT_PLATFORMS).toEqual(["shopify", "woocommerce"]);
    expect(canImportCatalogue("shopify")).toBe(true);
    expect(canImportCatalogue("woocommerce")).toBe(true);
    for (const other of ["prestashop", "wix", "squarespace", "magento", "other", "unknown"]) {
      expect(canImportCatalogue(other)).toBe(false);
    }
  });
});
