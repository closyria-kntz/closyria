// Guard: forbid hard-coded style values in apps/web (design tokens only).
// Runs under Node's native type stripping: keep explicit .ts imports and no TS-only runtime syntax.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Violation = { file: string; line: number; match: string; rule: string };

const GENERATED_FILES = new Set(["apps/web/src/styles/tokens.css"]);
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"];

const LITERAL_COLOR = /(?<![\w&[])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?|oklch)\(/g;
const ARBITRARY_VALUE = /\[#[0-9a-fA-F]+\]|\[[^\]\s]*\d(?:px|ms|rem|em)\]/g;
const INLINE_STYLE = /style=\{\{[\s\S]*?\}\}/g;
const NUMBER_WITH_UNIT = /\d(?:\.\d+)?(?:(?:px|rem|em|ms|s|vh|vw|vmin|vmax|deg)\b|%)/;

const lineOf = (source: string, index: number): number => source.slice(0, index).split("\n").length;

function collect(source: string, file: string, pattern: RegExp, rule: string, out: Violation[]): void {
  for (const m of source.matchAll(pattern)) {
    out.push({ file, line: lineOf(source, m.index), match: m[0], rule });
  }
}

export function findHardcodedStyles(source: string, file: string): Violation[] {
  const normalized = file.split(sep).join("/");
  if (GENERATED_FILES.has(normalized)) return [];

  const found: Violation[] = [];
  collect(source, normalized, LITERAL_COLOR, "literal-color", found);
  collect(source, normalized, ARBITRARY_VALUE, "arbitrary-value", found);
  for (const m of source.matchAll(INLINE_STYLE)) {
    const unit = NUMBER_WITH_UNIT.exec(m[0]);
    if (unit) found.push({ file: normalized, line: lineOf(source, m.index), match: unit[0], rule: "inline-style" });
  }
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
