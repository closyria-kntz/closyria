import { describe, expect, it } from "vitest";
import { type AppNavKey, appNav, isCurrent, phoneNav } from "./app-nav";

const place = (key: AppNavKey) => {
  const found = appNav.find((item) => item.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
};

describe("app navigation", () => {
  it("has the four places in order, the + between Découvrir and Mes articles on a phone", () => {
    expect(appNav.map((item) => [item.key, item.href])).toEqual([
      ["accueil", "/"],
      ["decouvrir", "/decouvrir"],
      ["articles", "/articles"],
      ["moi", "/moi"],
    ]);
    expect(phoneNav.map((item) => item.key)).toEqual(["accueil", "decouvrir", "add", "articles", "moi"]);
  });

  it("marks « Accueil » on the home page only", () => {
    expect(isCurrent(place("accueil"), "/")).toBe(true);
    expect(isCurrent(place("accueil"), "/articles")).toBe(false);
  });

  it("marks « Mes articles » on its sub-pages: sheets, lists, preparing an order", () => {
    const articles = place("articles");
    for (const path of ["/articles", "/produits/abc", "/listes", "/listes/abc", "/envies/commande"]) {
      expect(isCurrent(articles, path), path).toBe(true);
    }
    expect(isCurrent(articles, "/listesx")).toBe(false);
    expect(isCurrent(articles, "/moi")).toBe(false);
  });

  it("marks « Moi » on the settings and the help, « Découvrir » on its page", () => {
    for (const path of ["/moi", "/reglages/profils", "/reglages/compte", "/aide/telephone"]) {
      expect(isCurrent(place("moi"), path), path).toBe(true);
    }
    expect(isCurrent(place("decouvrir"), "/decouvrir")).toBe(true);
    expect(isCurrent(place("decouvrir"), "/")).toBe(false);
  });
});
