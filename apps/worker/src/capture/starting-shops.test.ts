import { canonicalizeUrl } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import { STARTING_SHOPS } from "./starting-shops";

describe("STARTING_SHOPS", () => {
  it("has 18 unique shops", () => {
    expect(STARTING_SHOPS).toHaveLength(18);
    expect(new Set(STARTING_SHOPS.map((s) => s.slug)).size).toBe(18);
    expect(new Set(STARTING_SHOPS.map((s) => s.domain)).size).toBe(18);
  });
  it("gives a canonical test page to the 8 auto shops and none to the others", () => {
    const auto = STARTING_SHOPS.filter((s) => s.captureMode === "auto");
    expect(auto).toHaveLength(8);
    for (const s of auto) expect(s.testUrl).toBe(canonicalizeUrl(s.testUrl ?? ""));
    for (const s of STARTING_SHOPS.filter((s) => s.captureMode === "manual")) expect(s.testUrl).toBeNull();
  });
  it("uses shopify for the first 6 and secondhand for vinted and vestiaire", () => {
    expect(STARTING_SHOPS.slice(0, 6).every((s) => s.platform === "shopify")).toBe(true);
    expect(STARTING_SHOPS.slice(6).every((s) => s.platform === "other")).toBe(true);
    expect(STARTING_SHOPS.filter((s) => s.listingKind === "secondhand").map((s) => s.slug)).toEqual([
      "vinted",
      "vestiaire-collective",
    ]);
  });
});
