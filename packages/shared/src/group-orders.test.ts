import { describe, expect, it } from "vitest";
import {
  computeGroupOrderTotals,
  friendLineInputSchema,
  groupOrderCreateSchema,
  ownerGroupOrderSchema,
  sharedGroupOrderSchema,
} from "./group-orders";

const person = (key: string, linesCents: number[], isOwner = false) => ({ key, isOwner, linesCents });

describe("computeGroupOrderTotals", () => {
  it("shares a round shipping equally", () => {
    const r = computeGroupOrderTotals({
      people: [person("fondatrice", [1000], true), person("lea", [2000]), person("zoe", [3000])],
      shippingCents: 690,
      freeFromCents: null,
    });
    expect(r.remainingForFreeCents).toBeNull();
    expect(r.shippingTotalCents).toBe(690);
    expect(r.totalCents).toBe(6000);
    for (const k of ["fondatrice", "lea", "zoe"]) expect(r.perPerson[k]?.shippingCents).toBe(230);
    expect(r.perPerson.lea).toEqual({ itemsCents: 2000, shippingCents: 230, totalCents: 2230 });
  });

  it("gives the remainder cents to the owner", () => {
    const r = computeGroupOrderTotals({
      people: [person("lea", [1000]), person("fondatrice", [1000], true), person("zoe", [1000])],
      shippingCents: 700,
      freeFromCents: null,
    });
    expect(r.perPerson.fondatrice?.shippingCents).toBe(234);
    expect(r.perPerson.lea?.shippingCents).toBe(233);
    expect(r.perPerson.zoe?.shippingCents).toBe(233);
    expect(r.shippingTotalCents).toBe(700);
  });

  it("gives the remainder to the first person when the owner has no line", () => {
    const r = computeGroupOrderTotals({
      people: [person("fondatrice", [], true), person("ana", [500]), person("lea", [500]), person("zoe", [500])],
      shippingCents: 700,
      freeFromCents: null,
    });
    expect(r.perPerson.ana?.shippingCents).toBe(234);
    expect(r.perPerson.lea?.shippingCents).toBe(233);
    expect(r.perPerson.zoe?.shippingCents).toBe(233);
    expect(r.perPerson.fondatrice).toBeUndefined();
  });

  it("shows what is missing for free shipping, then drops it", () => {
    const below = computeGroupOrderTotals({
      people: [person("lea", [2700]), person("zoe", [3000])],
      shippingCents: 600,
      freeFromCents: 8000,
    });
    expect(below.totalCents).toBe(5700);
    expect(below.remainingForFreeCents).toBe(2300);
    expect(below.shippingTotalCents).toBe(600);
    const reached = computeGroupOrderTotals({
      people: [person("lea", [5000]), person("zoe", [3000])],
      shippingCents: 600,
      freeFromCents: 8000,
    });
    expect(reached.remainingForFreeCents).toBe(0);
    expect(reached.shippingTotalCents).toBe(0);
    expect(reached.perPerson.lea?.shippingCents).toBe(0);
    expect(reached.perPerson.zoe?.totalCents).toBe(3000);
  });

  it("ignores people without a line", () => {
    const r = computeGroupOrderTotals({
      people: [person("lea", [1000]), person("zoe", [])],
      shippingCents: 500,
      freeFromCents: null,
    });
    expect(r.perPerson.zoe).toBeUndefined();
    expect(r.perPerson.lea?.shippingCents).toBe(500);
  });

  it("is empty without any line", () => {
    const r = computeGroupOrderTotals({ people: [person("lea", [])], shippingCents: 500, freeFromCents: 8000 });
    expect(r.totalCents).toBe(0);
    expect(r.shippingTotalCents).toBe(0);
    expect(r.remainingForFreeCents).toBe(8000);
    expect(r.perPerson).toEqual({});
  });

  it("two first lines at once stay consistent with the total (10 euros left)", () => {
    const people = [person("lea", [4500]), person("zoe", [2500])];
    const r = computeGroupOrderTotals({ people, shippingCents: 690, freeFromCents: 8000 });
    expect(r.remainingForFreeCents).toBe(1000);
    const sum = Object.values(r.perPerson).reduce((n, p) => n + p.shippingCents, 0);
    expect(sum).toBe(r.shippingTotalCents);
  });
});

