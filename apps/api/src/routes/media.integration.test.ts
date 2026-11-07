import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, eq, schema } from "@closyria/db";
import fr from "@closyria/i18n/messages/fr.json" with { type: "json" };
import { memoryStore, type ObjectStore } from "@closyria/storage";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { createSemaphore } from "../semaphore";
import type { MediaDeps } from "./media";

const BASE_URL = "http://localhost:3001";
const MB = 1024 * 1024;

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let store: ObjectStore;
let app: ReturnType<typeof createApp>;
let ipCounter = 0;

async function signIn() {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.2.0.${++ipCounter}`, "user-agent": "closyria-tests" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, userId: body.user.id };
}

/** Uploads `body` as the `file` field; the name and type claimed by the client are deliberately misleading. */
function upload(
  body: Buffer | string | null,
  cookie?: string,
  field = "file",
  target: { request: ReturnType<typeof createApp>["request"] } = app,
  headers: Record<string, string> = {},
) {
  const form = new FormData();
  if (body !== null) {
    form.set(
      field,
      typeof body === "string" ? body : new File([new Uint8Array(body)], "photo.jpg", { type: "image/jpeg" }),
    );
  }
  return target.request("/api/media", {
    method: "POST",
    body: form,
    headers: { origin: BASE_URL, ...headers, ...(cookie ? { cookie } : {}) },
  });
}

const jpegWithGps = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 10, g: 90, b: 160 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: "Apple", Model: "iPhone 17" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "48/1 51/1 2400/100",
        GPSLongitudeRef: "E",
        GPSLongitude: "2/1 21/1 300/100",
      },
    })
    .toBuffer();

function heic(): Buffer {
  const ftyp = Buffer.alloc(24);
  ftyp.writeUInt32BE(24, 0);
  ftyp.write("ftypheic", 4, "latin1");
  ftyp.write("mif1heic", 16, "latin1");
  return Buffer.concat([ftyp, Buffer.alloc(64)]);
}

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  auth = createAuth({
    db: handle.db,
    mailer: memoryMailer(),
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
  store = memoryStore();
  app = createApp({
    origin: BASE_URL,
    env: "test",
    version: "t",
    pingDb: async () => true,
    auth,
    media: { db: handle.db, store },
    events: { db: handle.db },
    catalog: { db: handle.db, store: memoryStore(), queue: { enqueue: async () => {} } },
    admin: { db: handle.db },
    wardrobe: { db: handle.db, shareLinkKey: Buffer.alloc(32) },
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("POST /api/media", () => {
  it("answers 401 without a session", async () => {
    const res = await upload(await jpegWithGps());
    expect(res.status).toBe(401);
  });

  it("stores the photo as WebP without metadata, under users/<userId>/<uuid>.webp", async () => {
    const { cookie, userId } = await signIn();
    const res = await upload(await jpegWithGps(), cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; width: number; height: number; contentType: string };
    expect(body).toEqual({ id: expect.any(String), width: 640, height: 480, contentType: "image/webp" });

    const [row] = await handle.db.select().from(schema.media).where(eq(schema.media.id, body.id));
    expect(row).toMatchObject({ userId, key: `users/${userId}/${body.id}.webp`, contentType: "image/webp" });
    const stored = await store.get(row?.key ?? "");
    expect(row?.sizeBytes).toBe(stored.length);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it("answers 415 « Format non pris en charge » for HEIC and for a PDF", async () => {
    const { cookie } = await signIn();
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
    for (const file of [heic(), pdf]) {
      const res = await upload(file, cookie);
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "unsupported_image" });
    }
    expect(fr.Media.errors.unsupported_image).toBe("Format non pris en charge");
  });

  it("answers 413 « Photo trop lourde, 20 Mo maximum » for 21 MB", async () => {
    const { cookie, userId } = await signIn();
    const big = Buffer.alloc(21 * MB);
    big.set([0xff, 0xd8, 0xff], 0);
    const res = await upload(big, cookie);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "image_too_large" });
    expect(fr.Media.errors.image_too_large).toBe("Photo trop lourde, 20 Mo maximum");
    expect(await handle.db.select().from(schema.media).where(eq(schema.media.userId, userId))).toEqual([]);
  });

  it("answers 400 when no file is sent", async () => {
    const { cookie } = await signIn();
    for (const res of [
      await upload(null, cookie),
      await upload("not a file", cookie),
      await upload(await jpegWithGps(), cookie, "photo"),
    ]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_upload" });
    }
    expect(fr.Media.errors.invalid_upload).toBe("Aucune photo reçue, réessaie");
  });

  it("documents the multipart body and the user access level", async () => {
    const doc = (await (await app.request("/api/openapi.json")).json()) as {
      paths: Record<string, { post?: { "x-access"?: string; requestBody?: { content: Record<string, unknown> } } }>;
    };
    const op = doc.paths["/api/media"]?.post;
    expect(op?.["x-access"]).toBe("user");
    expect(op?.requestBody?.content).toHaveProperty("multipart/form-data");
  });
});

describe("upload limits", () => {
  const limitedApp = (media: Omit<MediaDeps, "db" | "store">) =>
    createApp({
      env: "test",
      version: "t",
      origin: BASE_URL,
      pingDb: async () => true,
      auth,
      media: { db: handle.db, store, ...media },
      events: { db: handle.db },
      catalog: { db: handle.db, store: memoryStore(), queue: { enqueue: async () => {} } },
      admin: { db: handle.db },
      wardrobe: { db: handle.db, shareLinkKey: Buffer.alloc(32) },
    });

  it("documents the default limits: 30 uploads an hour per user, 60 per address, 2 at once", async () => {
    const { MEDIA_LIMITS } = await import("./media");
    expect(MEDIA_LIMITS).toEqual({
      perUser: { max: 30, windowMs: 3_600_000 },
      perAddress: { max: 60, windowMs: 3_600_000 },
      concurrency: { max: 2, maxWaiting: 8, waitMs: 5_000 },
    });
  });

  it("answers 429 rate_limited past the per-user limit, then past the per-address limit", async () => {
    const limited = limitedApp({
      limits: { perUser: { max: 2, windowMs: 60_000 }, perAddress: { max: 4, windowMs: 60_000 } },
    });
    const photo = await jpegWithGps();
    const sameAddress = { "x-forwarded-for": "203.0.113.7" };
    const first = await signIn();
    for (let i = 0; i < 2; i++)
      expect((await upload(photo, first.cookie, "file", limited, sameAddress)).status).toBe(201);
    const refused = await upload(photo, first.cookie, "file", limited, sameAddress);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "rate_limited" });

    // Another user behind the same address: one more request, then the address limit (4 requests, the
    // refused one included) is reached; another address is not affected.
    const second = await signIn();
    expect((await upload(photo, second.cookie, "file", limited, sameAddress)).status).toBe(201);
    expect((await upload(photo, second.cookie, "file", limited, sameAddress)).status).toBe(429);
    expect((await upload(photo, second.cookie, "file", limited, { "x-forwarded-for": "203.0.113.8" })).status).toBe(
      201,
    );
    expect(fr.Media.errors.rate_limited).toBeTruthy();
  });

  it("answers 503 busy when photo processing stays saturated, and works once a slot frees", async () => {
    const semaphore = createSemaphore({ max: 1, maxWaiting: 4 });
    const limited = limitedApp({ semaphore, limits: { concurrency: { waitMs: 20 } } });
    const { cookie } = await signIn();
    const photo = await jpegWithGps();
    const held = await semaphore.acquire(0);
    const busy = await upload(photo, cookie, "file", limited);
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ error: "busy" });
    expect(fr.Media.errors.busy).toBeTruthy();
    held?.();
    expect((await upload(photo, cookie, "file", limited)).status).toBe(201);
  });
});
