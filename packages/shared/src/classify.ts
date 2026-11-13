import type { ShopData } from "./catalog";
import type { Audience, ChildDetail, Season } from "./wardrobe";

export type ReferenceSet = {
  categories: { id: string; parentId: string | null; keywords: string[] }[];
  colors: { id: string; keywords: string[] }[];
  materials: { id: string; keywords: string[] }[];
  patterns: { id: string; keywords: string[] }[];
};

export type Classification = {
  audience?: Audience;
  childDetail?: ChildDetail;
  categoryId?: string;
  colorId?: string;
  materialId?: string;
  patternId?: string;
  season?: Season;
};

export type ClassifyInput = { name: string; url: string; shopData: ShopData };

/** Lowercase, no accents, every non letter/digit run turned into one space, padded: words are then ` word `. */
function normalize(text: string): string {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return ` ${words} `;
}

/** Whole-word / whole-phrase match on normalized text. */
function has(haystack: string, keyword: string): boolean {
  const k = normalize(keyword);
  return k.trim() !== "" && haystack.includes(k);
}

function pathText(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return "";
  }
}

const AUDIENCE_WORDS: [RegExp, Audience][] = [
  [/ (femme|femmes|women|woman|dame|dames) /, "women"],
  [/ (homme|hommes|men|man) /, "men"],
  [/ (enfant|enfants|kids|kid|fille|filles|garcon|garcons|bebe|bebes|baby) /, "child"],
];
const CHILD_DETAIL_WORDS: [RegExp, ChildDetail][] = [
  [/ (bebe|bebes|baby) /, "baby"],
  [/ (fille|filles|girl|girls) /, "girl"],
  [/ (garcon|garcons|boy|boys) /, "boy"],
];
const SEASON_WORDS: [RegExp, Season][] = [
  [/ (ete|summer|maillot|maillots) /, "summer"],
  [/ (hiver|winter|doudoune|doudounes|manteau|manteaux) /, "winter"],
];

/**
 * Files a product into the reference lists by keywords. Pure: the caller passes the lists. Text searched
 * (in this order): breadcrumb, shop category, name, shop tags, address path. The audience comes from the
 * breadcrumb, shop category and address path only (never the name or the tags).
 */
export function classify(input: ClassifyInput, ref: ReferenceSet): Classification {
  const { shopData } = input;
  const breadcrumb = (shopData.breadcrumb ?? []).map(normalize);
  const category = shopData.category ? [normalize(shopData.category)] : [];
  const name = [normalize(input.name)];
  const tags = (shopData.tags ?? []).map(normalize);
  const path = [normalize(pathText(input.url))];
  const colors = (shopData.colors ?? []).map(normalize);
  const material = shopData.material ? [normalize(shopData.material)] : [];

  const allText = [...breadcrumb, ...category, ...name, ...tags, ...path];
  // Structure only: no name, no tags (a brand such as « Comme des Garçons » must not mean child).
  const structure = [...breadcrumb, ...category, ...path];
  const result: Classification = {};

  // Category: the deepest one with a keyword; ties go to the first found in text order.
  const depthOf = new Map<string, number>();
  const parentOf = new Map(ref.categories.map((c) => [c.id, c.parentId]));
  const depth = (id: string): number => {
    const known = depthOf.get(id);
    if (known !== undefined) return known;
    depthOf.set(id, 0); // cycle guard
    const parent = parentOf.get(id);
    const d = parent ? depth(parent) + 1 : 0;
    depthOf.set(id, d);
    return d;
  };
  let bestDepth = -1;
  for (const text of allText) {
    for (const c of ref.categories) {
      if (depth(c.id) > bestDepth && c.keywords.some((k) => has(text, k))) {
        bestDepth = depth(c.id);
        result.categoryId = c.id;
      }
    }
  }

  /** First text (in order) that matches wins; within it, the entry with the longest matching keyword. */
  const pick = (items: { id: string; keywords: string[] }[], texts: string[]): string | undefined => {
    for (const text of texts) {
      let best: { id: string; length: number } | undefined;
      for (const item of items) {
        for (const k of item.keywords) {
          const length = normalize(k).length;
          if (has(text, k) && (!best || length > best.length)) best = { id: item.id, length };
        }
      }
      if (best) return best.id;
    }
    return undefined;
  };
  const colorId = pick(ref.colors, [...colors, ...name, ...tags, ...category, ...breadcrumb, ...path]);
  if (colorId) result.colorId = colorId;
  const materialId = pick(ref.materials, [...material, ...name, ...tags, ...category, ...breadcrumb]);
  if (materialId) result.materialId = materialId;
  const patternId = pick(ref.patterns, [...name, ...tags, ...category, ...breadcrumb, ...path]);
  if (patternId) result.patternId = patternId;

  const audienceText = ` ${structure.join(" ")} `;
  const audience = AUDIENCE_WORDS.find(([re]) => re.test(audienceText))?.[1];
  if (audience) {
    result.audience = audience;
    if (audience === "child") {
      const detail = CHILD_DETAIL_WORDS.find(([re]) => re.test(audienceText))?.[1];
      if (detail) result.childDetail = detail;
    }
  }

  const seasonText = ` ${allText.join(" ")} `;
  const season = SEASON_WORDS.find(([re]) => re.test(seasonText))?.[1];
  if (season) result.season = season;

  return result;
}

