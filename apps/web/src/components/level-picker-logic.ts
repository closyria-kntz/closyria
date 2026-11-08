import type { LoveLevel } from "@closyria/shared";

/** A single click on a card photo waits this long for a second one (a double tap opens the level bubble). */
export const PHOTO_CLICK_DELAY_MS = 300;

type ClickLike = {
  detail: number;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/**
 * What a click on a card photo does: « pass » (keyboard Enter, new tab, middle click: the link works as usual),
 * « wait » (a first click: open the sheet after the delay unless a second comes), « pick » (the second click: open
 * the level bubble), « ignore » (a third click of the same burst).
 */
export function photoClickPlan(event: ClickLike): "pass" | "wait" | "pick" | "ignore" {
  if (event.detail === 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return "pass";
  }
  if (event.detail === 1) return "wait";
  return event.detail === 2 ? "pick" : "ignore";
}

/** Sparks only for the highest level, never for the others. */
export const shouldSpark = (level: LoveLevel): boolean => level === 4;

/** The radio to focus after an arrow / Home / End key, wrapping; null for any other key. */
export function stepFocus(index: number, key: string, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
