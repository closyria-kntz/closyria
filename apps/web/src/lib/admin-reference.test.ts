import type { ReferenceEntry } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import {
  buildCategoryTree,
  categoryChoices,
  descendantIds,
  keywordsFromText,
  keywordsToText,
  type ProductForm,
  productPatch,
  referenceBody,
  slugify,
} from "./admin-reference";

const entry = (id: string, name: string, parentId: string | null, position = 0): ReferenceEntry => ({
  id,
  slug: name.toLowerCase(),
  name,
  keywords: [],
  parentId,
  position,
});
const list = [
  entry("c", "Jeans", "b", 1),
  entry("a", "Vêtements", null, 0),
  entry("b", "Pantalons", "a", 0),
  entry("d", "Chaussures", null, 1),
];

describe("buildCategoryTree", () => {
  it("nests children under their parent, ordered by position then name", () => {
    const tree = buildCategoryTree(list);
    expect(tree.map((n) => n.entry.name)).toEqual(["Vêtements", "Chaussures"]);
    expect(tree[0]?.children[0]?.entry.name).toBe("Pantalons");
    expect(tree[0]?.children[0]?.children[0]?.entry.name).toBe("Jeans");
  });

  it("treats an entry whose parent is missing as a root", () => {
    expect(buildCategoryTree([entry("x", "Orphelin", "gone")]).map((n) => n.entry.id)).toEqual(["x"]);
  });
});

describe("descendantIds", () => {
  it("collects every level below an entry", () => {
    expect([...descendantIds(list, "a")].sort()).toEqual(["b", "c"]);
    expect(descendantIds(list, "d").size).toBe(0);
  });
});

describe("categoryChoices", () => {
  it("labels each category with its path, in tree order", () => {
    expect(categoryChoices(list, " › ").map((c) => c.label)).toEqual([
      "Vêtements",
      "Vêtements › Pantalons",
      "Vêtements › Pantalons › Jeans",
      "Chaussures",
    ]);
  });
});

describe("keywords", () => {
  it("splits on commas, trims and drops empty pieces", () => {
    expect(keywordsFromText(" jean, , denim ,")).toEqual(["jean", "denim"]);
    expect(keywordsFromText("")).toEqual([]);
  });
  it("joins them for the editor", () => {
    expect(keywordsToText(["jean", "denim"])).toBe("jean, denim");
  });
});

describe("productPatch", () => {
  const initial: ProductForm = {
    name: "Robe",
    brand: "Zara",
    price: "49,90",
    audience: "women",
    childDetail: "",
    categoryId: "cat",
    colorId: "",
    materialId: "",
    patternId: "",
    season: "",
  };
  it("sends only the fields that changed, with nulls for cleared ones and cents for the price", () => {
    expect(productPatch({ ...initial, brand: "", price: "12" }, initial)).toEqual({
      ok: true,
      patch: { brand: null, priceCents: 1200 },
    });
  });
  it("sends audience and child detail together, and drops the detail unless the audience is child", () => {
    const result = productPatch({ ...initial, audience: "child", childDetail: "girl" }, initial);
    expect(result).toEqual({ ok: true, patch: { audience: "child", childDetail: "girl" } });
    const back = productPatch({ ...initial, audience: "men", childDetail: "girl" }, { ...initial, audience: "child" });
    expect(back).toEqual({ ok: true, patch: { audience: "men", childDetail: null } });
  });
  it("refuses an empty name when the sheet had one, and leaves a missing name alone", () => {
    expect(productPatch({ ...initial, name: "  " }, initial)).toEqual({ ok: false, field: "name" });
    const unnamed = { ...initial, name: "" };
    expect(productPatch({ ...unnamed, categoryId: "other" }, unnamed)).toEqual({
      ok: true,
      patch: { categoryId: "other" },
    });
    expect(productPatch({ ...unnamed, name: "Robe lin" }, unnamed)).toEqual({ ok: true, patch: { name: "Robe lin" } });
  });
  it("refuses over-long fields and unreadable prices", () => {
    expect(productPatch({ ...initial, name: "a".repeat(301) }, initial)).toEqual({ ok: false, field: "name" });
    expect(productPatch({ ...initial, brand: "a".repeat(121) }, initial)).toEqual({ ok: false, field: "brand" });
    expect(productPatch({ ...initial, price: "abc" }, initial)).toEqual({ ok: false, field: "price" });
    expect(productPatch({ ...initial, price: "9999999999" }, initial)).toEqual({ ok: false, field: "price" });
  });
  it("reports nothing to save when nothing changed", () => {
    expect(productPatch(initial, initial)).toEqual({ ok: false, field: "nothing" });
  });
});

describe("referenceBody", () => {
  const draft = { name: "Rouge", slug: "", keywords: "rouge, carmin", hex: "", parentId: "" };
  it("builds a category body with the parent, a generated slug and keywords", () => {
    expect(referenceBody("categories", { ...draft, parentId: "p" }, true)).toEqual({
      ok: true,
      body: { name: "Rouge", slug: "rouge", keywords: ["rouge", "carmin"], parentId: "p" },
    });
  });
  it("checks the colour hex, the name length and the keywords", () => {
    expect(referenceBody("colors", { ...draft, hex: "red" }, true).ok).toBe(false);
    expect(referenceBody("colors", { ...draft, hex: `#${"12ab"}ef` }, true).ok).toBe(true);
    expect(referenceBody("materials", { ...draft, name: "a".repeat(81) }, true).ok).toBe(false);
    expect(referenceBody("materials", { ...draft, name: " " }, true).ok).toBe(false);
    expect(referenceBody("materials", { ...draft, keywords: "a".repeat(61) }, true).ok).toBe(false);
    expect(referenceBody("materials", { ...draft, keywords: Array(101).fill("k").join(",") }, true).ok).toBe(false);
  });
});

describe("category cycles", () => {
  it("shows entries caught in a cycle as roots, flagged", () => {
    const loop = [entry("x", "X", "y"), entry("y", "Y", "x"), entry("z", "Z", null)];
    const tree = buildCategoryTree(loop);
    expect(tree.map((n) => [n.entry.id, n.inCycle])).toEqual([
      ["x", true],
      ["y", true],
      ["z", false],
    ]);
  });
});

describe("slugify", () => {
  it("makes a lowercase, accent-free, dash-separated slug", () => {
    expect(slugify("  T-shirt  à Rayures! ")).toBe("t-shirt-a-rayures");
    expect(slugify("---")).toBe("");
  });
});