export type CatalogueClassifyInput = {
  productType: string | null;
  tags: string[];
  /** Shopify options, e.g. `{ name: "Couleur", values: ["Bordeaux"] }`. */
  options: { name: string; values: string[] }[];
  name: string;
};
export type CatalogueReference = {
  categories: { id: string; parentId?: string | null; keywords: string[] }[];
  colors: { id: string; keywords: string[] }[];
};

const COLOR_OPTION = /^(couleur|couleurs|color|colour|colors|colours)$/;

/**
 * Files an imported Shopify product into category and colour by reference keywords (whole words, no accents, no case).
 * Category: product type, then tags, then name; the deepest matching category wins inside one source, the longest
 * keyword on ties. Colour: « Couleur/Color » option, then tags, then name. Pure: the caller passes the lists.
 */
export function classifyCatalogue(
  input: CatalogueClassifyInput,
  reference: CatalogueReference,
): { categoryId: string | null; colorId: string | null } {
  const parentOf = new Map(reference.categories.map((c) => [c.id, c.parentId ?? null]));
  const depth = (id: string, seen = new Set<string>()): number => {
    const parent = parentOf.get(id);
    if (!parent || seen.has(id)) return 0;
    seen.add(id);
    return 1 + depth(parent, seen);
  };

  const categorySources = [input.productType ? [input.productType] : [], input.tags, [input.name]];
  let categoryId: string | null = null;
  for (const source of categorySources) {
    const texts = source.map(normalize);
    let best: { id: string; depth: number; length: number } | undefined;
    for (const c of reference.categories) {
      for (const k of c.keywords) {
        if (!texts.some((t) => has(t, k))) continue;
        const candidate = { id: c.id, depth: depth(c.id), length: normalize(k).length };
        if (!best || candidate.depth > best.depth || (candidate.depth === best.depth && candidate.length > best.length))
          best = candidate;
      }
    }
    if (best) {
      categoryId = best.id;
      break;
    }
  }

  const optionValues = input.options
    .filter((o) => COLOR_OPTION.test(normalize(o.name).trim()))
    .flatMap((o) => o.values);
  let colorId: string | null = null;
  for (const source of [optionValues, input.tags, [input.name]]) {
    const texts = source.map(normalize);
    let best: { id: string; length: number } | undefined;
    for (const c of reference.colors)
      for (const k of c.keywords) {
        const length = normalize(k).length;
        if (texts.some((t) => has(t, k)) && (!best || length > best.length)) best = { id: c.id, length };
      }
    if (best) {
      colorId = best.id;
      break;
    }
  }
  return { categoryId, colorId };
}
