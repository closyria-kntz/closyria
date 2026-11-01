import { describe, expect, it } from "vitest";
import { findHardcodedStyles } from "./check-design-tokens.ts";

const rules = (source: string, file = "apps/web/src/app/page.tsx") =>
  findHardcodedStyles(source, file).map((v) => v.rule);

describe("findHardcodedStyles", () => {
  it("rejects an arbitrary Tailwind color", () => {
    const found = findHardcodedStyles('<p className="bg-[#fff]" />', "apps/web/src/app/page.tsx");
    expect(found).toEqual([{ file: "apps/web/src/app/page.tsx", line: 1, match: "[#fff]", rule: "arbitrary-value" }]);
  });

  it("rejects arbitrary px and ms values", () => {
    expect(rules('<p className="p-[13px] duration-[300ms]" />')).toEqual(["arbitrary-value", "arbitrary-value"]);
  });

  it("rejects literal colors in css", () => {
    const found = findHardcodedStyles("a {\n  color: #1e1b15;\n}", "apps/web/src/app/globals.css");
    expect(found).toEqual([{ file: "apps/web/src/app/globals.css", line: 2, match: "#1e1b15", rule: "literal-color" }]);
  });

  it("rejects color functions", () => {
    expect(rules("a { color: rgb(0 0 0); b: hsl(1 2% 3%); c: oklch(0.5 0.1 20) }", "x.css")).toEqual([
      "literal-color",
      "literal-color",
      "literal-color",
    ]);
  });

  it("rejects inline styles with a number and a unit", () => {
    expect(rules('<div style={{ width: 12px, height: "3rem" }} />')).toEqual(["inline-style"]);
    expect(rules("<div\n  style={{ margin: '4px' }}\n/>")).toEqual(["inline-style"]);
  });

  it("allows inline styles that use tokens", () => {
    expect(rules('<div style={{ width: "var(--space-4)" }} />')).toEqual([]);
  });

  it("allows token classes and structural utilities", () => {
    const source =
      '<main className="mx-auto flex min-h-dvh max-w-narrow gap-space-4 p-space-4 bg-surface text-ink font-strong text-lead text-display" />';
    expect(rules(source)).toEqual([]);
  });

  it("allows var() references in css", () => {
    expect(rules("body { color: var(--color-ink); }", "a.css")).toEqual([]);
  });

  it("does not flag array indexing or hash-like text", () => {
    expect(rules("const a = list[0]; // see [1,2]")).toEqual([]);
  });

  it("ignores the generated tokens.css", () => {
    expect(findHardcodedStyles("a { color: #fff }", "apps/web/src/styles/tokens.css")).toEqual([]);
  });
});
