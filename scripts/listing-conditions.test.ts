import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LISTING_CONDITIONS } from "../packages/shared/src/listing-conditions.generated.ts";
import { conditionsModule, SOURCE, TARGET } from "./listing-conditions.ts";

describe("listing conditions bundle", () => {
  it("is up to date with docs/legal/conditions-referencement.md (run node scripts/listing-conditions.ts)", () => {
    expect(readFileSync(TARGET, "utf8")).toBe(conditionsModule(readFileSync(SOURCE, "utf8")));
  });

  it("records the version, the date and the SHA-256 of the exact text", () => {
    const md = "# T\n\nVersion : v3 — 2027-01-02\n\nTexte.\n";
    const module = conditionsModule(md);
    expect(module).toContain('version: "v3"');
    expect(module).toContain('date: "2027-01-02"');
    expect(module).toContain(`sha256: "${createHash("sha256").update(md).digest("hex")}"`);
  });

  it("refuses a text without its version line", () => {
    expect(() => conditionsModule("# T\n")).toThrow(/Version/);
  });

  it("marks the draft as to be validated by a lawyer", () => {
    expect(readFileSync(SOURCE, "utf8")).toContain("Projet — à faire valider par un avocat");
  });

  it("archives every bundled version as it was accepted (docs/legal/archive), byte for byte", () => {
    const archive = fileURLToPath(
      new URL(`../docs/legal/archive/conditions-referencement-${LISTING_CONDITIONS.version}.md`, import.meta.url),
    );
    expect(existsSync(archive), archive).toBe(true);
    const sha = createHash("sha256").update(readFileSync(archive, "utf8"), "utf8").digest("hex");
    expect(sha).toBe(LISTING_CONDITIONS.sha256);
  });
});
