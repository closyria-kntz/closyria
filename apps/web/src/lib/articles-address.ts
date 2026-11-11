import type { ViewKey } from "./wardrobe-view";

/**
 * « Mes articles » (refonte Boudoir, spec §3.1): one address, `/articles`, the step in `?etape=`. Until « Tout »
 * arrives (task 3) a step still shows one of the four views; the old addresses redirect here with their query.
 */
export const ARTICLES_PATH = "/articles";
export const STEP_PARAM = "etape";

/** The step values of the address and the view each shows. */
const STEP_VIEWS = {
  envie: "envies",
  commande: "commande",
  dressing: "dressing",
  "a-vendre": "a-vendre",
} as const satisfies Record<string, ViewKey>;
type Step = keyof typeof STEP_VIEWS;

const isStep = (value: string | null): value is Step => value !== null && Object.hasOwn(STEP_VIEWS, value);

type Params = Pick<URLSearchParams, "get">;

/** The view of `/articles` for its address: the step, « Envies » without one. */
export function articlesView(params: Params): ViewKey {
  const step = params.get(STEP_PARAM);
  if (isStep(step)) return STEP_VIEWS[step];
  return "envies";
}

/** The old view addresses and the step parameters they become. */
const OLD_VIEWS = {
  envies: [[STEP_PARAM, "envie"]],
  dressing: [[STEP_PARAM, "dressing"]],
  "a-vendre": [[STEP_PARAM, "a-vendre"]],
  commande: [[STEP_PARAM, "commande"]],
} as const satisfies Record<ViewKey, readonly (readonly [string, string])[]>;

type SearchRecord = Record<string, string | string[] | undefined>;

/** The « Étape » filter of the old views (`etape=sold|returned`), now `statut` (`etape` is the step). */
const STAGE_FILTER_PARAM = "statut";

/**
 * Where an old view address (`/envies?liste=…&prioritaire=1`) leads: `/articles` with its step first, then every
 * parameter it had, in order; its « Étape » filter (`etape=sold`) becomes `statut=sold`.
 */
export function oldViewRedirect(view: ViewKey, search: SearchRecord): string {
  const params = new URLSearchParams();
  for (const [name, value] of OLD_VIEWS[view]) params.set(name, value);
  for (const [name, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(name === STEP_PARAM ? STAGE_FILTER_PARAM : name, one);
    }
  }
  return `${ARTICLES_PATH}?${params.toString().replaceAll("%2C", ",")}`;
}
