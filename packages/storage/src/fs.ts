import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { ObjectNotFoundError, type ObjectStore } from "./store";

/**
 * Objects kept as files under `root`. Test only: the browser tests run the API and the capture worker in
 * two processes, which must see the same photos. Keys never leave `root`.
 */
export function fsStore(root: string): ObjectStore {
  const base = resolve(root);
  const pathOf = (key: string) => {
    const path = resolve(base, key);
    const inside = relative(base, path);
    if (!key || isAbsolute(key) || !inside || inside.startsWith("..") || isAbsolute(inside)) {
      throw new Error(`invalid object key: ${JSON.stringify(key)}`);
    }
    return path;
  };
  return {
    async put(key, body) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      const path = pathOf(key);
      try {
        return await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ObjectNotFoundError(key);
        throw error;
      }
    },
    async delete(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}
