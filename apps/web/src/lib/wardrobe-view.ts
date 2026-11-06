import {
  type Audience,
  audienceSchema,
  type ItemListQuery,
  type ItemSort,
  type ItemStage,
  itemSortSchema,
  MAX_BULK_ITEMS,
} from "@closyria/shared";
import { z } from "zod";

/** Envies, Commandé, Dressing, À vendre: one stage each; `sold` and `returned` are reached by the « Étape » filter. */
export const VIEWS = {
  envies: { stage: "spotted", path: "/envies" },
  commande: { stage: "ordered", path: "/commande" },
  dressing: { stage: "owned", path: "/dressing" },
  "a-vendre": { stage: "for_sale", path: "/a-vendre" },
} as const satisfies Record<string, { stage: ItemStage; path: string }>;
export type ViewKey = keyof typeof VIEWS;

/** Toggles `id` in a selection capped at `max`: `refused` when adding would go beyond it. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  id: string,
  max: number = MAX_BULK_ITEMS,
): { next: ReadonlySet<string>; refused: boolean } {
  const next = new Set(selected);
  if (next.delete(id)) return { next, refused: false };
  if (next.size >= max) return { next: selected, refused: true };
  next.add(id);
  return { next, refused: false };
}

export const STAGE_FILTER_OPTIONS = ["sold", "returned"] as const satisfies readonly ItemStage[];
export const DEFAULT_SORT: ItemSort = "recent";

export function viewForPath(pathname: string): ViewKey | null {
  const found = (Object.entries(VIEWS) as [ViewKey, (typeof VIEWS)[ViewKey]][]).find(
    ([, view]) => view.path === pathname,
  );
  return found ? found[0] : null;
}

export type ViewFilters = {
  favorite?: true;
  shop?: string;
  category?: string;
  color?: string;
  audience?: Audience;
  tag?: string;
  sort?: ItemSort;
  /** `sold` or `returned`, replacing the view's own stage. */
  stage?: (typeof STAGE_FILTER_OPTIONS)[number];
};

/** Parameter names in the address (French, like the pages). */
const PARAMS = {
  favorite: "favori",
  shop: "boutique",
  category: "type",
  color: "couleur",
  audience: "public",
  tag: "etiquette",
  sort: "tri",
  stage: "etape",
} as const;

const uuid = (value: string | null) => (z.uuid().safeParse(value).success ? (value as string) : undefined);

export function filtersFromParams(params: Pick<URLSearchParams, "get">): ViewFilters {
  const filters: ViewFilters = {};
  if (params.get(PARAMS.favorite) === "1") filters.favorite = true;
  const shop = uuid(params.get(PARAMS.shop));
  if (shop) filters.shop = shop;
  const category = uuid(params.get(PARAMS.category));
  if (category) filters.category = category;
  const color = uuid(params.get(PARAMS.color));
  if (color) filters.color = color;
  const audience = audienceSchema.safeParse(params.get(PARAMS.audience));
  if (audience.success) filters.audience = audience.data;
  const tag = uuid(params.get(PARAMS.tag));
  if (tag) filters.tag = tag;
  const sort = itemSortSchema.safeParse(params.get(PARAMS.sort));
  if (sort.success && sort.data !== DEFAULT_SORT) filters.sort = sort.data;
  const stage = params.get(PARAMS.stage);
  if (stage === "sold" || stage === "returned") filters.stage = stage;
  return filters;
}

/** The address parameters for `filters`; `into` keeps the foreign ones (the profile) and replaces the filter ones. */
export function filtersToParams(filters: ViewFilters, into?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(into?.toString());
  for (const name of Object.values(PARAMS)) params.delete(name);
  if (filters.favorite) params.set(PARAMS.favorite, "1");
  if (filters.shop) params.set(PARAMS.shop, filters.shop);
  if (filters.category) params.set(PARAMS.category, filters.category);
  if (filters.color) params.set(PARAMS.color, filters.color);
  if (filters.audience) params.set(PARAMS.audience, filters.audience);
  if (filters.tag) params.set(PARAMS.tag, filters.tag);
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set(PARAMS.sort, filters.sort);
  if (filters.stage) params.set(PARAMS.stage, filters.stage);
  return params;
}

/** How many filters are on (the sort is not a filter). */
export const activeFilterCount = (filters: ViewFilters): number =>
  Object.keys(filters).filter((key) => key !== "sort").length;

/** The query of `GET /api/me/items` for a view with its filters (the cursor is added per page). */
export function toItemQuery(view: ViewKey, filters: ViewFilters, profileId: string | null): Record<string, string> {
  const query: Record<string, string> = { stage: filters.stage ?? VIEWS[view].stage };
  if (profileId) query.profile = profileId;
  if (filters.favorite) query.favorite = "true";
  if (filters.shop) query.shop = filters.shop;
  if (filters.category) query.category = filters.category;
  if (filters.color) query.color = filters.color;
  if (filters.audience) query.audience = filters.audience;
  if (filters.tag) query.tag = filters.tag;
  if (filters.sort) query.sort = filters.sort;
  return query satisfies Partial<Record<keyof ItemListQuery, string>>;
}

/** « Load more » progress of the current first page (a generation); answers of an older generation are ignored. */
export type MoreState = { generation: number; loading: boolean; failed: boolean };
export type MoreAction =
  | { type: "reset"; generation: number }
  | { type: "start"; generation: number }
  | { type: "end"; generation: number; failed: boolean };

export const initialMoreState: MoreState = { generation: 0, loading: false, failed: false };

export function moreReducer(state: MoreState, action: MoreAction): MoreState {
  if (action.type === "reset") return { generation: action.generation, loading: false, failed: false };
  if (action.generation !== state.generation) return state;
  if (action.type === "start") return { ...state, loading: true, failed: false };
  return { ...state, loading: false, failed: action.failed };
}
