import { paramsText, type Step, type ViewKey } from "./wardrobe-view";

/**
 * « Mes articles » (refonte Boudoir, spec §3.1): one address, `/articles`, the step in `?etape=` (none: « Tout »);
 * the old addresses redirect here with their query.
 */
export const ARTICLES_PATH = "/articles";
export const STEP_PARAM = "etape";
/** « Commandes groupées », the third tab of « Mes articles ». */
export const GROUP_ORDERS_PATH = "/articles/commandes-groupees";
/** « Par étape » (the columns, on a computer): `vue=etapes`, on « Tout » only. */
export const BOARD_PARAM = "vue";
export const BOARD_VALUE = "etapes";

/** The step values of the address and the view each shows. */
const STEP_VIEWS = {
  envie: "envies",
  commande: "commande",
  recu: "recu",
  dressing: "dressing",
  "a-vendre": "a-vendre",
} as const satisfies Record<Step, ViewKey>;

/** The steps, in the order of the chips. */
export const STEPS = Object.keys(STEP_VIEWS) as Step[];

const isStep = (value: string | null): value is Step => value !== null && Object.hasOwn(STEP_VIEWS, value);

type Params = Pick<URLSearchParams, "get">;

/** The view of `/articles` for its address: the step, « Tout » without one. */
export function articlesView(params: Params): ViewKey {
  const step = params.get(STEP_PARAM);
  if (isStep(step)) return STEP_VIEWS[step];
  return "tout";
}

/** The step of a view (null: « Tout »). */
export function viewStep(view: ViewKey): Step | null {
  return STEPS.find((step) => STEP_VIEWS[step] === view) ?? null;
}

/**
 * What a step's own page holds and another step must not inherit: the list tab, the preview, the status filter, the
 * columns of « Tout ».
 */
const STEP_ONLY_PARAMS = ["liste", "apercu", "statut", "preparer", BOARD_PARAM];

/** `/articles` at `step` (null: « Tout »), keeping the profile and the filters of `params`. */
export function articlesHref(params: URLSearchParams, step: Step | null): string {
  const next = new URLSearchParams();
  if (step) next.set(STEP_PARAM, step);
  for (const [name, value] of params) {
    if (name !== STEP_PARAM && !STEP_ONLY_PARAMS.includes(name)) next.append(name, value);
  }
  const text = paramsText(next);
  return text ? `${ARTICLES_PATH}?${text}` : ARTICLES_PATH;
}

/** The old view addresses and the step parameters they become. */
const OLD_VIEWS = {
  envies: [[STEP_PARAM, "envie"]],
  dressing: [[STEP_PARAM, "dressing"]],
  "a-vendre": [[STEP_PARAM, "a-vendre"]],
  commande: [[STEP_PARAM, "commande"]],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;
type OldView = keyof typeof OLD_VIEWS;

type SearchRecord = Record<string, string | string[] | undefined>;

/** The « Étape » filter of the old views (`etape=sold|returned`), now `statut` (`etape` is the step). */
const STAGE_FILTER_PARAM = "statut";

/**
 * Where an old view address (`/envies?liste=…&prioritaire=1`) leads: `/articles` with its step first, then every
 * parameter it had, in order; its « Étape » filter (`etape=sold`) becomes `statut=sold`.
 */
export function oldViewRedirect(view: OldView, search: SearchRecord): string {
  const params = new URLSearchParams();
  for (const [name, value] of OLD_VIEWS[view]) params.set(name, value);
  for (const [name, value] of Object.entries(search)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(name === STEP_PARAM ? STAGE_FILTER_PARAM : name, one);
    }
  }
  return `${ARTICLES_PATH}?${params.toString().replaceAll("%2C", ",")}`;
}
