import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  it("marks the 12 big brands « grande enseigne », never the 6 small shops", () => {
    expect(
      STARTING_SHOPS.filter((s) => s.isMajorBrand)
        .map((s) => s.slug)
        .sort(),
    ).toEqual(MAJOR_SLUGS);
    expect(STARTING_SHOPS.slice(0, 6).some((s) => s.isMajorBrand)).toBe(false);
  });
  it("is the list the migration marks on existing shops", () => {
    const dir = fileURLToPath(new URL("../../../../packages/db/migrations/", import.meta.url));
    const file = readdirSync(dir).find((f) => f.includes("enseignes"));
    if (!file) throw new Error("migration not found");
    const update = readFileSync(`${dir}${file}`, "utf8")
      .split("\n")
      .find((line) => line.startsWith('UPDATE "shops" SET "is_major_brand" = true'));
    const slugs = [...(update?.match(/\bIN \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(slugs.sort()).toEqual(MAJOR_SLUGS);
  });
});

const MAJOR_SLUGS = [
  "etam",
  "hm",
  "kiabi",
  "la-redoute",
  "mango",
  "promod",
  "sezane",
  "shein",
  "vestiaire-collective",
  "vinted",
  "zalando",
  "zara",
];
