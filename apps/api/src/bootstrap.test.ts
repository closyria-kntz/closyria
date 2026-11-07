import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { objectStoreFor } from "./bootstrap";
import { envSchema } from "./env";

const base = {
  DATABASE_URL: "postgresql:///closyria",
  BETTER_AUTH_SECRET: "a".repeat(32),
  SHARE_LINK_KEY: Buffer.alloc(32, 7).toString("base64"),
  BETTER_AUTH_URL: "http://127.0.0.1:4310",
};

describe("objectStoreFor", () => {
  it("keeps photos on disk under TEST_STORAGE_DIR with APP_ENV=test", async () => {
    const dir = await mkdtemp(join(tmpdir(), "closyria-api-store-"));
    try {
      const store = objectStoreFor(envSchema.parse({ ...base, APP_ENV: "test", TEST_STORAGE_DIR: dir }));
      await store.put("captures/p/0.webp", Buffer.from("x"), "image/webp");
      // A second store on the same directory (the worker process) sees it.
      const other = objectStoreFor(envSchema.parse({ ...base, APP_ENV: "test", TEST_STORAGE_DIR: dir }));
      expect(await other.get("captures/p/0.webp")).toEqual(Buffer.from("x"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps photos in memory locally without S3 nor TEST_STORAGE_DIR", async () => {
    const a = objectStoreFor(envSchema.parse({ ...base, APP_ENV: "test" }));
    await a.put("k.webp", Buffer.from("x"), "image/webp");
    const b = objectStoreFor(envSchema.parse({ ...base, APP_ENV: "test" }));
    await expect(b.get("k.webp")).rejects.toThrow();
  });
});
