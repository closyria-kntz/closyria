import type { ItemView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import { isBareWish } from "./bare-wish";

const ID = "11111111-1111-4111-8111-111111111111";

const bare = {
  stage: "spotted",
  favorite: true,
  sizeLabel: null,
  sizeNote: null,
  notes: null,
  pricePaidCents: null,
  salePriceCents: null,
  saleChannel: null,
  nameOverride: null,
  brandOverride: null,
  categoryId: null,
  colorId: null,
  tags: [],
  wishlistIds: [],
  photos: [{ id: ID, url: "/x.jpg", width: 1, height: 1, source: "shop" }],
} as unknown as ItemView;

const filled: [string, Partial<ItemView>][] = [
  ["sizeLabel", { sizeLabel: "M" }],
  ["sizeNote", { sizeNote: "taille petit" }],
  ["notes", { notes: "à voir" }],
  ["pricePaidCents", { pricePaidCents: 1000 }],
  ["salePriceCents", { salePriceCents: 1000 }],
  ["saleChannel", { saleChannel: "Vinted" }],
  ["nameOverride", { nameOverride: "Robe" }],
  ["brandOverride", { brandOverride: "Zara" }],
  ["categoryId", { categoryId: ID }],
  ["colorId", { colorId: ID }],
  ["tags", { tags: [{ id: ID, name: "été" }] as unknown as ItemView["tags"] }],
  ["wishlistIds", { wishlistIds: [ID] }],
  ["a private photo", { photos: [{ id: ID, url: "/p.jpg", width: 1, height: 1, source: "private" }] }],
];

describe("isBareWish", () => {
  it("is true for a spotted favorite with nothing else of hers", () => {
    expect(isBareWish(bare)).toBe(true);
  });

  it.each(filled)("is false once %s is filled", (_name, patch) => {
    expect(isBareWish({ ...bare, ...patch })).toBe(false);
  });

  it.each(["ordered", "owned", "for_sale", "sold", "returned"] as const)("is false at stage %s", (stage) => {
    expect(isBareWish({ ...bare, stage })).toBe(false);
  });
});
