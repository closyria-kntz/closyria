import {
  type AdminProductPatch,
  type Audience,
  audienceSchema,
  type ChildDetail,
  childDetailSchema,
  type ReferenceEntry,
  type Season,
  seasonSchema,
} from "@closyria/shared";
import { parsePriceCents } from "./price";

export type CategoryNode = { entry: ReferenceEntry; children: CategoryNode[] };

const byPosition = (a: ReferenceEntry, b: ReferenceEntry) =>
  (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name, "fr");

/** The category tree from the flat list (`parentId`); an entry whose parent is unknown is a root. */
export function buildCategoryTree(entries: readonly ReferenceEntry[]): CategoryNode[] {
  const nodes = new Map(entries.map((entry) => [entry.id, { entry, children: [] as CategoryNode[] }]));
  const roots: CategoryNode[] = [];
  for (const entry of [...entries].sort(byPosition)) {
    const node = nodes.get(entry.id);
    if (!node) continue;
    const parent = entry.parentId ? nodes.get(entry.parentId) : undefined;
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

/** The PATCH body for the correction form; a cleared field becomes null, the child detail only goes with « Enfant ». */
export function productPatch(
  form: ProductForm,
): { ok: true; patch: AdminProductPatch } | { ok: false; field: "name" | "price" } {
  const name = form.name.trim();
  if (name === "") return { ok: false, field: "name" };
  const price = parsePriceCents(form.price);
  if (!price.ok) return { ok: false, field: "price" };
  const audience = audienceSchema.safeParse(form.audience);
  const childDetail = childDetailSchema.safeParse(form.childDetail);
  const season = seasonSchema.safeParse(form.season);
  return {
    ok: true,
    patch: {
      name,
      brand: form.brand.trim() || null,
      priceCents: price.cents ?? null,
      audience: audience.success ? audience.data : null,
      childDetail: audience.success && audience.data === "child" && childDetail.success ? childDetail.data : null,
      categoryId: form.categoryId || null,
      colorId: form.colorId || null,
      materialId: form.materialId || null,
      patternId: form.patternId || null,
      season: season.success ? season.data : null,
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
