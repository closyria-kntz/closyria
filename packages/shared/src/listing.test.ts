import { describe, expect, it } from "vitest";
import {
  conditionsBlocks,
  LISTING_CONDITIONS,
  listingAcceptInputSchema,
  listingRequestInputSchema,
  listingTokenSchema,
} from "./listing";

const consent = { authorized: true, accepted: true, conditionsVersion: LISTING_CONDITIONS.version } as const;

describe("listingAcceptInputSchema", () => {
  it("takes a name, an e-mail (lower case) and both ticked boxes on the current conditions", () => {
    expect(listingAcceptInputSchema.parse({ name: " Léa ", email: "Lea@Atelier.FR ", ...consent })).toEqual({
      name: "Léa",
      email: "lea@atelier.fr",
      ...consent,
    });
  });

  it("refuses an unticked box, an older version or a bad e-mail", () => {
    const ok = { name: "Léa", email: "lea@atelier.fr", ...consent };
    expect(listingAcceptInputSchema.safeParse({ ...ok, authorized: false }).success).toBe(false);
    expect(listingAcceptInputSchema.safeParse({ ...ok, accepted: false }).success).toBe(false);
    expect(listingAcceptInputSchema.safeParse({ ...ok, conditionsVersion: "v0" }).success).toBe(false);
    expect(listingAcceptInputSchema.safeParse({ ...ok, email: "lea" }).success).toBe(false);
    expect(listingAcceptInputSchema.safeParse({ ...ok, name: "  " }).success).toBe(false);
  });
});

describe("listingRequestInputSchema", () => {
  const base = { shopName: "Atelier Lune", name: "Léa", email: "lea@lune.fr", ...consent };

  it("adds https:// to a bare domain", () => {
    expect(listingRequestInputSchema.parse({ ...base, siteUrl: "atelier-lune.fr" }).siteUrl).toBe(
      "https://atelier-lune.fr",
    );
  });

  it("refuses an address that is not a web site", () => {
    for (const siteUrl of ["javascript:alert(1)", "ftp://x.fr", "pas une adresse", "https://localhost"]) {
      expect(listingRequestInputSchema.safeParse({ ...base, siteUrl }).success, siteUrl).toBe(false);
    }
  });
});

describe("listingTokenSchema", () => {
  it("is 43 base64url characters (32 bytes)", () => {
    expect(listingTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(listingTokenSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(listingTokenSchema.safeParse(`${"a".repeat(42)}/`).success).toBe(false);
  });
});

describe("conditionsBlocks", () => {
  it("reads titles, headings, paragraphs and lists", () => {
    expect(conditionsBlocks("# T\n\nUn\ndeux.\n\n## H\n\n- a\n  suite\n- b\n\nFin.")).toEqual([
      { kind: "title", text: "T" },
      { kind: "paragraph", text: "Un deux." },
      { kind: "heading", text: "H" },
      { kind: "list", items: ["a suite", "b"] },
      { kind: "paragraph", text: "Fin." },
    ]);
  });

  it("covers the bundled conditions (v1, marked as a draft for a lawyer)", () => {
    const blocks = conditionsBlocks(LISTING_CONDITIONS.markdown);
    expect(blocks[0]).toEqual({ kind: "title", text: "Conditions de référencement d’une boutique sur Closyria" });
    expect(LISTING_CONDITIONS.version).toBe("v1");
    expect(blocks.some((b) => b.kind === "paragraph" && b.text.includes("à faire valider par un avocat"))).toBe(true);
    expect(LISTING_CONDITIONS.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
