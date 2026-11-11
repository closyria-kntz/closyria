import { describe, expect, it } from "vitest";
import { preferencesPatchSchema, preferencesViewSchema, tipIdSchema } from "./preferences";

describe("tipIdSchema", () => {
  it("takes dashed lowercase ids only", () => {
    expect(tipIdSchema.safeParse("home-levels").success).toBe(true);
    expect(tipIdSchema.safeParse("Home levels").success).toBe(false);
    expect(tipIdSchema.safeParse("-home").success).toBe(false);
    expect(tipIdSchema.safeParse("a".repeat(41)).success).toBe(false);
  });
});

describe("preferencesPatchSchema", () => {
  it("wants something to change", () => {
    expect(preferencesPatchSchema.safeParse({}).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ seenTips: [] }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ onboarded: false }).success).toBe(false);
    expect(preferencesPatchSchema.safeParse({ onboarded: true }).success).toBe(true);
    expect(preferencesPatchSchema.safeParse({ seenTips: ["home-levels"] }).success).toBe(true);
  });

  it("refuses unknown fields", () => {
    expect(preferencesPatchSchema.safeParse({ onboarded: true, onboardedAt: null }).success).toBe(false);
  });
});

describe("preferencesViewSchema", () => {
  it("reads a fresh account", () => {
    expect(preferencesViewSchema.parse({ seenTips: [], onboardedAt: null })).toEqual({
      seenTips: [],
      onboardedAt: null,
    });
  });
});
