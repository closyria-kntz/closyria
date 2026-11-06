import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  STAGE_FILTER_OPTIONS,
  toggleSelection,
  toItemQuery,
  VIEWS,
  viewForPath,
} from "./wardrobe-view";

const UUID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

describe("wardrobe views", () => {
  it("maps each view to its stage and the extra stages to the filter", () => {
    expect(VIEWS.envies.stage).toBe("spotted");
    expect(VIEWS.commande.stage).toBe("ordered");
    expect(VIEWS.dressing.stage).toBe("owned");
    expect(VIEWS["a-vendre"].stage).toBe("for_sale");
    expect(STAGE_FILTER_OPTIONS).toEqual(["sold", "returned"]);
    expect(viewForPath("/dressing")).toBe("dressing");
    expect(viewForPath("/produits/x")).toBeNull();
  });
});

describe("filters in the address", () => {
  it("reads valid values and drops the rest", () => {
    const filters = filtersFromParams(
      new URLSearchParams(
        `favori=1&boutique=${UUID}&type=${UUID}&couleur=nope&public=women&etiquette=${UUID}&tri=price_asc&etape=sold`,
      ),
    );
    expect(filters).toEqual({
      favorite: true,
      shop: UUID,
      category: UUID,
      audience: "women",
      tag: UUID,
      sort: "price_asc",
      stage: "sold",
    });
  });

  it("ignores an unknown sort or stage, and the default sort is not written", () => {
    expect(filtersFromParams(new URLSearchParams("tri=zzz&etape=owned"))).toEqual({});
    expect(filtersToParams({ sort: "recent" }).toString()).toBe("");
  });

  it("round-trips, keeping foreign parameters such as the profile", () => {
    const params = filtersToParams(
      { favorite: true, audience: "child", sort: "oldest", stage: "returned" },
      new URLSearchParams(`profil=${UUID}`),
    );
    expect(params.get("profil")).toBe(UUID);
    expect(filtersFromParams(params)).toEqual({ favorite: true, audience: "child", sort: "oldest", stage: "returned" });
  });

  it("builds the API query for a view: the stage filter replaces the view's stage", () => {
    expect(toItemQuery("envies", {}, UUID)).toEqual({ stage: "spotted", profile: UUID });
    expect(toItemQuery("dressing", { stage: "sold", favorite: true, sort: "price_desc" }, null)).toEqual({
      stage: "sold",
      favorite: "true",
      sort: "price_desc",
    });
  });
});

it("counts filters but not the sort", () => {
  expect(activeFilterCount({ sort: "name" })).toBe(0);
  expect(activeFilterCount({ sort: "name", favorite: true, stage: "sold" })).toBe(2);
});

describe("toggleSelection", () => {
  it("adds, removes, and refuses beyond the cap", () => {
    const full = new Set(Array.from({ length: 200 }, (_, i) => `id-${i}`));
    expect(toggleSelection(new Set(), "a")).toEqual({ next: new Set(["a"]), refused: false });
    expect(toggleSelection(new Set(["a"]), "a")).toEqual({ next: new Set(), refused: false });
    const refused = toggleSelection(full, "new");
    expect(refused.refused).toBe(true);
    expect(refused.next.size).toBe(200);
    expect(toggleSelection(full, "id-3").next.size).toBe(199);
    expect(toggleSelection(new Set(["a", "b"]), "c", 2).refused).toBe(true);
  });
});
