import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fsStore, ObjectNotFoundError } from "./index";

const roots: string[] = [];
const makeRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "closyria-fs-store-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("fs store", () => {
  it("puts, gets and deletes an object under its root", async () => {
    const root = await makeRoot();
    const store = fsStore(root);
    const body = Buffer.from([1, 2, 3, 250]);
    await store.put("users/u1/a.webp", body, "image/webp");
    expect(await readFile(join(root, "users/u1/a.webp"))).toEqual(body);
    expect(await store.get("users/u1/a.webp")).toEqual(body);
    await store.delete("users/u1/a.webp");
    await expect(store.get("users/u1/a.webp")).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it("shares objects between two stores on the same root (API and worker processes)", async () => {
    const root = await makeRoot();
    await fsStore(root).put("captures/p1/0.webp", Buffer.from("x"), "image/webp");
    expect(await fsStore(root).get("captures/p1/0.webp")).toEqual(Buffer.from("x"));
  });

  it("throws ObjectNotFoundError for a missing key", async () => {
    const error = await fsStore(await makeRoot())
      .get("users/u1/none.webp")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ObjectNotFoundError);
    expect((error as ObjectNotFoundError).key).toBe("users/u1/none.webp");
  });

  it("treats deleting a missing object as done", async () => {
    await expect(fsStore(await makeRoot()).delete("users/u1/none.webp")).resolves.toBeUndefined();
  });

  it("refuses keys that leave the root", async () => {
    const store = fsStore(await makeRoot());
    for (const key of ["../escape.webp", "users/../../escape.webp", "/etc/passwd", ""]) {
      await expect(store.put(key, Buffer.from("x"), "image/webp"), key).rejects.toThrow(/invalid object key/);
      await expect(store.get(key), key).rejects.toThrow(/invalid object key/);
    }
  });
});
