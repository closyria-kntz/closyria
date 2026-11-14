import type { CatalogCard } from "@closyria/shared";
import { describe, expect, it, vi } from "vitest";
import {
  activeCatalogueFilterCount,
  type CatalogueFilters,
  catalogueFiltersFromParams,
  catalogueFiltersToParams,
  fetchCatalogueDetail,
  fetchCataloguePage,
  fetchMoreCatalogue,
  PRICE_RANGES,
  readLastDiscoverHref,
  readSnapshot,
  reportArticle,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_STORAGE_KEY,
  StaleCatalogueCursorError,
  snapshotKey,
  toCatalogueQuery,
  withoutFilter,
  writeSnapshot,
} from "./catalogue-client";

const UUID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
const OTHER = "1c4e2f0a-8d7b-4b3a-9e6f-2a1b3c4d5e6f";

const card: CatalogCard = {
  productId: UUID,
  name: "Robe Iris",
  shop: { id: OTHER, name: "Atelier" },
  imageUrl: `/api/catalog-images/${UUID}`,
  priceCents: 4900,
  previousPriceCents: null,
  currency: "EUR",
  sizeInStock: null,
  wanted: false,
};

/** A Storage in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

const response = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("catalogue filters in the address", () => {
  it("reads every filter, in French, and drops what is not valid", () => {
    const filters = catalogueFiltersFromParams(
      new URLSearchParams(
        `recherche=%20robe%20rouge%20&type=${UUID}&couleur=nope&prix=30-60&ma-taille=1&boutique=${OTHER}` +
          "&valeurs=eco,made_in_france,bogus,eco&en-baisse=1&nouveautes=1&tri=price_asc&profil=x",
      ),
    );
    expect(filters).toEqual({
      q: "robe rouge",
      category: UUID,
      price: "30-60",
      mySize: true,
      shop: OTHER,
      values: ["made_in_france", "eco"],
      onSale: true,
      isNew: true,
      sort: "price_asc",
    });
  });

  it("ignores an unknown price range, sort, a flag other than 1 and the default sort", () => {
    expect(
      catalogueFiltersFromParams(new URLSearchParams("prix=1-2&tri=cheap&ma-taille=oui&en-baisse=true&tri=new")),
    ).toEqual({});
    expect(catalogueFiltersFromParams(new URLSearchParams("tri=new"))).toEqual({});
  });

  it("writes the filters back and keeps the foreign parameters (the profile)", () => {
    const filters: CatalogueFilters = {
      q: "robe",
      price: "100-",
      values: ["second_hand", "free_returns"],
      mySize: true,
      sort: "popular",
    };
    const params = catalogueFiltersToParams(filters, new URLSearchParams(`profil=${UUID}&recherche=old&tri=price_asc`));
    expect(params.get("profil")).toBe(UUID);
    expect(params.get("recherche")).toBe("robe");
    expect(params.get("prix")).toBe("100-");
    expect(params.get("valeurs")).toBe("second_hand,free_returns");
    expect(params.get("ma-taille")).toBe("1");
    expect(params.get("tri")).toBe("popular");
    // Round trip.
    expect(catalogueFiltersFromParams(params)).toEqual(filters);
    // Nothing left: no parameter at all.
    expect(catalogueFiltersToParams({}).toString()).toBe("");
  });

  it("counts the filters on, each value apart, never the sort", () => {
    expect(activeCatalogueFilterCount({})).toBe(0);
    expect(activeCatalogueFilterCount({ sort: "popular" })).toBe(0);
    expect(activeCatalogueFilterCount({ q: "robe", values: ["eco", "second_hand"], onSale: true })).toBe(4);
  });

  it("does not count « Ma taille en stock » once the page said she has no sizes", () => {
    expect(activeCatalogueFilterCount({ mySize: true, onSale: true })).toBe(2);
    expect(activeCatalogueFilterCount({ mySize: true, onSale: true }, null)).toBe(2);
    expect(activeCatalogueFilterCount({ mySize: true, onSale: true }, true)).toBe(2);
    expect(activeCatalogueFilterCount({ mySize: true, onSale: true }, false)).toBe(1);
  });

  it("takes one filter off (one value of the shop's values)", () => {
    const filters: CatalogueFilters = { q: "robe", values: ["eco", "second_hand"], onSale: true };
    expect(withoutFilter(filters, { key: "onSale" })).toEqual({ q: "robe", values: ["eco", "second_hand"] });
    expect(withoutFilter(filters, { key: "values", value: "eco" })).toEqual({
      q: "robe",
      values: ["second_hand"],
      onSale: true,
    });
    expect(withoutFilter({ values: ["eco"] }, { key: "values", value: "eco" })).toEqual({});
  });

  it("turns the filters into the API's query, prices in cents and the profile", () => {
    expect(
      toCatalogueQuery(
        {
          q: "robe",
          category: UUID,
          color: OTHER,
          price: "30-60",
          mySize: true,
          shop: OTHER,
          values: ["eco", "made_in_france"],
          onSale: true,
          isNew: true,
          sort: "price_desc",
        },
        UUID,
      ),
    ).toEqual({
      q: "robe",
      category: UUID,
      color: OTHER,
      priceMin: "3000",
      priceMax: "6000",
      mySize: "true",
      shop: OTHER,
      values: "eco,made_in_france",
      onSale: "true",
      isNew: "true",
      sort: "price_desc",
      profile: UUID,
    });
    expect(toCatalogueQuery({ price: "0-30" }, null)).toEqual({ priceMax: "3000", sort: "new" });
    expect(toCatalogueQuery({ price: "100-" }, null)).toEqual({ priceMin: "10000", sort: "new" });
    expect(PRICE_RANGES).toEqual(["0-30", "30-60", "60-100", "100-"]);
  });
});

describe("the page kept for the back button", () => {
  it("keys a snapshot by the address' parameters, whatever their order", () => {
    expect(snapshotKey(new URLSearchParams("b=2&a=1"))).toBe(snapshotKey(new URLSearchParams("a=1&b=2")));
    expect(snapshotKey(new URLSearchParams("a=1"))).not.toBe(snapshotKey(new URLSearchParams("a=2")));
  });

  it("gives back the pages and the position of the same address only, while fresh", () => {
    const storage = memoryStorage();
    const snapshot = { key: "a=1", items: [card], nextCursor: "c2", hasSizes: true, scrollY: 1200, savedAt: 1000 };
    writeSnapshot(storage, snapshot);
    expect(readSnapshot(storage, "a=1", 1000 + 60_000)).toEqual(snapshot);
    expect(readSnapshot(storage, "a=2", 1000)).toBeNull();
    expect(readSnapshot(storage, "a=1", 1000 + SNAPSHOT_MAX_AGE_MS + 1)).toBeNull();
  });

  it("ignores a broken or foreign snapshot and a storage that throws", () => {
    const storage = memoryStorage();
    storage.setItem(SNAPSHOT_STORAGE_KEY, "{not json");
    expect(readSnapshot(storage, "a=1", 0)).toBeNull();
    storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify({ key: "a=1", items: [{ nope: true }] }));
    expect(readSnapshot(storage, "a=1", 0)).toBeNull();
    const throwing = {
      ...storage,
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("full");
      },
    } as Storage;
    expect(readSnapshot(throwing, "a=1", 0)).toBeNull();
    expect(() =>
      writeSnapshot(throwing, { key: "a", items: [], nextCursor: null, hasSizes: false, scrollY: 0, savedAt: 0 }),
    ).not.toThrow();
  });
});

describe("catalogue calls", () => {
  it("reads a page with its cursor, and opens her guest session first when there is none", async () => {
    const page = { items: [card], nextCursor: null, hasSizes: false };
    const fetch = vi.fn().mockResolvedValueOnce(response(401)).mockResolvedValueOnce(response(200, page));
    const ensure = vi.fn().mockResolvedValue(undefined);
    expect(await fetchCataloguePage({ q: "robe", sort: "new" }, "abc", { fetch, ensure })).toEqual(page);
    expect(ensure).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/catalog?q=robe&sort=new&cursor=abc");
  });

  it("throws on a failed or malformed page", async () => {
    const ensure = vi.fn();
    await expect(
      fetchCataloguePage({}, null, { fetch: vi.fn().mockResolvedValue(response(500)), ensure }),
    ).rejects.toThrow();
    await expect(
      fetchCataloguePage({}, null, { fetch: vi.fn().mockResolvedValue(response(200, { items: 1 })), ensure }),
    ).rejects.toThrow();
  });

  it("« Voir plus » with a cursor from before a deployment (invalid_cursor) starts again from page 1, quietly", async () => {
    const ensure = vi.fn();
    const first = { items: [card], nextCursor: "new-cursor", hasSizes: true };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(400, { error: "invalid_cursor" }))
      .mockResolvedValueOnce(response(200, first));
    expect(await fetchMoreCatalogue({ sort: "new" }, "old-cursor", { fetch, ensure })).toEqual({
      restart: true,
      page: first,
    });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/catalog?sort=new&cursor=old-cursor",
      "/api/catalog?sort=new",
    ]);
    await expect(
      fetchCataloguePage({}, "old", {
        fetch: vi.fn().mockResolvedValue(response(400, { error: "invalid_cursor" })),
        ensure,
      }),
    ).rejects.toBeInstanceOf(StaleCatalogueCursorError);

    // A valid cursor: the next page, appended by the grid.
    const next = { items: [card], nextCursor: null, hasSizes: false };
    expect(
      await fetchMoreCatalogue({}, "c", { fetch: vi.fn().mockResolvedValue(response(200, next)), ensure }),
    ).toEqual({ restart: false, page: next });
    // Any other refusal or failure stays an error (« Réessayer »), page 1 is not asked.
    for (const failed of [response(400, { error: "invalid_request" }), response(500)]) {
      const once = vi.fn().mockResolvedValue(failed);
      await expect(fetchMoreCatalogue({}, "c", { fetch: once, ensure })).rejects.toThrow();
      expect(once).toHaveBeenCalledOnce();
    }
  });

  it("reads a sheet for her profile, or says it is not in the catalogue", async () => {
    const ensure = vi.fn();
    const fetch = vi.fn().mockResolvedValue(response(404, { error: "not_found" }));
    expect(await fetchCatalogueDetail(UUID, OTHER, { fetch, ensure })).toBe("not_found");
    expect(fetch.mock.calls[0]?.[0]).toBe(`/api/catalog/${UUID}?profile=${OTHER}`);
  });

  it("reports an article: done whatever the number of reports, failed otherwise", async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const ok = vi.fn().mockResolvedValue(response(204));
    expect(await reportArticle(UUID, "shocking", { fetch: ok, ensure })).toBe(true);
    expect(ok.mock.calls[0]?.[0]).toBe(`/api/catalog/${UUID}/report`);
    const init = ok.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "shocking" });
    expect(await reportArticle(UUID, "other", { fetch: vi.fn().mockResolvedValue(response(429)), ensure })).toBe(false);
    expect(await reportArticle(UUID, "other", { fetch: vi.fn().mockRejectedValue(new Error("off")), ensure })).toBe(
      false,
    );
  });
});

describe("« ← Découvrir » from a sheet", () => {
  it("goes back to the last « Découvrir » she saw, with its filters", () => {
    const storage = memoryStorage();
    expect(readLastDiscoverHref(storage)).toBe("/decouvrir");
    writeSnapshot(storage, {
      key: "recherche=robe",
      items: [],
      nextCursor: null,
      hasSizes: false,
      scrollY: 0,
      savedAt: 0,
    });
    expect(readLastDiscoverHref(storage)).toBe("/decouvrir?recherche=robe");
    expect(readLastDiscoverHref(null)).toBe("/decouvrir");
  });
});
