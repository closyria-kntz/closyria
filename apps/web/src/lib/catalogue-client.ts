import { createAuthClient, ensureSession } from "@closyria/auth/client";
import {
  type CatalogDetail,
  type CatalogPage,
  type CatalogSort,
  catalogCardSchema,
  catalogDetailSchema,
  catalogPageSchema,
  catalogSortSchema,
  type ReportReason,
  type ShopValue,
  shopValueSchema,
} from "@closyria/shared";
import { z } from "zod";
import type { ClientDeps } from "./catalog-client";

/** Browser calls to `/api/catalog…`; every answer is validated with the shared schemas. */
const defaultDeps: ClientDeps = {
  fetch: (...args) => fetch(...args),
  ensure: () => ensureSession(createAuthClient(window.location.origin)),
};

/** « Découvrir »'s address. */
export const DISCOVER_PATH = "/decouvrir";
/** Her sizes, where « Ajoute tes tailles » leads (« Mes tailles », in the settings). */
export const MY_SIZES_PATH = "/reglages/tailles";

/** The price ranges of the « Prix » filter, in euros: `min-max`, an open end left empty. */
export const PRICE_RANGES = ["0-30", "30-60", "60-100", "100-"] as const;
export type PriceRange = (typeof PRICE_RANGES)[number];

export const DEFAULT_CATALOGUE_SORT: CatalogSort = "new";
/** The longest search the API takes. */
export const MAX_CATALOGUE_SEARCH = 80;

/** The filters of « Découvrir », as the address keeps them (so the back button gives them back). */
export type CatalogueFilters = {
  /** Words to find (article, shop, « robe rouge »). */
  q?: string;
  category?: string;
  color?: string;
  price?: PriceRange;
  /** « Ma taille en stock ». */
  mySize?: true;
  shop?: string;
  /** The shop's values, all of them (made in France, second hand…). */
  values?: ShopValue[];
  /** « En baisse ». */
  onSale?: true;
  /** « Nouveautés ». */
  isNew?: true;
  sort?: CatalogSort;
};

/** One filter to take off (an active-filter chip): one value of `values`, or the whole key. */
export type FilterRef =
  | { key: Exclude<keyof CatalogueFilters, "sort" | "values"> }
  | { key: "values"; value: ShopValue };

/** Parameter names in the address (French, like the pages). */
const PARAMS = {
  q: "recherche",
  category: "type",
  color: "couleur",
  price: "prix",
  mySize: "ma-taille",
  shop: "boutique",
  values: "valeurs",
  onSale: "en-baisse",
  isNew: "nouveautes",
  sort: "tri",
} as const satisfies Record<keyof CatalogueFilters, string>;

const uuid = (value: string | null) => (z.uuid().safeParse(value).success ? (value as string) : undefined);
const isPriceRange = (value: string | null): value is PriceRange =>
  (PRICE_RANGES as readonly (string | null)[]).includes(value);

export function catalogueFiltersFromParams(params: Pick<URLSearchParams, "get">): CatalogueFilters {
  const filters: CatalogueFilters = {};
  const q = params.get(PARAMS.q)?.trim().slice(0, MAX_CATALOGUE_SEARCH).trim();
  if (q) filters.q = q;
  const category = uuid(params.get(PARAMS.category));
  if (category) filters.category = category;
  const color = uuid(params.get(PARAMS.color));
  if (color) filters.color = color;
  const price = params.get(PARAMS.price);
  if (isPriceRange(price)) filters.price = price;
  if (params.get(PARAMS.mySize) === "1") filters.mySize = true;
  const shop = uuid(params.get(PARAMS.shop));
  if (shop) filters.shop = shop;
  // In the order of the admin's list, once each.
  const asked = new Set(params.get(PARAMS.values)?.split(",") ?? []);
  const values = shopValueSchema.options.filter((value) => asked.has(value));
  if (values.length > 0) filters.values = values;
  if (params.get(PARAMS.onSale) === "1") filters.onSale = true;
  if (params.get(PARAMS.isNew) === "1") filters.isNew = true;
  const sort = catalogSortSchema.safeParse(params.get(PARAMS.sort));
  if (sort.success && sort.data !== DEFAULT_CATALOGUE_SORT) filters.sort = sort.data;
  return filters;
}

