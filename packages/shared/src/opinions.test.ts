import { describe, expect, it } from "vitest";
import { containsWebAddress, opinionInputSchema, opinionNameKey, textLength } from "./opinions";

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
  it.each(["va sur http://x.fr", "www.zara.com", "zara.com/robe", "Shop.FR"])("detects %s", (text) => {
    expect(containsWebAddress(text)).toBe(true);
  });
  it.each(["trop bien !", "taille 38.5", "j'adore... vraiment"])("lets %s through", (text) => {
    expect(containsWebAddress(text)).toBe(false);
  });
});

describe("opinionInputSchema", () => {
  it("accepts a null note", () => {
    expect(opinionInputSchema.safeParse(base).success).toBe(true);
  });
  it("limits the name in graphemes", () => {
    expect(opinionInputSchema.safeParse({ ...base, name: "🔥".repeat(40) }).success).toBe(true);
    expect(opinionInputSchema.safeParse({ ...base, name: "a".repeat(41) }).success).toBe(false);
  });
  it("refuses a bad level, a long note and a short device key", () => {
    expect(opinionInputSchema.safeParse({ ...base, level: 5 }).success).toBe(false);
    expect(opinionInputSchema.safeParse({ ...base, note: "a".repeat(201) }).success).toBe(false);
    expect(opinionInputSchema.safeParse({ ...base, deviceKey: "a".repeat(10) }).success).toBe(false);
  });
});
