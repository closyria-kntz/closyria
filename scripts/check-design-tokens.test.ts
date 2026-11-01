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

  describe("arbitrary values", () => {
    it.each([
      "w-[50%]",
      "duration-[0.2s]",
      "w-[calc(100%-2rem)]",
      "h-[100vh]",
      "rotate-[3deg]",
      "shadow-[0_0_4px_black]",
      "shadow-[0_0_4px_#000]",
      "bg-[rgb(0,0,0)]",
    ])("flags %s once", (cls) => {
      expect(rules(`<p className="${cls}" />`)).toEqual(["arbitrary-value"]);
    });

    it("allows a bracket holding only a var() reference", () => {
      expect(rules('<p className="bg-[var(--color-ink)]" />')).toEqual([]);
    });
  });

  describe("css declarations", () => {
    const css = (body: string) => rules(`a {\n  ${body}\n}`, "apps/web/src/app/x.css");

    it.each([
      ["transition: 200ms;", "literal-value"],
      ["box-shadow: 0 1px 2px black;", "literal-value"],
      ["padding: 12px;", "literal-value"],
      ["height: 100dvh;", "literal-value"],
      ["--gap: 1rem;", "literal-value"],
      ["color: oklch(0.5 0.1 20);", "literal-color"],
      ["color: color-mix(in oklch, red 40%, blue);", "literal-color"],
      ["color: rgb(0 0 0 / 50%);", "literal-color"],
    ])("flags %s", (decl, rule) => {
      expect(css(decl)).toContain(rule);
    });

    it.each([
      "padding: 0;",
      "width: 100%;",
      "color: var(--color-ink);",
      "color: rgb(var(--ink-rgb) / .5);",
      "padding: var(--space-4) var(--space-5);",
      "transition: color var(--duration-fast) var(--ease-standard);",
      "color: color-mix(in oklch, var(--color-ink), var(--color-surface));",
    ])("allows %s", (decl) => {
      expect(css(decl)).toEqual([]);
    });

    it("reports the line of the offending declaration", () => {
      const found = findHardcodedStyles("a {\n  color: var(--c);\n  margin: 4px;\n}", "apps/web/src/app/x.css");
      expect(found).toEqual([{ file: "apps/web/src/app/x.css", line: 3, match: "4px", rule: "literal-value" }]);
    });
  });

  describe("inline styles", () => {
    it.each([
      "style={{ width: 12 }}",
      'style={{ width: "12px" }}',
      "style={someStyle}",
      'style={{ ...rest, color: "var(--c)" }}',
    ])("flags %s", (attr) => {
      expect(rules(`<div ${attr} />`)).toEqual(["inline-style"]);
    });

    it("allows var() string values only", () => {
      expect(rules("<div style={{ width: \"var(--space-4)\", color: 'var(--color-ink)' }} />")).toEqual([]);
    });

    it("reports the line of the offending value, not of the attribute", () => {
      const source = '<div\n  style={{\n    color: "var(--c)",\n    width: 12,\n  }}\n/>';
      expect(findHardcodedStyles(source, "apps/web/src/app/p.tsx")).toEqual([
        { file: "apps/web/src/app/p.tsx", line: 4, match: "12", rule: "inline-style" },
      ]);
    });
  });

  describe("comments", () => {
    it("ignores hex-looking text in comments", () => {
      expect(rules("// fix #123\n/* #fff and 12px [50%] */\nconst a = 1;")).toEqual([]);
      expect(rules("/* #fff */ a { color: var(--c); } /* 4px */", "x.css")).toEqual([]);
    });

    it("keeps line numbers after a comment", () => {
      expect(findHardcodedStyles("/* a\nb */\nconst c = '#fff';", "x.ts")[0]?.line).toBe(3);
    });

    it("does not treat // inside a string as a comment", () => {
      expect(rules('const u = "http://x"; const c = "#fff";')).toEqual(["literal-color"]);
    });
  });
});