/** The address parameters for `filters`; `into` keeps the foreign ones (the profile) and replaces the filter ones. */
export function catalogueFiltersToParams(filters: CatalogueFilters, into?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(into?.toString());
  for (const name of Object.values(PARAMS)) params.delete(name);
  if (filters.q) params.set(PARAMS.q, filters.q);
  if (filters.category) params.set(PARAMS.category, filters.category);
  if (filters.color) params.set(PARAMS.color, filters.color);
  if (filters.price) params.set(PARAMS.price, filters.price);
  if (filters.mySize) params.set(PARAMS.mySize, "1");
  if (filters.shop) params.set(PARAMS.shop, filters.shop);
  if (filters.values?.length) params.set(PARAMS.values, filters.values.join(","));
  if (filters.onSale) params.set(PARAMS.onSale, "1");
  if (filters.isNew) params.set(PARAMS.isNew, "1");
  if (filters.sort && filters.sort !== DEFAULT_CATALOGUE_SORT) params.set(PARAMS.sort, filters.sort);
  return params;
}

/**
 * How many filters are on: each of the shop's values counts, the sort never does, nor « Ma taille en stock » once the
 * page said she has no sizes (`hasSizes` false: it filters nothing and its chip is not shown).
 */
export function activeCatalogueFilterCount(filters: CatalogueFilters, hasSizes: boolean | null = null): number {
  return Object.entries(filters).reduce(
    (count, [key, value]) =>
      key === "sort" || (key === "mySize" && hasSizes === false)
        ? count
        : count + (Array.isArray(value) ? value.length : 1),
    0,
  );
}

/** `filters` without one of them (an active-filter chip's ✕). */
export function withoutFilter(filters: CatalogueFilters, ref: FilterRef): CatalogueFilters {
  const next = { ...filters };
  if (ref.key === "values") {
    const values = (filters.values ?? []).filter((value) => value !== ref.value);
    if (values.length > 0) next.values = values;
    else delete next.values;
    return next;
  }
  delete next[ref.key];
  return next;
}

/** The query of `GET /api/catalog` (the cursor is added per page); prices go in cents. */
export function toCatalogueQuery(filters: CatalogueFilters, profileId: string | null): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.q) query.q = filters.q;
  if (filters.category) query.category = filters.category;
  if (filters.color) query.color = filters.color;
  if (filters.price) {
    const [min, max] = filters.price.split("-");
    if (min && min !== "0") query.priceMin = String(Number(min) * 100);
    if (max) query.priceMax = String(Number(max) * 100);
  }
  if (filters.mySize) query.mySize = "true";
  if (filters.shop) query.shop = filters.shop;
  if (filters.values?.length) query.values = filters.values.join(",");
  if (filters.onSale) query.onSale = "true";
  if (filters.isNew) query.isNew = "true";
  query.sort = filters.sort ?? DEFAULT_CATALOGUE_SORT;
  if (profileId) query.profile = profileId;
  return query;
}

// --- The pages kept for the back button: what she had loaded and where she was, for the same address. ---

export const SNAPSHOT_STORAGE_KEY = "closyria:decouvrir";
/** An older snapshot is not given back: the catalogue may have changed too much. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

const snapshotSchema = z.object({
  key: z.string(),
  items: z.array(catalogCardSchema),
  nextCursor: z.string().nullable(),
  hasSizes: z.boolean(),
  scrollY: z.number().nonnegative(),
  savedAt: z.number(),
});
export type CatalogueSnapshot = z.infer<typeof snapshotSchema>;

/** The key of an address: its parameters, sorted (the same filters in another order are the same page). */
export function snapshotKey(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params);
  sorted.sort();
  return sorted.toString();
}

