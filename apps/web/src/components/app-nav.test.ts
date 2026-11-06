import { describe, expect, it } from "vitest";
import { countFor, desktopNav, helpNav, isCurrent, moreNav, phoneTabs, tabletTabs } from "./app-nav";

describe("app navigation", () => {
  it("shows five tabs on a phone, the rest behind « Plus »", () => {
    expect(phoneTabs.map((item) => item.key)).toEqual(["home", "wishes", "ordered", "wardrobe", "more"]);
    expect(moreNav.map((item) => item.key)).toEqual(["forSale", "lists", "settings", "help"]);
  });

  it("shows the home page and the six places in the side menu, and the tablet tabs", () => {
    expect(desktopNav.map((item) => item.key)).toEqual([
      "home",
      "wishes",
      "ordered",
      "wardrobe",
      "forSale",
      "lists",
      "settings",
    ]);
    expect(tabletTabs.map((item) => item.key)).toEqual(desktopNav.map((item) => item.key));
  });

  it("marks the current page, including its sub-pages", () => {
    const lists = desktopNav.find((item) => item.key === "lists");
    const wishes = desktopNav.find((item) => item.key === "wishes");
    if (!lists || !wishes) throw new Error("missing items");
    expect(isCurrent(lists, "/listes")).toBe(true);
    expect(isCurrent(lists, "/listes/abc")).toBe(true);
    expect(isCurrent(lists, "/listesx")).toBe(false);
    expect(isCurrent(wishes, "/dressing")).toBe(false);
  });

  it("marks « Accueil » on the home page only", () => {
    const home = desktopNav.find((item) => item.key === "home");
    if (!home) throw new Error("missing home");
    expect(isCurrent(home, "/")).toBe(true);
    expect(isCurrent(home, "/envies")).toBe(false);
  });

  it("counts the active items of the matching stage, nothing for the other places", () => {
    const counts = { spotted: 4, ordered: 3, owned: 2, for_sale: 1, sold: 9, returned: 8 };
    const of = (key: string) => {
      const item = [...desktopNav, helpNav].find((i) => i.key === key);
      if (!item) throw new Error(key);
      return countFor(item, counts);
    };
    expect([of("wishes"), of("ordered"), of("wardrobe"), of("forSale")]).toEqual([4, 3, 2, 1]);
    expect([of("home"), of("lists"), of("settings"), of("help")]).toEqual([null, null, null, null]);
    const wishes = desktopNav.find((i) => i.key === "wishes");
    if (!wishes) throw new Error("wishes");
    expect(countFor(wishes, null)).toBeNull();
  });

  it("« Aide » leads to the help page and is current there", () => {
    expect(helpNav).toEqual({ key: "help", href: "/aide/iphone" });
    expect(isCurrent(helpNav, "/aide/iphone")).toBe(true);
  });
});
