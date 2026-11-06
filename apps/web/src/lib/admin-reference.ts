import {
  type AdminProductPatch,
  type Audience,
  audienceSchema,
  type ChildDetail,
  childDetailSchema,
  type ReferenceEntry,
  type ReferenceKind,
  type Season,
  seasonSchema,
} from "@closyria/shared";
import { parsePriceCents } from "./price";

export type CategoryNode = { entry: ReferenceEntry; children: CategoryNode[]; inCycle: boolean };

const byPosition = (a: ReferenceEntry, b: ReferenceEntry) =>
  (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "fr");

/** True when walking up from `id` through `parentId` comes back to `id`. */
function isInCycle(byId: ReadonlyMap<string, ReferenceEntry>, id: string): boolean {
  const seen = new Set<string>();
  let current = byId.get(id)?.parentId;
  while (current && !seen.has(current)) {
    if (current === id) return true;
    seen.add(current);
    current = byId.get(current)?.parentId;
  }
  return false;
}

/**
 * The category tree from the flat list (`parentId`). An entry whose parent is unknown is a root, and so is
 * an entry caught in a cycle (flagged `inCycle`), so that nothing disappears from the screen.
 */
export function buildCategoryTree(entries: readonly ReferenceEntry[]): CategoryNode[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const nodes = new Map(
    entries.map((entry) => [entry.id, { entry, children: [] as CategoryNode[], inCycle: isInCycle(byId, entry.id) }]),
  );
  const roots: CategoryNode[] = [];
  for (const entry of [...entries].sort(byPosition)) {
    const node = nodes.get(entry.id);
    if (!node) continue;
    const parent = entry.parentId && !node.inCycle ? nodes.get(entry.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** Ids of every category below `id`, at any depth. */
export function descendantIds(entries: readonly ReferenceEntry[], id: string): Set<string> {
  const found = new Set<string>();
  const walk = (parent: string) => {
    for (const entry of entries) {
      if (entry.parentId === parent && !found.has(entry.id)) {
        found.add(entry.id);
        walk(entry.id);
      }
    }
  };
  walk(id);
  return found;
}

/** Every category as `{ id, label }`, in tree order, the label being its path from the root. */
export function categoryChoices(
  entries: readonly ReferenceEntry[],
  separator: string,
): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const walk = (nodes: CategoryNode[], path: string[]) => {
    for (const node of nodes) {
      const names = [...path, node.entry.name];
      out.push({ id: node.entry.id, label: names.join(separator) });
      walk(node.children, names);
    }
  };
  walk(buildCategoryTree(entries), []);
  return out;
}

/** « jean, denim » to `["jean", "denim"]`: the API trims, de-duplicates and bounds them. */
export function keywordsFromText(text: string): string[] {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter((word) => word !== "");
}

export const keywordsToText = (keywords: readonly string[]): string => keywords.join(", ");

export type ProductForm = {
  name: string;
  brand: string;
  /** Euros, as typed. */
  price: string;
  audience: Audience | "";
  childDetail: ChildDetail | "";
  categoryId: string;
  colorId: string;
  materialId: string;
  patternId: string;
  season: Season | "";
};

export const MAX_NAME = 300;
export const MAX_BRAND = 120;
const MAX_PRICE_CENTS = 100_000_000;
export const MAX_REFERENCE_NAME = 80;
const MAX_SLUG = 60;
const MAX_KEYWORD = 60;
const MAX_KEYWORDS = 100;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;

export type ProductPatchField = "name" | "brand" | "price" | "nothing";

type Normalized = Required<
  Pick<AdminProductPatch, "audience" | "childDetail" | "categoryId" | "colorId" | "materialId" | "patternId" | "season">
> & {
  name: string;
  brand: string | null;
  priceCents: number | null;
};

function normalize(form: ProductForm): Normalized | { error: "price" } {
  const price = parsePriceCents(form.price);
  if (!price.ok || (price.cents ?? 0) > MAX_PRICE_CENTS) return { error: "price" };
  const audience = audienceSchema.safeParse(form.audience);
  const childDetail = childDetailSchema.safeParse(form.childDetail);
  const season = seasonSchema.safeParse(form.season);
  return {
    name: form.name.trim(),
    brand: form.brand.trim() || null,
    priceCents: price.cents ?? null,
    audience: audience.success ? audience.data : null,
    childDetail: audience.success && audience.data === "child" && childDetail.success ? childDetail.data : null,
    categoryId: form.categoryId || null,
    colorId: form.colorId || null,
    materialId: form.materialId || null,
    patternId: form.patternId || null,
    season: season.success ? season.data : null,
  };
}

/**
 * The PATCH body for the correction form: only what changed from `initial`, a cleared field being null. An
 * empty name is refused only when the sheet had one (a sheet without a name stays correctable).
 */
export function productPatch(
  form: ProductForm,
  initial: ProductForm,
): { ok: true; patch: AdminProductPatch } | { ok: false; field: ProductPatchField } {
  const now = normalize(form);
  const before = normalize(initial);
  if ("error" in now) return { ok: false, field: "price" };
  if (now.name.length > MAX_NAME || (now.name === "" && initial.name.trim() !== ""))
    return { ok: false, field: "name" };
  if ((now.brand?.length ?? 0) > MAX_BRAND) return { ok: false, field: "brand" };
  const was: Partial<Normalized> = "error" in before ? {} : before;
  const patch: Record<string, unknown> = {};
  for (const key of [
    "name",
    "brand",
    "priceCents",
    "categoryId",
    "colorId",
    "materialId",
    "patternId",
    "season",
  ] as const) {
    if (now[key] !== was[key] && !(key === "name" && now.name === "")) patch[key] = now[key];
  }
  if (now.audience !== was.audience || now.childDetail !== was.childDetail) {
    patch.audience = now.audience;
    patch.childDetail = now.childDetail;
  }
  return Object.keys(patch).length === 0
    ? { ok: false, field: "nothing" }
    : { ok: true, patch: patch as AdminProductPatch };
}

export type ReferenceDraft = { name: string; slug: string; keywords: string; hex: string; parentId: string };

/** The body for a reference form, checked here with the API's bounds; `ok: false` means « Vérifie le nom, la teinte et les mots-clés ». */
export function referenceBody(
  kind: ReferenceKind,
  draft: ReferenceDraft,
  creating: boolean,
): { ok: true; body: Record<string, unknown> } | { ok: false } {
  const name = draft.name.trim();
  const slug = draft.slug.trim() || (creating ? slugify(name) : "");
  const keywords = keywordsFromText(draft.keywords);
  if (name === "" || name.length > MAX_REFERENCE_NAME) return { ok: false };
  if (slug.length > MAX_SLUG || !SLUG.test(slug)) return { ok: false };
  if (keywords.length > MAX_KEYWORDS || keywords.some((k) => k.length > MAX_KEYWORD)) return { ok: false };
  if (kind === "colors" && !HEX.test(draft.hex.trim())) return { ok: false };
  return {
    ok: true,
    body: {
      name,
      slug,
      keywords,
      ...(kind === "colors" ? { hex: draft.hex.trim() } : {}),
      ...(kind === "categories" ? { parentId: draft.parentId || null } : {}),
    },
  };
}

/** A reference slug from a name: lowercase letters and digits separated by single dashes ("" when nothing is left). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
