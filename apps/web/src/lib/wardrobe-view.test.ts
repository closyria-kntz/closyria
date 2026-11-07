import type { ItemView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  initialMoreState,
  moreReducer,
  paramsText,
  STAGE_FILTER_OPTIONS,
  stillShown,
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
    // `favori` is gone (levels replace it): ignored.
    expect(filters).toEqual({
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
      { audience: "child", sort: "oldest", stage: "returned" },
      new URLSearchParams(`profil=${UUID}`),
    );
    expect(params.get("profil")).toBe(UUID);
    expect(filtersFromParams(params)).toEqual({ audience: "child", sort: "oldest", stage: "returned" });
  });

  it("builds the API query for a view: the stage filter replaces the view's stage", () => {
    expect(toItemQuery("envies", {}, UUID)).toEqual({ stage: "spotted", profile: UUID });
    expect(toItemQuery("dressing", { stage: "sold", sort: "price_desc" }, null)).toEqual({
      stage: "sold",
      sort: "price_desc",
    });
  });
});

describe("levels, priority and the love sort", () => {
  it("reads `niveau=4,3` and `prioritaire=1`, dropping what is not a level", () => {
    expect(filtersFromParams(new URLSearchParams("niveau=3,4,9,x,3&prioritaire=1&tri=love"))).toEqual({
      levels: [4, 3],
      priority: true,
      sort: "love",
    });
    expect(filtersFromParams(new URLSearchParams("niveau=&prioritaire=0"))).toEqual({});
  });

  it("writes them plainly in the address and round-trips", () => {
    const params = filtersToParams({ levels: [4, 3], priority: true, sort: "love" });
    expect(paramsText(params)).toBe("niveau=4,3&prioritaire=1&tri=love");
    expect(filtersFromParams(new URLSearchParams(paramsText(params)))).toEqual({
      levels: [4, 3],
      priority: true,
      sort: "love",
    });
  });

  it("asks the API for the levels, the priority and the sort", () => {
    expect(toItemQuery("envies", { levels: [4, 3], priority: true, sort: "love" }, null)).toEqual({
      stage: "spotted",
      loveLevel: "4,3",
      priority: "true",
      sort: "love",
    });
  });

  it("counts the levels as one filter and the priority as another", () => {
    expect(activeFilterCount({ levels: [4, 1], priority: true, sort: "love" })).toBe(2);
  });
});

describe("stillShown", () => {
  const item = {
    stage: "spotted",
    profileId: UUID,
    loveLevel: 3,
    priority: false,
    tags: [{ id: UUID, name: "Été", color: null }],
  } as unknown as ItemView;

  it("keeps a card that still matches the view, its profile and its filters", () => {
    expect(stillShown(item, "spotted", UUID, { tag: UUID, levels: [3] })).toBe(true);
    expect(stillShown(item, "spotted", null, {})).toBe(true);
  });

  it("drops a card whose stage, profile, tag, level or priority no longer match", () => {
    expect(stillShown(item, "owned", null, {})).toBe(false);
    expect(stillShown(item, "spotted", "9b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50", {})).toBe(false);
    expect(stillShown({ ...item, tags: [] }, "spotted", null, { tag: UUID })).toBe(false);
    expect(stillShown(item, "spotted", null, { levels: [4] })).toBe(false);
    expect(stillShown({ ...item, loveLevel: null }, "spotted", null, { levels: [4, 3] })).toBe(false);
    expect(stillShown(item, "spotted", null, { priority: true })).toBe(false);
  });
});

it("counts filters but not the sort", () => {
  expect(activeFilterCount({ sort: "name" })).toBe(0);
  expect(activeFilterCount({ sort: "name", audience: "women", stage: "sold" })).toBe(2);
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

describe("moreReducer", () => {
  it("survives a filter change while a page is in flight", () => {
    let state = moreReducer(initialMoreState, { type: "reset", generation: 1 });
    state = moreReducer(state, { type: "start", generation: 1 });
    expect(state.loading).toBe(true);
    // Filters change: the new first page resets, the old request (aborted) ends late and is ignored.
    state = moreReducer(state, { type: "reset", generation: 2 });
    expect(state).toEqual({ generation: 2, loading: false, failed: false });
    expect(moreReducer(state, { type: "end", generation: 1, failed: true })).toBe(state);
    // A new load-more runs and ends normally.
    state = moreReducer(state, { type: "start", generation: 2 });
    expect(state.loading).toBe(true);
    state = moreReducer(state, { type: "end", generation: 2, failed: false });
    expect(state).toEqual({ generation: 2, loading: false, failed: false });
    expect(moreReducer(state, { type: "start", generation: 1 })).toBe(state);
  });

  it("keeps a failure until the next attempt", () => {
    let state = moreReducer(initialMoreState, { type: "reset", generation: 1 });
    state = moreReducer(state, { type: "start", generation: 1 });
    state = moreReducer(state, { type: "end", generation: 1, failed: true });
    expect(state).toMatchObject({ loading: false, failed: true });
    expect(moreReducer(state, { type: "start", generation: 1 }).failed).toBe(false);
  });
});
