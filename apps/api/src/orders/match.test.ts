import { describe, expect, it } from "vitest";
import { foldShopName, normalizeArticleName, pickSameArticle } from "./match";

describe("normalizeArticleName", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(normalizeArticleName("  Robe « Léa » – Écru ")).toBe("robe lea ecru");
    expect(normalizeArticleName("CŒUR d'Été")).toBe("coeur d ete");
  });
});

describe("pickSameArticle", () => {
  const items = [
    { id: "a", name: "Robe Léa" },
    { id: "b", name: "Robe Léa longue" },
    { id: "c", name: null },
  ];

  it("takes the one item of the same name", () => {
    expect(pickSameArticle("ROBE LEA", items)).toBe("a");
  });

  it("never guesses on a partial name", () => {
    expect(pickSameArticle("Robe", items)).toBeNull();
    expect(pickSameArticle("Robe Léa courte", items)).toBeNull();
  });

  it("prefers a new article to a doubtful link: two of the same name give none", () => {
    expect(pickSameArticle("Robe Léa", [...items, { id: "d", name: "robe lea" }])).toBeNull();
  });

  it("needs a name on both sides", () => {
    expect(pickSameArticle("  ", items)).toBeNull();
    expect(pickSameArticle("x", [{ id: "c", name: null }])).toBeNull();
  });
});

describe("foldShopName", () => {
  it("folds case, accents and spaces as the SQL lookup does", () => {
    expect(foldShopName("  La Petite  ÉCHOPPE ")).toBe("la petite echoppe");
    expect(foldShopName("Cœur & Âme")).toBe("coeur & ame");
  });
});