const device = "a".repeat(22);
const base = { name: "Léa", deviceKey: device, sizeLabel: "M", quantity: 1 };

describe("friendLineInputSchema", () => {
  const itemLine = { ...base, source: "item", itemId: "7b6f1c52-1c5e-4c1b-9a53-0f0b7a1f7a11" };
  it("accepts an item line", () => {
    expect(friendLineInputSchema.safeParse(itemLine).success).toBe(true);
  });
  it("refuses a quantity of 6", () => {
    expect(friendLineInputSchema.safeParse({ ...itemLine, quantity: 6 }).success).toBe(false);
  });
  it("refuses a size of 41 characters", () => {
    expect(friendLineInputSchema.safeParse({ ...itemLine, sizeLabel: "x".repeat(41) }).success).toBe(false);
    expect(friendLineInputSchema.safeParse({ ...itemLine, sizeLabel: "x".repeat(40) }).success).toBe(true);
  });
  it("refuses a manual line without a price", () => {
    const manual = { ...base, source: "manual", manualName: "Robe" };
    expect(friendLineInputSchema.safeParse(manual).success).toBe(false);
    expect(friendLineInputSchema.safeParse({ ...manual, manualPriceCents: 2990 }).success).toBe(true);
  });
  it("accepts a url line and refuses a non-web address", () => {
    const url = { ...base, source: "url", url: "https://shop.example/p/1" };
    expect(friendLineInputSchema.safeParse(url).success).toBe(true);
    expect(friendLineInputSchema.safeParse({ ...url, url: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("groupOrderCreateSchema", () => {
  const shopId = "7b6f1c52-1c5e-4c1b-9a53-0f0b7a1f7a11";
  const shipping = { label: "Standard", shippingCents: 690, freeFromCents: 8000 };
  it("takes exactly one of shippingOptionId or shipping", () => {
    expect(groupOrderCreateSchema.safeParse({ shopId, shipping, deadline: null }).success).toBe(true);
    expect(groupOrderCreateSchema.safeParse({ shopId, shippingOptionId: shopId, deadline: "2026-12-01" }).success).toBe(
      true,
    );
    expect(
      groupOrderCreateSchema.safeParse({ shopId, shippingOptionId: shopId, shipping, deadline: null }).success,
    ).toBe(false);
    expect(groupOrderCreateSchema.safeParse({ shopId, deadline: null }).success).toBe(false);
  });
});

describe("group order views", () => {
  it("parse minimal views", () => {
    const shipping = { label: "Standard", shippingCents: 690, freeFromCents: null };
    const id = "7b6f1c52-1c5e-4c1b-9a53-0f0b7a1f7a11";
    expect(
      sharedGroupOrderSchema.safeParse({
        id,
        shopName: "Zara",
        ownerName: null,
        status: "open",
        deadline: null,
        locked: false,
        shipping,
        currency: "EUR",
        totals: { totalCents: 0, remainingForFreeCents: null, shippingTotalCents: 0 },
        people: [],
        eligibleItemIds: [],
        itemSizes: {},
        mine: null,
        orderedAt: null,
      }).success,
    ).toBe(true);
    expect(
      ownerGroupOrderSchema.safeParse({
        id,
        wishlistId: id,
        shop: { id, name: "Zara" },
        status: "open",
        deadline: null,
        shipping,
        currency: "EUR",
        totals: { totalCents: 0, remainingForFreeCents: null, shippingTotalCents: 0, perPerson: {} },
        people: [],
        ownItems: [],
        orderedAt: null,
        cancelledAt: null,
      }).success,
    ).toBe(true);
  });
});
