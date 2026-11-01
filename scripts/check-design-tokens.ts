// Guard: forbid hard-coded style values in apps/web (design tokens only).
// Runs under Node's native type stripping: keep explicit .ts imports and no TS-only runtime syntax.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Violation = { file: string; line: number; match: string; rule: string };

const GENERATED_FILES = new Set(["apps/web/src/styles/tokens.css"]);
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"];

const HEX_COLOR = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab|color-mix)\(/g;
const ARBITRARY_VALUE = /([\w-]+)-(\[([^\]]*)\])/g;
// Selector variants (data-[…]:, has-[…]:…) are not style values; min-/max- stay checked (hard-coded breakpoints).
const VARIANT_PREFIX = /(?:^|-)(?:data|aria|supports|has|not|in|nth|nth-last|nth-of-type|nth-last-of-type|group|peer)$/;
const UNIT = "(?:px|rem|em|ms|s|dvh|svh|lvh|vh|vw|vmin|vmax|deg)(?![\\w])|%";
const NUMBER_WITH_UNIT = new RegExp(`(?:(?<![\\w.-])|(?<=[\\s(,:])-)(?:\\d+\\.?\\d*|\\.\\d+)(?:${UNIT})`, "g");
const CSS_DECLARATION = /(?<![\w-])(-{0,2}[a-z][\w-]*)\s*:\s*([^;{}]+)(?=[;}]|$)/dgi;
const VAR_ONLY_STRING = /^(["'`])(?:var\(--[\w-]+(?:,[^()]*)?\)\s*)+\1$/;

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;
const blank = (text: string): string => text.replace(/[^\n]/g, " ");

// Blank out comments (keeping offsets and line numbers); string literals are left untouched.
function stripComments(source: string, isCss: boolean): string {
  const pattern = isCss
    ? /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\/\*[\s\S]*?\*\//g
    : /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return source.replace(pattern, (m, str) => (str ? m : blank(m)));
}

// Index of the bracket closing the one at `open`, skipping strings and nested brackets (-1 if unbalanced).
function matchClose(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i] as string;
    if (isQuote(c)) i = skipString(src, i);
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c) && --depth === 0) return i;
  }
  return -1;
}

const isQuote = (c: string | undefined): boolean => c === '"' || c === "'" || c === "`";

// Index of the closing quote of the string starting at `open`.
function skipString(src: string, open: number): number {
  let i = open + 1;
  while (i < src.length && src[i] !== src[open]) i += src[i] === "\\" ? 2 : 1;
  return i;
}

// Walk `text` at top level (strings and bracket groups skipped); `onChar` returns true to stop.
function walkTopLevel(text: string, onChar: (c: string, i: number) => boolean): void {
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (isQuote(c)) i = skipString(text, i);
    else if ("({[".includes(c)) {
      const close = matchClose(text, i);
      if (close === -1) return;
      i = close;
    } else if (onChar(c, i)) return;
  }
}

// Split `text` on top-level commas; returns [start offset, piece] pairs.
function splitTopLevel(text: string): Array<[number, string]> {
  const pieces: Array<[number, string]> = [];
  let start = 0;
  walkTopLevel(text, (c, i) => {
    if (c === ",") {
      pieces.push([start, text.slice(start, i)]);
      start = i + 1;
    }
    return false;
  });
  pieces.push([start, text.slice(start)]);
  return pieces;
}

function topLevelColon(piece: string): number {
  let found = -1;
  walkTopLevel(piece, (c, i) => {
    if (c === ":") found = i;
    return found !== -1;
  });
  return found;
}

function checkArbitraryValues(src: string, file: string, out: Violation[]): string {
  let masked = src;
  for (const m of src.matchAll(ARBITRARY_VALUE)) {
    const bracket = m[2] as string;
    const start = m.index + (m[1] as string).length + 1;
    const isVariant = src[start + bracket.length] === ":" && VARIANT_PREFIX.test(m[1] as string);
    if (!isVariant && !/^var\(--[\w-]+\)$/.test(m[3] as string)) {
      out.push({ file, line: lineOf(src, start), match: bracket, rule: "arbitrary-value" });
      masked = masked.slice(0, start) + " ".repeat(bracket.length) + masked.slice(start + bracket.length);
    }
  }
  return masked;
}

