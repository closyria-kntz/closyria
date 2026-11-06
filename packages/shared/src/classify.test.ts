import { describe, expect, it } from "vitest";
import { classify, type ReferenceSet } from "./classify";

const ref: ReferenceSet = {
  categories: [
    { id: "c-clothes", parentId: null, keywords: ["vetements"] },
    { id: "c-dresses", parentId: "c-clothes", keywords: ["robe", "robes", "dress"] },
    { id: "c-long", parentId: "c-dresses", keywords: ["robe longue", "maxi dress"] },
    { id: "c-bottoms", parentId: "c-clothes", keywords: ["bas"] },
    { id: "c-jeans", parentId: "c-bottoms", keywords: ["jean", "jeans"] },
    { id: "c-shoes", parentId: null, keywords: ["chaussures"] },
    { id: "c-sneakers", parentId: "c-shoes", keywords: ["baskets"] },
  ],
  colors: [
    { id: "navy", keywords: ["marine", "bleu marine"] },
    { id: "blue", keywords: ["bleu"] },
    { id: "mint", keywords: ["menthe"] },
  ],
  materials: [{ id: "denim", keywords: ["denim"] }],
  patterns: [
    { id: "floral", keywords: ["fleuri", "fleurie"] },
    { id: "dots", keywords: ["a pois", "pois"] },
    { id: "print", keywords: ["imprime"] },
    { id: "animal", keywords: ["imprime animal"] },
  ],
};

const base = { url: "https://shop.test/products/x", shopData: {} };

describe("classify", () => {
  it("files a long floral dress under Femme > Robes", () => {
    const r = classify({ ...base, name: "Robe longue fleurie", shopData: { breadcrumb: ["Femme", "Robes"] } }, ref);
    expect(r).toMatchObject({ categoryId: "c-long", patternId: "floral", audience: "women" });
  });

  it("files a polka-dot jean under Jeans, deepest category wins", () => {
    const r = classify({ ...base, name: "Jean Mahaut à pois" }, ref);
    expect(r.categoryId).toBe("c-jeans");
    expect(r.patternId).toBe("dots");
    expect(r.audience).toBeUndefined();
  });

  it("is accent- and case-insensitive", () => {
    const r = classify({ ...base, name: "ROBE LONGUE", shopData: { colors: ["Bleu Marine"] } }, ref);
    expect(r.categoryId).toBe("c-long");
    expect(r.colorId).toBe("navy");
  });

  it("reads the audience from the address path", () => {
    expect(classify({ ...base, url: "https://shop.test/kids/robe-x", name: "Robe" }, ref).audience).toBe("child");
    expect(classify({ ...base, url: "https://shop.test/homme/x", name: "Jean" }, ref).audience).toBe("men");
  });

  it("detects the child detail", () => {
    const r = classify({ ...base, name: "Robe", shopData: { breadcrumb: ["Enfant", "Fille"] } }, ref);
    expect(r).toMatchObject({ audience: "child", childDetail: "girl" });
    expect(classify({ ...base, name: "Body", shopData: { breadcrumb: ["Bébé"] } }, ref).childDetail).toBe("baby");
    expect(classify({ ...base, name: "Pull", shopData: { breadcrumb: ["Kids", "Garçon"] } }, ref).childDetail).toBe(
      "boy",
    );
  });

  it("matches whole words only: menthe is not men, woman is not man", () => {
    const r = classify({ ...base, name: "Robe menthe" }, ref);
    expect(r.audience).toBeUndefined();
    expect(r.colorId).toBe("mint");
    expect(classify({ ...base, name: "Robe", shopData: { category: "Woman" } }, ref).audience).toBe("women");
  });

  it("ignores tags for the audience (brand names)", () => {
    expect(
      classify({ ...base, name: "Chemise", shopData: { tags: ["Comme des Garçons"] } }, ref).audience,
    ).toBeUndefined();
    const r = classify(
      { ...base, name: "Chemise", shopData: { breadcrumb: ["Femme", "Comme des Garçons Homme Plus"] } },
      ref,
    );
    expect(r.audience).toBe("women");
  });

  it("never guesses the audience from the name alone", () => {
    expect(classify({ ...base, name: "Chemise homme et femme" }, ref).audience).toBeUndefined();
  });

  it("prefers the longest keyword (imprimé animal over imprimé)", () => {
    expect(classify({ ...base, name: "Top imprimé animal" }, ref).patternId).toBe("animal");
    expect(classify({ ...base, name: "Top imprimé" }, ref).patternId).toBe("print");
  });

  it("breaks category ties by breadcrumb, then shop category, then name", () => {
    const r = classify({ ...base, name: "Baskets", shopData: { breadcrumb: ["Robes"], category: "Baskets" } }, ref);
    expect(r.categoryId).toBe("c-dresses");
    expect(classify({ ...base, name: "Robe", shopData: { category: "Baskets" } }, ref).categoryId).toBe("c-sneakers");
  });

  it("lets the breadcrumb beat the name for the category", () => {
    expect(classify({ ...base, name: "Baskets", shopData: { breadcrumb: ["Robes"] } }, ref).categoryId).toBe(
      "c-dresses",
    );
  });

  it("sets the season from keywords", () => {
    expect(classify({ ...base, name: "Maillot une pièce" }, ref).season).toBe("summer");
    expect(classify({ ...base, name: "Doudoune légère" }, ref).season).toBe("winter");
    expect(classify({ ...base, name: "Manteau d'hiver" }, ref).season).toBe("winter");
    expect(classify({ ...base, name: "Robe" }, ref).season).toBeUndefined();
  });

  it("matches multi-word keywords as phrases and finds the material", () => {
    expect(classify({ ...base, name: "Une robe très longue" }, ref).categoryId).toBe("c-dresses");
    expect(classify({ ...base, name: "Veste", shopData: { material: "100% Denim" } }, ref).materialId).toBe("denim");
  });

  it("returns an empty classification when nothing matches", () => {
    expect(classify({ ...base, url: "not a url", name: "Zzz" }, ref)).toEqual({});
  });
});
