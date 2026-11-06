import { describe, expect, it } from "vitest";
import { desktopNav, isCurrent, moreNav, phoneTabs, tabletTabs } from "./app-nav";

describe("app navigation", () => {
  it("shows five tabs on a phone, the rest behind « Plus »", () => {
    expect(phoneTabs.map((item) => item.key)).toEqual(["home", "wishes", "ordered", "wardrobe", "more"]);
    expect(moreNav.map((item) => item.key)).toEqual(["forSale", "lists", "settings"]);
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
});
