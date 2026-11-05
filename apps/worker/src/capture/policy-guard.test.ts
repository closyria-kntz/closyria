import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "..");
// The only file allowed to define it; the browser tests import it from there.
const TESTING_MODULE = ["capture", "testing.ts"].join(sep);

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx|mts|cts|js|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("address policy guard", () => {
  it("no worker source outside tests references the loopback test policy", async () => {
    const files = (await sourceFiles(SRC)).filter(
      (file) => !file.endsWith(".test.ts") && relative(SRC, file) !== TESTING_MODULE,
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      if ((await readFile(file, "utf8")).includes("loopbackForTests")) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
