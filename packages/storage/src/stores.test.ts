import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memoryStore, ObjectNotFoundError, type ObjectStore, s3Store } from "./index";

/** A tiny path-style S3 endpoint on localhost: enough of PutObject, GetObject and DeleteObject. */
function startS3Stub() {
  const objects = new Map<string, { body: Buffer; contentType: string | undefined }>();
  const requests: { method: string; url: string; authorization: string | undefined }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://stub");
      requests.push({ method: req.method ?? "", url: url.pathname, authorization: req.headers.authorization });
      const path = decodeURIComponent(url.pathname);
      if (req.method === "PUT") {
        objects.set(path, { body: Buffer.concat(chunks), contentType: req.headers["content-type"] });
        res.writeHead(200, { etag: '"1"' }).end();
      } else if (req.method === "GET") {
        const object = objects.get(path);
        if (!object) {
          res
            .writeHead(404, { "content-type": "application/xml" })
            .end("<Error><Code>NoSuchKey</Code><Message>missing</Message></Error>");
          return;
        }
        res.writeHead(200, { "content-type": object.contentType ?? "", "content-length": object.body.length });
        res.end(object.body);
      } else if (req.method === "DELETE") {
        objects.delete(path);
        res.writeHead(204).end();
      } else {
        res.writeHead(405).end();
      }
    });
  });
  return { server, objects, requests };
}

const contract = (name: string, make: () => ObjectStore) =>
  describe(`${name} store`, () => {
    it("puts, gets and deletes an object", async () => {
      const store = make();
      const body = Buffer.from([1, 2, 3, 250]);
      await store.put("users/u1/a.webp", body, "image/webp");
      expect(await store.get("users/u1/a.webp")).toEqual(body);
      await store.delete("users/u1/a.webp");
      await expect(store.get("users/u1/a.webp")).rejects.toBeInstanceOf(ObjectNotFoundError);
    });

    it("treats deleting a missing object as done", async () => {
      await expect(make().delete("users/u1/none.webp")).resolves.toBeUndefined();
    });
  });

contract("memory", memoryStore);

const stub = startS3Stub();
let endpoint = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => stub.server.close(() => resolve())));

const s3 = () =>
  s3Store({ endpoint, region: "gra", bucket: "closyria-test", accessKeyId: "key", secretAccessKey: "secret" });

contract("S3", s3);

describe("S3 store", () => {
  it("addresses the bucket in the path (OVH), signs requests and keeps the content type", async () => {
    await s3().put("users/u2/b.webp", Buffer.from("x"), "image/webp");
    const put = stub.requests.find((r) => r.method === "PUT" && r.url.endsWith("b.webp"));
    expect(put?.url).toBe("/closyria-test/users/u2/b.webp");
    expect(put?.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/gra\/s3\//);
    expect(stub.objects.get("/closyria-test/users/u2/b.webp")?.contentType).toBe("image/webp");
  });
});
