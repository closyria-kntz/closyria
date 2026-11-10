import { describe, expect, it } from "vitest";
import {
  giftCheckSchema,
  giftDateSchema,
  giftDeleteSchema,
  giftInputSchema,
  giftOccasionSchema,
  giftReminderActionSchema,
  sharedGiftStateSchema,
  sharedGiftsSchema,
} from "./gifts";
import { wishlistViewSchema } from "./wardrobe";

const deviceKey = "a".repeat(22);
const id = "6f1c1d1e-8b0a-4c1e-9a53-2f6f0f5c3a11";

describe("giftOccasionSchema", () => {
  it("accepts a short occasion and refuses long text or web addresses", () => {
    expect(giftOccasionSchema.safeParse("mon anniversaire").success).toBe(true);
    expect(giftOccasionSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(giftOccasionSchema.safeParse("a".repeat(40)).success).toBe(true);
    expect(giftOccasionSchema.safeParse("voir zara.com").success).toBe(false);
    expect(giftOccasionSchema.safeParse("   ").success).toBe(false);
  });
});

describe("giftDateSchema", () => {
  it("wants YYYY-MM-DD", () => {
    expect(giftDateSchema.safeParse("2027-03-12").success).toBe(true);
    expect(giftDateSchema.safeParse("12/03/2027").success).toBe(false);
  });
});

describe("gift inputs", () => {
  it("validates name and device key", () => {
    expect(giftInputSchema.safeParse({ name: "Léa", deviceKey, intent: "reserve" }).success).toBe(true);
    expect(giftInputSchema.safeParse({ name: "Léa", deviceKey, intent: "join", claim: true }).success).toBe(true);
    expect(giftInputSchema.safeParse({ name: "Léa", deviceKey }).success).toBe(false);
    expect(giftInputSchema.safeParse({ name: "Léa", deviceKey, intent: "take" }).success).toBe(false);
    expect(giftInputSchema.safeParse({ name: "", deviceKey, intent: "reserve" }).success).toBe(false);
    expect(giftDeleteSchema.safeParse({ name: "Léa", deviceKey: "x" }).success).toBe(false);
  });
  it("check and reminder action", () => {
    expect(giftCheckSchema.safeParse({ reserved: [id] }).success).toBe(true);
    expect(giftCheckSchema.safeParse({ reserved: ["x"] }).success).toBe(false);
    expect(giftReminderActionSchema.safeParse({ action: "snooze" }).success).toBe(true);
    expect(giftReminderActionSchema.safeParse({ action: "nope" }).success).toBe(false);
  });
});

describe("sharedGiftStateSchema", () => {
  it("accepts the four states and refuses unknown ones", () => {
    expect(sharedGiftStateSchema.safeParse({ state: "free" }).success).toBe(true);
    expect(
      sharedGiftStateSchema.safeParse({ state: "reserved", reserver: "Léa", contributors: ["Zoé"], mine: null })
        .success,
    ).toBe(true);
    expect(
      sharedGiftStateSchema.safeParse({
        state: "owner_took",
        givers: ["Léa"],
        mine: { role: "contributor", name: "Léa" },
      }).success,
    ).toBe(true);
    expect(sharedGiftStateSchema.safeParse({ state: "removed", mine: { role: "reserver", name: "Léa" } }).success).toBe(
      true,
    );
    expect(sharedGiftStateSchema.safeParse({ state: "removed", mine: "reserver" }).success).toBe(false);
    expect(sharedGiftStateSchema.safeParse({ state: "removed", mine: null }).success).toBe(false);
    expect(sharedGiftStateSchema.safeParse({ state: "weird" }).success).toBe(false);
  });
  it("shared gifts block", () => {
    expect(sharedGiftsSchema.safeParse({ open: true, occasion: null, date: "2027-03-12" }).success).toBe(true);
  });
});

describe("wishlistViewSchema", () => {
  it("requires giftReminderDue", () => {
    const w = {
      id,
      name: "Été",
      itemIds: [],
      shared: false,
      sharedAt: null,
      position: 0,
      allowOpinions: true,
      showOwnerName: true,
      showOwnerOpinions: true,
      showBudget: false,
      newOpinions: 0,
      allowGifts: false,
      giftOccasion: null,
      giftDate: null,
      giftReminderDue: false,
      groupOrder: null,
    };
    expect(wishlistViewSchema.safeParse(w).success).toBe(true);
    const { giftReminderDue: _, ...without } = w;
    expect(wishlistViewSchema.safeParse(without).success).toBe(false);
  });
});
