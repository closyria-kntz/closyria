import { DEFAULT_LOVE_LEVELS } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import { levelOf, MENU_STAGES, nextLoveLevel } from "./love-levels";

describe("nextLoveLevel", () => {
  it("gives « J'aime » to a wish without a level", () => {
    expect(nextLoveLevel(null)).toBe(2);
  });

  it("goes round Bof → J'aime → Mims → En feu → Bof", () => {
    expect(nextLoveLevel(1)).toBe(2);
    expect(nextLoveLevel(2)).toBe(3);
    expect(nextLoveLevel(3)).toBe(4);
    expect(nextLoveLevel(4)).toBe(1);
  });
});

describe("levelOf", () => {
  it("finds her name and emoji for a level, the starting one when missing", () => {
    const mine = [{ level: 3, emoji: "💖", label: "Coup de cœur" }] as const;
    expect(levelOf(mine, 3)).toEqual({ level: 3, emoji: "💖", label: "Coup de cœur" });
    expect(levelOf(mine, 4)).toEqual(DEFAULT_LOVE_LEVELS[3]);
  });
});

describe("MENU_STAGES", () => {
  it("offers the next steps of each stage, never the stage itself", () => {
    expect(MENU_STAGES.spotted).toEqual(["ordered", "owned"]);
    expect(MENU_STAGES.ordered).toEqual(["owned", "returned", "spotted"]);
    for (const [stage, targets] of Object.entries(MENU_STAGES)) expect(targets).not.toContain(stage);
  });
});
