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
  const base: ProductForm = {
    name: "Robe",
    brand: "",
    price: "49,90",
    audience: "child",
    childDetail: "girl",
    categoryId: "",
    colorId: "x",
    materialId: "",
    patternId: "",
    season: "",
  };
  it("turns the form into a patch with nulls for cleared fields and cents for the price", () => {
    expect(productPatch(base)).toEqual({
      ok: true,
      patch: {
        name: "Robe",
        brand: null,
        priceCents: 4990,
        audience: "child",
        childDetail: "girl",
        categoryId: null,
        colorId: "x",
        materialId: null,
        patternId: null,
        season: null,
      },
    });
  });
  it("drops the child detail unless the audience is child", () => {
    const result = productPatch({ ...base, audience: "women" });
    expect(result.ok && result.patch.childDetail).toBe(null);
  });
  it("refuses an empty name and an unreadable price", () => {
    expect(productPatch({ ...base, name: "  " })).toEqual({ ok: false, field: "name" });
    expect(productPatch({ ...base, price: "abc" })).toEqual({ ok: false, field: "price" });
  });
  it("an empty price clears the price", () => {
    const result = productPatch({ ...base, price: "" });
    expect(result.ok && result.patch.priceCents).toBe(null);
  });
});

describe("slugify", () => {
  it("makes a lowercase, accent-free, dash-separated slug", () => {
    expect(slugify("  T-shirt  à Rayures! ")).toBe("t-shirt-a-rayures");
    expect(slugify("---")).toBe("");
  });
});
