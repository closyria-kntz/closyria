import { describe, expect, it } from "vitest";
import {
  containsWebAddress,
  deviceKeySchema,
  OPINION_NAME_MAX_CODE_POINTS,
  OPINION_NOTE_MAX_CODE_POINTS,
  opinionDeleteSchema,
  opinionInputSchema,
  opinionNameKey,
  shareLinkSchema,
  textLength,
  wishlistSettingsSchema,
} from "./opinions";
import { sharedWishlistViewSchema } from "./wardrobe";

const deviceKey = "a".repeat(22);
const base = { name: "Léa", level: 3, note: null, deviceKey };

describe("textLength", () => {
  it("counts graphemes", () => {
    expect(textLength("Léa 🔥👩‍👩‍👧")).toBe(6);
  });
});

describe("opinionNameKey", () => {
  it("normalizes spaces and case", () => {
    expect(opinionNameKey("  Léa   M. ")).toBe("léa m.");
    expect(opinionNameKey("LÉA")).toBe("léa");
  });
});

describe("containsWebAddress", () => {
  it.each(["va sur http://x.fr", "HTTPS://X.FR", "www.zara.com", "WWW.Zara.Com", "zara.com/robe", "Shop.fr"])(
    "detects %s",
    (text) => {
      expect(containsWebAddress(text)).toBe(true);
    },
  );
  // The bare-domain rule only knows lower-case endings: a sentence glued to a capital (« belle.Ca ») is not a link.
  it.each(["trop bien !", "taille 38.5", "j'adore... vraiment", "Trop belle.Ca te va", "c'est top.De rien", "Shop.FR"])(
    "lets %s through",
    (text) => {
      expect(containsWebAddress(text)).toBe(false);
    },
  );
});

describe("opinionInputSchema", () => {
  it("accepts a null note", () => {
    expect(opinionInputSchema.safeParse(base).success).toBe(true);
  });
  it("limits the name in graphemes", () => {
    expect(opinionInputSchema.safeParse({ ...base, name: "🔥".repeat(40) }).success).toBe(true);
    expect(opinionInputSchema.safeParse({ ...base, name: "a".repeat(41) }).success).toBe(false);
  });
  it("takes 40 flags as a name and 200 toned emojis as a note", () => {
    expect(opinionInputSchema.safeParse({ ...base, name: "🇫🇷".repeat(40), note: "👍🏽".repeat(200) }).success).toBe(
      true,
    );
  });
  it("also caps code points, so one huge grapheme cannot pass", () => {
    const huge = (n: number) => `a${"\u0301".repeat(n)}`;
    expect(opinionInputSchema.safeParse({ ...base, name: huge(OPINION_NAME_MAX_CODE_POINTS - 1) }).success).toBe(true);
    expect(opinionInputSchema.safeParse({ ...base, name: huge(OPINION_NAME_MAX_CODE_POINTS) }).success).toBe(false);
    expect(opinionInputSchema.safeParse({ ...base, note: huge(OPINION_NOTE_MAX_CODE_POINTS - 1) }).success).toBe(true);
    expect(opinionInputSchema.safeParse({ ...base, note: huge(OPINION_NOTE_MAX_CODE_POINTS) }).success).toBe(false);
  });
  it("refuses a bad level, a long note and a short device key", () => {
    expect(opinionInputSchema.safeParse({ ...base, level: 5 }).success).toBe(false);
    expect(opinionInputSchema.safeParse({ ...base, note: "a".repeat(201) }).success).toBe(false);
    expect(opinionInputSchema.safeParse({ ...base, deviceKey: "a".repeat(10) }).success).toBe(false);
  });
});

describe("opinionInputSchema name trimming", () => {
  it("refuses a blank name and trims the rest", () => {
    expect(opinionInputSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(opinionInputSchema.parse({ ...base, name: " Léa " }).name).toBe("Léa");
  });
});

describe("opinionDeleteSchema", () => {
  it("needs a name and a device key", () => {
    expect(opinionDeleteSchema.safeParse({ name: "Léa", deviceKey }).success).toBe(true);
    expect(opinionDeleteSchema.safeParse({ name: "Léa" }).success).toBe(false);
  });
});

describe("deviceKeySchema", () => {
  it("accepts base64url from 22 to 64 characters", () => {
    expect(deviceKeySchema.safeParse("a".repeat(22)).success).toBe(true);
    expect(deviceKeySchema.safeParse(`${"A_-".repeat(7)}a`).success).toBe(true);
    expect(deviceKeySchema.safeParse("a".repeat(64)).success).toBe(true);
  });
  it("refuses other characters and lengths", () => {
    expect(deviceKeySchema.safeParse(`${"a".repeat(21)}+`).success).toBe(false);
    expect(deviceKeySchema.safeParse(`${"a".repeat(21)}=`).success).toBe(false);
    expect(deviceKeySchema.safeParse("a".repeat(65)).success).toBe(false);
  });
});

describe("wishlistSettingsSchema", () => {
  it("has four booleans, and partial() takes one", () => {
    const all = { allowOpinions: true, showOwnerName: false, showOwnerOpinions: true, showBudget: false };
    expect(wishlistSettingsSchema.safeParse(all).success).toBe(true);
    expect(wishlistSettingsSchema.safeParse({ allowOpinions: true }).success).toBe(false);
    expect(wishlistSettingsSchema.partial().safeParse({ showBudget: true }).success).toBe(true);
  });
});

describe("shareLinkSchema", () => {
  it("accepts a link or a legacy list without one", () => {
    expect(shareLinkSchema.safeParse({ url: "/l/abc", legacy: false }).success).toBe(true);
    expect(shareLinkSchema.safeParse({ url: null, legacy: true }).success).toBe(true);
  });
});

describe("sharedWishlistViewSchema", () => {
  const id = "5b1f3c0e-7c1a-4d58-9a39-0a3f2f3a1b11";
  const item = {
    itemId: id,
    ownerOpinion: null,
    opinions: [],
    name: "Robe",
    brand: null,
    priceCents: 2999,
    currency: "EUR",
    imageUrl: null,
    imageWidth: null,
    imageHeight: null,
    gift: null,
    size: null,
    shopName: "Boutique",
    url: "https://shop.test/robe",
  };
  const view = {
    name: "Été",
    ownerName: null,
    allowOpinions: true,
    viewerIsOwner: false,
    gifts: { open: false, occasion: null, date: null },
    givenItems: [],
    groupOrder: null,
    levels: [],
    budget: null,
    items: [item],
  };
  it("accepts empty owner fields", () => {
    expect(sharedWishlistViewSchema.safeParse(view).success).toBe(true);
  });
  it("accepts filled owner fields, opinions and budget", () => {
    const opinion = {
      id,
      name: "Léa",
      level: 3,
      note: null,
      createdAt: "2026-11-08T10:00:00.000Z",
      updatedAt: "2026-11-08T10:00:00.000Z",
      isNew: false,
    };
    const filled = {
      ...view,
      ownerName: "Sam",
      budget: { amountCents: 5000, currency: "EUR" },
      items: [{ ...item, ownerOpinion: { level: 4, priority: true, why: "Parfaite" }, opinions: [opinion] }],
    };
    expect(sharedWishlistViewSchema.safeParse(filled).success).toBe(true);
    expect(sharedWishlistViewSchema.safeParse({ ...view, items: [{ ...item, itemId: "nope" }] }).success).toBe(false);
  });
});
