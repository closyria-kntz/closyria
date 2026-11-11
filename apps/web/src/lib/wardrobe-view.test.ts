import type { ItemView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filtersFromParams,
  filtersToParams,
  initialMoreState,
  itemStep,
  moreReducer,
  paramsText,
  STAGE_FILTER_OPTIONS,
  stillShown,
  toggleSelection,
  toItemQuery,
  toViewQuery,
  VIEWS,
  wishSummary,
} from "./wardrobe-view";

const UUID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

describe("wardrobe views", () => {
  it("maps each view to its stages and the extra stages to the filter", () => {
    expect(VIEWS.tout).toEqual({ stages: ["spotted", "ordered", "owned", "for_sale"] });
    expect(VIEWS.envies).toEqual({ stage: "spotted" });
    expect(VIEWS.commande).toEqual({ stage: "ordered" });
    expect(VIEWS.recu).toEqual({ stage: "owned", received: true });
    expect(VIEWS.dressing).toEqual({ stage: "owned", received: false });
    expect(VIEWS["a-vendre"]).toEqual({ stage: "for_sale" });
    expect(STAGE_FILTER_OPTIONS).toEqual(["sold", "returned"]);
  });

  it("gives each item the step its card shows, from what the server decided (« Reçu » or « Dans mon dressing »)", () => {
    const of = (stage: string, received = false) => itemStep({ stage, received } as unknown as ItemView);
    expect(of("spotted")).toBe("envie");
    expect(of("ordered")).toBe("commande");
    expect(of("owned", true)).toBe("recu");
    expect(of("owned", false)).toBe("dressing");
    expect(of("for_sale")).toBe("a-vendre");
    expect(of("sold")).toBeNull();
    expect(of("returned")).toBeNull();
  });
});

describe("filters in the address", () => {
  it("reads valid values and drops the rest", () => {
    const filters = filtersFromParams(
      new URLSearchParams(
        `favori=1&boutique=${UUID}&type=${UUID}&couleur=nope&public=women&etiquette=${UUID}&tri=price_asc&statut=sold`,
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

  it("« Tout » asks for the five steps, « Reçu » and « Dans mon dressing » let the server split « owned »", () => {
    expect(toItemQuery("tout", {}, UUID)).toEqual({ stages: "spotted,ordered,owned,for_sale", profile: UUID });
    expect(toItemQuery("recu", {}, null)).toEqual({ stage: "owned", received: "true" });
    expect(toItemQuery("dressing", {}, null)).toEqual({ stage: "owned", received: "false" });
    expect(toItemQuery("tout", { stage: "returned" }, null)).toEqual({ stage: "returned" });
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
    expect(stillShown(item, "envies", UUID, { tag: UUID, levels: [3] })).toBe(true);
    expect(stillShown(item, "envies", null, {})).toBe(true);
    expect(stillShown(item, "tout", null, {})).toBe(true);
    expect(stillShown({ ...item, stage: "owned", received: true }, "tout", null, {})).toBe(true);
    expect(stillShown({ ...item, stage: "owned", received: true }, "recu", null, {})).toBe(true);
    expect(stillShown({ ...item, stage: "sold" }, "dressing", null, { stage: "sold" })).toBe(true);
  });

  it("drops a card whose stage, profile, tag, level or priority no longer match", () => {
    expect(stillShown(item, "dressing", null, {})).toBe(false);
    expect(stillShown({ ...item, stage: "owned", received: true }, "dressing", null, {})).toBe(false);
    expect(stillShown({ ...item, stage: "sold" }, "tout", null, {})).toBe(false);
    expect(stillShown(item, "envies", "9b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50", {})).toBe(false);
    expect(stillShown({ ...item, tags: [] }, "envies", null, { tag: UUID })).toBe(false);
    expect(stillShown(item, "envies", null, { levels: [4] })).toBe(false);
    expect(stillShown({ ...item, loveLevel: null }, "envies", null, { levels: [4, 3] })).toBe(false);
    expect(stillShown(item, "envies", null, { priority: true })).toBe(false);
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

describe("search", () => {
  it("reads `recherche=` trimmed, drops an empty one, and writes it back", () => {
    expect(filtersFromParams(new URLSearchParams("recherche=%20robe%20lin%20"))).toEqual({ q: "robe lin" });
    expect(filtersFromParams(new URLSearchParams("recherche=%20%20"))).toEqual({});
    expect(filtersFromParams(new URLSearchParams(`recherche=${"a".repeat(150)}`)).q).toHaveLength(100);
    expect(filtersToParams({ q: "robe" }).get("recherche")).toBe("robe");
  });

  it("sends it to the API and counts it as a filter (« Effacer » clears it too)", () => {
    expect(toItemQuery("envies", { q: "robe" }, null)).toEqual({ stage: "spotted", q: "robe" });
    expect(activeFilterCount({ q: "robe", priority: true })).toBe(2);
  });
});

describe("toViewQuery", () => {
  it("« Toutes mes envies »: the wishes of the current profile", () => {
    expect(toViewQuery("envies", {}, UUID, null)).toEqual({ stage: "spotted", profile: UUID });
  });

  it("a list tab: the list's wishes of every profile of the account", () => {
    const list = "9b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
    expect(toViewQuery("envies", { priority: true }, UUID, list)).toEqual({
      stage: "spotted",
      priority: "true",
      wishlist: list,
    });
  });
});

describe("wishSummary", () => {
  const wish = (priceCents: number | null, compareAtCents: number | null = null) =>
    ({ product: { priceCents, compareAtCents } }) as unknown as ItemView;

  it("counts the wishes, adds the known prices and the prices that dropped", () => {
    expect(wishSummary([wish(12000, 14000), wish(9500), wish(null), wish(24500, 27500), wish(3000, 3000)])).toEqual({
      count: 5,
      totalCents: 49000,
      drops: 2,
    });
    expect(wishSummary([])).toEqual({ count: 0, totalCents: 0, drops: 0 });
  });
});