// Color functions are tolerated only when built from var(--…) references (no hex, no number with unit).
function colorFunctionSpans(src: string): Array<{ start: number; end: number; ok: boolean }> {
  const spans = [];
  for (const m of src.matchAll(COLOR_FUNCTION)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    const end = close === -1 ? src.length : close + 1;
    const inner = src.slice(open, end);
    const ok =
      close !== -1 &&
      inner.includes("var(--") &&
      !new RegExp(HEX_COLOR.source).test(inner) &&
      !new RegExp(NUMBER_WITH_UNIT.source).test(inner);
    spans.push({ start: m.index, end, ok });
  }
  return spans;
}

function checkColors(src: string, file: string, out: Violation[]): void {
  for (const m of src.matchAll(HEX_COLOR)) {
    out.push({ file, line: lineOf(src, m.index), match: m[0], rule: "literal-color" });
  }
  for (const span of colorFunctionSpans(src)) {
    if (!span.ok) {
      const match = src.slice(span.start, span.end);
      out.push({
        file,
        line: lineOf(src, span.start),
        match: match.length > 40 ? `${match.slice(0, 40)}…` : match,
        rule: "literal-color",
      });
    }
  }
}

function checkCssDeclarations(src: string, file: string, out: Violation[]): void {
  for (const m of src.matchAll(CSS_DECLARATION)) {
    const [valueStart] = (m.indices as unknown as Array<[number, number]>)[2] as [number, number];
    let value = m[2] as string;
    for (const span of colorFunctionSpans(value)) {
      value = value.slice(0, span.start) + " ".repeat(span.end - span.start) + value.slice(span.end);
    }
    value = value.replace(/(?<![\w.])100%/g, (x) => " ".repeat(x.length));
    // Leading space: the declaration value starts after `:`, so a leading sign is a sign, not part of a name.
    for (const u of ` ${value}`.matchAll(NUMBER_WITH_UNIT)) {
      out.push({ file, line: lineOf(src, valueStart + u.index - 1), match: u[0], rule: "literal-value" });
    }
  }
}

function checkInlineStyles(src: string, file: string, out: Violation[]): void {
  for (const m of src.matchAll(/\bstyle=\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    if (close === -1) continue;
    const exprStart = open + 1;
    const expr = src.slice(exprStart, close);
    const lead = expr.length - expr.trimStart().length;
    const trimmed = expr.trim();
    const flag = (offset: number, text: string): void => {
      out.push({ file, line: lineOf(src, offset), match: text, rule: "inline-style" });
    };
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      flag(exprStart + lead, trimmed);
      continue;
    }
    const body = trimmed.slice(1, -1);
    const bodyStart = exprStart + lead + 1;
    for (const [pieceStart, piece] of splitTopLevel(body)) {
      if (piece.trim() === "") continue;
      const colon = topLevelColon(piece);
      const valueOffset = colon === -1 ? 0 : colon + 1;
      const rawValue = piece.slice(valueOffset);
      const value = rawValue.trim();
      if (colon !== -1 && VAR_ONLY_STRING.test(value)) continue;
      flag(bodyStart + pieceStart + valueOffset + (rawValue.length - rawValue.trimStart().length), value);
    }
  }
}

export function findHardcodedStyles(source: string, file: string): Violation[] {
  const normalized = file.split(sep).join("/");
  if (GENERATED_FILES.has(normalized)) return [];

  const isCss = normalized.endsWith(".css");
  const found: Violation[] = [];
  const stripped = stripComments(source, isCss);
  const withoutArbitrary = checkArbitraryValues(stripped, normalized, found);
  checkColors(withoutArbitrary, normalized, found);
  if (isCss) checkCssDeclarations(stripped, normalized, found);
  else checkInlineStyles(stripped, normalized, found);
  return found.sort((a, b) => a.line - b.line);
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) yield path;
  }
}

function main(): void {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const violations: Violation[] = [];
  for (const path of walk(join(root, "apps/web/src"))) {
    violations.push(...findHardcodedStyles(readFileSync(path, "utf8"), relative(root, path)));
  }
  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.rule} — ${v.match}`);
  if (violations.length > 0) {
    console.error(`${violations.length} hard-coded style value(s) found: use design tokens.`);
    process.exit(1);
  }
}

if (import.meta.main) main();
