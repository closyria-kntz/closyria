import {
  type Audience,
  audienceSchema,
  type ItemListQuery,
  type ItemSort,
  type ItemStage,
  type ItemView,
  itemSortSchema,
  type LoveLevel,
  loveLevelSchema,
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
  shop?: string;
  category?: string;
  color?: string;
  audience?: Audience;
  tag?: string;
  /** Her levels to show, highest first (`niveau=4,3`). */
  levels?: LoveLevel[];
  /** Only the « Prioritaire » items (`prioritaire=1`). */
  priority?: true;
  sort?: ItemSort;
  /** `sold` or `returned`, replacing the view's own stage. */
  stage?: (typeof STAGE_FILTER_OPTIONS)[number];
};

/** Parameter names in the address (French, like the pages). */
const PARAMS = {
  shop: "boutique",
  category: "type",
  color: "couleur",
  audience: "public",
  tag: "etiquette",
  levels: "niveau",
  priority: "prioritaire",
  sort: "tri",
  stage: "etape",
} as const;

/** `4,3` → [4, 3]: the valid levels, once each, highest first. */
function levelsOf(value: string | null): LoveLevel[] {
  const levels = new Set<LoveLevel>();
  for (const part of value?.split(",") ?? []) {
    const level = loveLevelSchema.safeParse(Number(part));
    if (part !== "" && level.success) levels.add(level.data);
  }
  return [...levels].sort((a, b) => b - a);
}

const uuid = (value: string | null) => (z.uuid().safeParse(value).success ? (value as string) : undefined);

export function filtersFromParams(params: Pick<URLSearchParams, "get">): ViewFilters {
  const filters: ViewFilters = {};
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
  const levels = levelsOf(params.get(PARAMS.levels));
  if (levels.length > 0) filters.levels = levels;
  if (params.get(PARAMS.priority) === "1") filters.priority = true;
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
  if (filters.shop) params.set(PARAMS.shop, filters.shop);
  if (filters.category) params.set(PARAMS.category, filters.category);
  if (filters.color) params.set(PARAMS.color, filters.color);
  if (filters.audience) params.set(PARAMS.audience, filters.audience);
  if (filters.tag) params.set(PARAMS.tag, filters.tag);
  if (filters.levels?.length) params.set(PARAMS.levels, filters.levels.join(","));
  if (filters.priority) params.set(PARAMS.priority, "1");
  if (filters.sort && filters.sort !== DEFAULT_SORT) params.set(PARAMS.sort, filters.sort);
  if (filters.stage) params.set(PARAMS.stage, filters.stage);
  return params;
}

/** The address text of `params`, with the commas of `niveau=4,3` left plain (same meaning, easier to read). */
export const paramsText = (params: URLSearchParams): string => params.toString().replaceAll("%2C", ",");

/** How many filters are on (the sort is not a filter). */
export const activeFilterCount = (filters: ViewFilters): number =>
  Object.keys(filters).filter((key) => key !== "sort").length;

/** The query of `GET /api/me/items` for a view with its filters (the cursor is added per page). */
export function toItemQuery(view: ViewKey, filters: ViewFilters, profileId: string | null): Record<string, string> {
  const query: Record<string, string> = { stage: filters.stage ?? VIEWS[view].stage };
  if (profileId) query.profile = profileId;
  if (filters.shop) query.shop = filters.shop;
  if (filters.category) query.category = filters.category;
  if (filters.color) query.color = filters.color;
  if (filters.audience) query.audience = filters.audience;
  if (filters.tag) query.tag = filters.tag;
  if (filters.levels?.length) query.loveLevel = filters.levels.join(",");
  if (filters.priority) query.priority = "true";
  if (filters.sort) query.sort = filters.sort;
  return query satisfies Partial<Record<keyof ItemListQuery, string>>;
}

/**
 * Whether a card changed in place (pill, « … » menu) still belongs to the view: its stage, its profile, and the
 * filters she can change from the card (tag, level, priority). The others (shop, type…) do not change there.
 */
export function stillShown(
  item: ItemView,
  stage: ItemStage,
  profileId: string | null,
  filters: { tag?: string | undefined; levels?: readonly LoveLevel[] | undefined; priority?: boolean | undefined },
): boolean {
  if (item.stage !== stage) return false;
  if (profileId !== null && item.profileId !== profileId) return false;
  if (filters.tag && !item.tags.some((tag) => tag.id === filters.tag)) return false;
  if (filters.levels?.length && (item.loveLevel === null || !filters.levels.includes(item.loveLevel))) return false;
  if (filters.priority && !item.priority) return false;
  return true;
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
