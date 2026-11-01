// Copies packages that the API bundle keeps external (native code: sharp and its libvips binaries), with
// their runtime dependencies, into a flat node_modules of the release.
//   node deploy/native-deps.mjs <installed-app-dir> <target-node_modules> <package>...
// <installed-app-dir> comes from `pnpm --filter @closyria/api deploy --prod`, so versions come from the
// lockfile and only the binaries of the build machine's platform are present (linux-x64, glibc).
import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const [from, target, ...roots] = process.argv.slice(2);
if (!from || !target || roots.length === 0) {
  console.error("usage: node deploy/native-deps.mjs <installed-app-dir> <target-node_modules> <package>...");
  process.exit(2);
}

/** Node's lookup: node_modules/<name> in `dir` or one of its parents. */
function locate(name, dir) {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = join(d, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(d) === d) return null;
  }
}

const copied = new Map(); // name -> version
const queue = roots.map((name) => ({ name, dir: realpathSync(from), optional: false }));
while (queue.length > 0) {
  const { name, dir, optional } = queue.shift();
  const path = locate(name, dir);
  if (!path) {
    if (optional) continue; // another platform's binary
    throw new Error(`${name} is not installed under ${from}`);
  }
  const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (copied.has(name)) {
    if (copied.get(name) !== pkg.version) throw new Error(`${name}: two versions needed in a flat node_modules`);
    continue;
  }
  copied.set(name, pkg.version);
  cpSync(path, join(target, name), { recursive: true, dereference: true });
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push({ name: dep, dir: path, optional: false });
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) queue.push({ name: dep, dir: path, optional: true });
}
console.log([...copied].map(([name, version]) => `${name}@${version}`).join(" "));