/** The snapshot of the address `key`, when there is a fresh one (the storage may refuse: none then). */
export function readSnapshot(storage: Storage, key: string, now: number): CatalogueSnapshot | null {
  try {
    const raw = storage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.key !== key || now - parsed.data.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Keeps one snapshot (the last page she looked at); a full or refused storage keeps nothing. */
export function writeSnapshot(storage: Storage, snapshot: CatalogueSnapshot): void {
  try {
    storage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Nothing kept: the back button reads the first page again.
  }
}

/** « ← Découvrir » from a sheet: the address of the last « Découvrir » she saw (its filters), else « Découvrir ». */
export function readLastDiscoverHref(storage: Storage | null = sessionStorageOrNull()): string {
  try {
    const raw = storage?.getItem(SNAPSHOT_STORAGE_KEY);
    const key = raw ? z.object({ key: z.string() }).safeParse(JSON.parse(raw)) : null;
    return key?.success && key.data.key ? `${DISCOVER_PATH}?${key.data.key}` : DISCOVER_PATH;
  } catch {
    return DISCOVER_PATH;
  }
}

/** The tab's storage, or null where the browser refuses it. */
export function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** How soon after the back (or forward) button a page counts as reached by it. */
const RETURN_WINDOW_MS = 3000;
let lastHistoryMove = Number.NEGATIVE_INFINITY;
let loadChecked = false;
type TraverseEvent = Event & { navigationType?: string };
if (typeof window !== "undefined") {
  // The Navigation API tells it first, as the move starts (before the router draws the page reached back).
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("navigate", (event) => {
    if ((event as TraverseEvent).navigationType === "traverse") lastHistoryMove = Date.now();
  });
  // Capture: ahead of the router's own listener, which may draw the page reached back before the others run.
  window.addEventListener(
    "popstate",
    () => {
      lastHistoryMove = Date.now();
    },
    true,
  );
}

/**
 * Whether « Découvrir » is being reached by the back or forward button (in the app, or onto a page the browser loads
 * again): only then are the kept pages and position given back; a link to « Découvrir » starts at the top.
 */
export function reachedByHistory(now = Date.now()): boolean {
  if (now - lastHistoryMove < RETURN_WINDOW_MS) return true;
  if (loadChecked) return false;
  loadChecked = true;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "back_forward";
}

// --- Calls. ---

/** A route that wants a session: a first visit opens her guest one (as « Découvrir »'s shops do). */
async function withSession(deps: ClientDeps, path: string, signal?: AbortSignal): Promise<Response> {
  const init: RequestInit = { cache: "no-store", signal: signal ?? null };
  const response = await deps.fetch(path, init);
  if (response.status !== 401) return response;
  await deps.ensure();
  return await deps.fetch(path, init);
}

/** One page of the catalogue (24). Throws on failure. */
export async function fetchCataloguePage(
  query: Record<string, string>,
  cursor: string | null,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<CatalogPage> {
  const params = new URLSearchParams(query);
  if (cursor) params.set("cursor", cursor);
  const response = await withSession(deps, `/api/catalog?${params}`, signal);
  if (!response.ok) throw new Error(`catalog ${response.status}`);
  return catalogPageSchema.parse(await response.json());
}

/** The sheet of a catalogue article for her profile, or `not_found` when it left the catalogue. Throws on failure. */
export async function fetchCatalogueDetail(
  productId: string,
  profileId: string | null,
  deps: ClientDeps = defaultDeps,
  signal?: AbortSignal,
): Promise<CatalogDetail | "not_found"> {
  const query = profileId ? `?profile=${profileId}` : "";
  const response = await withSession(deps, `/api/catalog/${productId}${query}`, signal);
  if (response.status === 404 || response.status === 400) return "not_found";
  if (!response.ok) throw new Error(`catalog detail ${response.status}`);
  return catalogDetailSchema.parse(await response.json());
}

/** « Signaler »: true once recorded (a second report of hers changes nothing and is just as done). */
export async function reportArticle(
  productId: string,
  reason: ReportReason,
  deps: ClientDeps = defaultDeps,
): Promise<boolean> {
  try {
    await deps.ensure();
    const response = await deps.fetch(`/api/catalog/${productId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
