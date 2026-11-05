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
 * (in this order): breadcrumb, shop category, name, shop tags, address path. The audience is never guessed from
 * the name alone.
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
  const noName = [...breadcrumb, ...category, ...tags, ...path];
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

  const audienceText = ` ${noName.join(" ")} `;
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
