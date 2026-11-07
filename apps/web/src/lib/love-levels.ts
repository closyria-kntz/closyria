import {
  DEFAULT_LOVE_LEVEL,
  DEFAULT_LOVE_LEVELS,
  type ItemStage,
  type LoveLevel,
  type LoveLevelView,
} from "@closyria/shared";

/** The pill's tap: a wish without a level gets « J'aime », then Bof → J'aime → Mims → En feu → Bof (spec §3.2). */
export function nextLoveLevel(level: LoveLevel | null): LoveLevel {
  if (level === null) return DEFAULT_LOVE_LEVEL;
  return level === 4 ? 1 : ((level + 1) as LoveLevel);
}

/** Her name and emoji for a level; the starting ones when hers are not known. */
export function levelOf(levels: readonly LoveLevelView[], level: LoveLevel): LoveLevelView {
  const found = levels.find((candidate) => candidate.level === level);
  if (found) return found;
  const fallback = DEFAULT_LOVE_LEVELS.find((candidate) => candidate.level === level);
  if (!fallback) throw new Error(`unknown love level ${level}`);
  return fallback;
}

/** The stage changes the « … » menu offers, by the stage the item is at (spec §3.3). */
export const MENU_STAGES: Record<ItemStage, readonly ItemStage[]> = {
  spotted: ["ordered", "owned"],
  ordered: ["owned", "returned", "spotted"],
  owned: ["for_sale", "returned"],
  for_sale: ["sold", "owned"],
  sold: ["owned"],
  returned: ["spotted", "owned"],
};
