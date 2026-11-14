import { describe, expect, it } from "vitest";
import { ILLUSTRATION_KINDS, illustrationKindOf, illustrationKindsByCategory } from "./catalogue";
import { type CatalogueFacts, factualDescription } from "./catalogue-facts";

const facts = (partial: Partial<CatalogueFacts>): CatalogueFacts => ({
  category: null,
  color: null,
  material: null,
  sizes: [],
  ...partial,
});
const cat = (slug: string, name = slug) => ({ slug, name });

describe("factualDescription", () => {
  it("says nothing without any fact", () => {
    expect(factualDescription(facts({}))).toBeNull();
    // Sold out everywhere: no size is a fact worth saying either.
    expect(factualDescription(facts({ sizes: [] }))).toBeNull();
  });

  it("writes the brief's example: category, colour, material and the range in stock", () => {
    expect(
      factualDescription(
        facts({
          category: cat("robe-longue", "Robe longue"),
          color: cat("rouge", "Rouge"),
          material: cat("lin", "Lin"),
          sizes: ["36", "38", "40", "42"],
        }),
      ),
    ).toBe("Robe longue rouge en lin, du 36 au 42.");
  });

  it("agrees the colour with the article (feminine, plural, invariable)", () => {
    expect(factualDescription(facts({ category: cat("robes"), color: cat("noir", "Noir") }))).toBe("Robe noire.");
    expect(factualDescription(facts({ category: cat("pantalons"), color: cat("noir", "Noir") }))).toBe(
      "Pantalon noir.",
    );
    expect(factualDescription(facts({ category: cat("sandales"), color: cat("blanc", "Blanc") }))).toBe(
      "Sandales blanches.",
    );
    expect(factualDescription(facts({ category: cat("escarpins"), color: cat("bleu", "Bleu") }))).toBe(
      "Escarpins bleus.",
    );
    expect(factualDescription(facts({ category: cat("jupes"), color: cat("marron", "Marron") }))).toBe("Jupe marron.");
    expect(factualDescription(facts({ category: cat("baskets"), color: cat("camel", "Camel") }))).toBe(
      "Baskets camel.",
    );
    expect(factualDescription(facts({ category: cat("jupes"), color: cat("ecru", "Écru") }))).toBe("Jupe écrue.");
  });

  it("names an article of an unknown sub-category by its known parent, else « Article »", () => {
    expect(
      factualDescription(
        facts({
          category: { slug: "robe-portefeuille", name: "Robe portefeuille", parents: ["robes", "vetements"] },
          color: cat("vert", "Vert"),
        }),
      ),
    ).toBe("Robe verte.");
    expect(factualDescription(facts({ category: cat("inconnue", "Inconnue"), color: cat("rose", "Rose") }))).toBe(
      "Article rose.",
    );
    expect(factualDescription(facts({ material: cat("laine", "Laine") }))).toBe("Article en laine.");
  });

  it("uses an unknown colour or material by its name, lowercased", () => {
    expect(
      factualDescription(
        facts({ category: cat("hauts"), color: cat("e2e-x", "Pistache"), material: cat("m", "Lyocell") }),
      ),
    ).toBe("Haut pistache en lyocell.");
  });

  it("reads the sizes in stock: one, « taille unique », letters, numbers, half sizes", () => {
    const say = (sizes: string[]) => factualDescription(facts({ category: cat("hauts"), sizes }));
    expect(say(["38"])).toBe("Haut, taille 38.");
    expect(say(["TU"])).toBe("Haut, taille unique.");
    expect(say(["One size"])).toBe("Haut, taille unique.");
    expect(say(["M", "XS", "L"])).toBe("Haut, du XS au L.");
    expect(say(["2XL", "S"])).toBe("Haut, du S au XXL.");
    expect(say(["EU 38", "36 FR", "T40"])).toBe("Haut, du 36 au 40.");
    expect(factualDescription(facts({ category: cat("escarpins"), sizes: ["37,5", "36", "38.5"] }))).toBe(
      "Escarpins, du 36 au 38,5.",
    );
    // Letters and numbers mixed, or labels no rule reads: listed as given (a few), never invented.
    expect(say(["S", "38"])).toBe("Haut, tailles S et 38.");
    expect(say(["Petit", "Grand"])).toBe("Haut, tailles Petit et Grand.");
    expect(say(["A", "B", "C", "D", "E", "F", "G"])).toBe("Haut, 7 tailles.");
    // The same size twice is said once.
    expect(say(["38", "38 FR"])).toBe("Haut, taille 38.");
  });

  it("never copies any free text: only the reference names and the size labels", () => {
    const text = factualDescription(
      facts({ category: cat("robes", "Robes"), color: cat("rouge", "Rouge"), sizes: ["S", "M"] }),
    );
    expect(text).toBe("Robe rouge, du S au M.");
  });
});

describe("illustrationKindOf", () => {
  it("knows the eight kinds", () => {
    expect(ILLUSTRATION_KINDS).toEqual(["top", "dress", "bottom", "skirt", "coat", "shoes", "bag", "other"]);
  });

  it("files the reference categories", () => {
    expect(illustrationKindOf("t-shirts")).toBe("top");
    expect(illustrationKindOf("pulls-gilets")).toBe("top");
    expect(illustrationKindOf("robe-courte")).toBe("dress");
    expect(illustrationKindOf("jeans")).toBe("bottom");
    expect(illustrationKindOf("shorts")).toBe("bottom");
    expect(illustrationKindOf("jupes")).toBe("skirt");
    expect(illustrationKindOf("vestes-manteaux")).toBe("coat");
    expect(illustrationKindOf("bottines-bottes")).toBe("shoes");
    expect(illustrationKindOf("sacs")).toBe("bag");
    expect(illustrationKindOf("ceintures")).toBe("bag");
    expect(illustrationKindOf("vetements")).toBe("other");
    expect(illustrationKindOf(null)).toBe("other");
    expect(illustrationKindOf("inconnue")).toBe("other");
  });

  it("lets a sub-category inherit its parent's kind", () => {
    const kinds = illustrationKindsByCategory([
      { id: "a", parentId: null, slug: "robes" },
      { id: "b", parentId: "a", slug: "robe-portefeuille" },
      { id: "c", parentId: null, slug: "inconnue" },
    ]);
    expect(kinds.get("b")).toBe("dress");
    expect(kinds.get("c")).toBeUndefined();
  });
});
