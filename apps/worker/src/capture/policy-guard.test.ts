import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "..");
// The only module allowed to define the test policy; the browser tests import it from there.
const TESTING_MODULE = join("capture", "testing");
const PACKAGE_TESTING_SPECIFIER = "@closyria/worker/capture/testing";
const POLICY_NAME = ["loopback", "ForTests"].join("");
// Static imports, re-exports (`export * from`), side-effect imports, dynamic `import()` and `require()`.
const SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

function withoutExtension(path: string): string {
  return path.replace(SOURCE_FILE, "");
}

/** Whether a module specifier written in `file` designates `<root>/capture/testing`. */
function targetsTestingModule(root: string, file: string, specifier: string): boolean {
  if (withoutExtension(specifier) === PACKAGE_TESTING_SPECIFIER) return true;
  if (!specifier.startsWith(".")) return false;
  return withoutExtension(resolve(dirname(file), specifier)) === join(root, TESTING_MODULE);
}

/** Non-test sources under `root` that name the test policy or import its module, by any path. */
async function findPolicyLeaks(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !/\.test\.[cm]?[jt]sx?$/.test(file) && withoutExtension(relative(root, file)) !== TESTING_MODULE);
  const leaks: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const imports = [...text.matchAll(SPECIFIER)].some(([, specifier = ""]) =>
      targetsTestingModule(root, file, specifier),
    );
    if (text.includes(POLICY_NAME) || imports) leaks.push(relative(root, file).split(sep).join("/"));
  }
  return leaks.sort();
}

describe("address policy guard", () => {
  it("no worker source outside tests references the loopback test policy or its module", async () => {
    expect(await findPolicyLeaks(SRC)).toEqual([]);
  });

  describe("on a fixture tree", () => {
    let root: string | undefined;
    afterEach(async () => {
      if (root) await rm(root, { recursive: true, force: true });
      root = undefined;
    });

    async function tree(files: Record<string, string>): Promise<string> {
      root = await mkdtemp(join(tmpdir(), "policy-guard-"));
      for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), content);
      }
      return root;
    }

    it("flags named references and every way of importing capture/testing", async () => {
      const dir = await tree({
        "capture/testing.ts": `export const ${POLICY_NAME} = () => true;`,
        "capture/safe-fetch.test.ts": `import { ${POLICY_NAME} } from "./testing";`,
        "clean.ts": `import { strictPolicy } from "./capture/address-policy";\nexport const p = strictPolicy;`,
        "named.ts": `const policy = ${POLICY_NAME};`,
        "barrel.ts": `export * from "./capture/testing";`,
        "renamed.ts": `export { ${["loop", "back"].join("")} as p } from "./capture/testing.js";`,
        "jobs/dynamic.ts": `const m = await import("../capture/testing");`,
        "jobs/side-effect.ts": `import "../capture/testing.ts";`,
        "jobs/package.ts": `import * as t from "${PACKAGE_TESTING_SPECIFIER}";`,
        "jobs/required.cjs": `const t = require('../capture/testing');`,
        "jobs/other-testing.ts": `import { x } from "./testing";`,
      });
      expect(await findPolicyLeaks(dir)).toEqual([
        "barrel.ts",
        "jobs/dynamic.ts",
        "jobs/package.ts",
        "jobs/required.cjs",
        "jobs/side-effect.ts",
        "named.ts",
        "renamed.ts",
      ]);
    });
  });
});
