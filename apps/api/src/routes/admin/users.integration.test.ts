import { createAuth, memoryMailer } from "@closyria/auth";
import { createDb, eq, schema, sql } from "@closyria/db";
import {
  ADMIN_USERS_PAGE_SIZE,
  adminAuditPageSchema,
  adminUserDetailSchema,
  adminUserListSchema,
} from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { registerOwnedTables } from "../../owned-tables";
import { decodeUserCursor, encodeUserCursor } from "./users";

const BASE_URL = "http://localhost:3001";

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof createApp>;
let store: ObjectStore;
let ipCounter = 0;
let counter = 0;

/** A real Better Auth session, then set to the role, sign-in method and kind under test. */
async function session(
  role: "user" | "admin",
  authMethod: "anonymous" | "email-otp" | "passkey",
  options: { guest?: boolean } = {},
) {
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/anonymous`, {
      method: "POST",
      headers: { origin: BASE_URL, "x-forwarded-for": `10.9.0.${++ipCounter}`, "user-agent": "closyria-tests" },
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string }; token: string };
  const email = `person-${++counter}@example.test`;
  await handle.db
    .update(schema.user)
    .set(options.guest ? { role } : { role, isAnonymous: false, email, emailVerified: true })
    .where(eq(schema.user.id, body.user.id));
  await handle.db.update(schema.session).set({ authMethod }).where(eq(schema.session.token, body.token));
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { cookie, userId: body.user.id, email };
}

const get = (path: string, cookie?: string) => app.request(path, cookie ? { headers: { cookie } } : {});
const remove = (id: string, confirmation: string, cookie: string) =>
  app.request(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });

let admin: Awaited<ReturnType<typeof session>>;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {});
  registerOwnedTables();
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
    version: "test",
    pingDb: async () => true,
    auth,
    media: { db: handle.db, store },
    events: { db: handle.db },
    catalog: {
      db: handle.db,
      store,
      queue: { enqueue: async () => {}, importCatalogue: async () => true, refreshProduct: async () => true },
    },
    admin: { db: handle.db },
    wardrobe: { db: handle.db, shareLinkKey: Buffer.alloc(32) },
  });
  admin = await session("admin", "passkey");
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

/** Rows in a table whose foreign keys to user(id) point at `userId` (every such column). */
async function rowsPointingTo(userId: string): Promise<Record<string, number>> {
  const fks = await handle.db.execute<{ tbl: string; col: string }>(sql`
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confrelid = '"user"'::regclass`);
  const counts: Record<string, number> = {};
  for (const { tbl, col } of fks.rows) {
    const result = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.raw(tbl)} where ${sql.identifier(col)} = ${userId}`,
    );
    counts[`${tbl.replaceAll('"', "")}.${col}`] = result.rows[0]?.n ?? 0;
  }
  return counts;
}

/** Gives `userId` a row in every table that can hold her data, and two stored photos. Returns the photos' keys. */
async function seedEverything(userId: string, email: string): Promise<string[]> {
  const n = ++counter;
  const run = (query: ReturnType<typeof sql>) => handle.db.execute(query);
  const [shop] = await handle.db
    .insert(schema.shops)
    .values({ name: `Boutique U${n}`, slug: `admin-users-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await handle.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://admin-users-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  const [profile] = await handle.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  const keys = [`users/${userId}/a-${n}.webp`, `users/${userId}/b-${n}.webp`];
  for (const key of keys) await store.put(key, Buffer.from("photo"), "image/webp");
  const mediaId = crypto.randomUUID();
  await handle.db.insert(schema.media).values({
    id: mediaId,
    userId,
    key: keys[0] ?? "",
    contentType: "image/webp",
    sizeBytes: 5,
    width: 1,
    height: 1,
  });
  const [item] = await handle.db
    .insert(schema.items)
    .values({ userId, profileId: profile.id, productId: product.id, coverMediaId: mediaId })
    .returning();
  if (!item) throw new Error("no item");
  // A photo fetched by link, ready but not attached yet: its object belongs to her too.
  await handle.db.insert(schema.photoImports).values({
    userId,
    itemId: item.id,
    url: "https://example.test/p.jpg",
    status: "ready",
    mediaKey: keys[1],
  });
  await handle.db.insert(schema.tags).values({ userId, name: `Étiquette ${n}` });
  await handle.db.insert(schema.recentProducts).values({ userId, productId: product.id, visitedAt: new Date() });
  const [list] = await handle.db.insert(schema.wishlists).values({ userId, name: "Envies" }).returning();
  await handle.db.insert(schema.loveLevels).values({ userId, level: 1, emoji: "🙂", label: "Bof" });
  await handle.db.insert(schema.budgets).values({ userId, wishlistId: list?.id, amountCents: 1000, period: "month" });
  await handle.db.insert(schema.alertEvents).values({ userId, kind: "shop_promo", shopId: shop.id });
  await handle.db.insert(schema.events).values({ userId, name: "page_view", path: "/", occurredAt: new Date() });
  await handle.db.insert(schema.usageCounters).values({ userId, key: "captures", period: "2026-11", value: 1 });
  await handle.db.insert(schema.userPlans).values({ userId, planId: "free" });
  await handle.db.insert(schema.productReports).values({ userId, productId: product.id, reason: "other" });
  await handle.db
    .insert(schema.pushSubscriptions)
    .values({ userId, endpoint: `https://push.test/${n}`, p256dh: "k", auth: "a" });
  await handle.db.insert(schema.alertSettings).values({ userId });
  await handle.db.insert(schema.alertSends).values({ userId, ok: true });
  await handle.db
    .insert(schema.captures)
    .values({ shopId: shop.id, url: `https://admin-users-${n}.test/p`, trigger: "user", requestedBy: userId });
  await run(sql`insert into account (id, account_id, provider_id, user_id, created_at, updated_at)
    values (${`acc-${n}`}, ${`google-${n}`}, 'google', ${userId}, now(), now())`);
  await run(sql`insert into passkey (id, public_key, user_id, credential_id, counter, device_type, backed_up)
    values (${`pk-${n}`}, 'key', ${userId}, ${`cred-${n}`}, 0, 'singleDevice', false)`);
  await run(sql`insert into verification (id, identifier, value, expires_at, created_at, updated_at)
    values (${`ver-${n}`}, ${`sign-in-otp-${email}`}, 'hash', now() + interval '10 minutes', now(), now())`);
  return keys;
}

describe("access to /api/admin/users", () => {
  it("is refused without a session, to a user, and to an admin signed in with a code", async () => {
    const someone = await session("user", "email-otp");
    const byCode = await session("admin", "email-otp");
    for (const path of ["/api/admin/users", `/api/admin/users/${someone.userId}`]) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, someone.cookie)).status).toBe(403);
      expect((await get(path, byCode.cookie)).status).toBe(403);
    }
    expect((await remove(someone.userId, someone.email, someone.cookie)).status).toBe(403);
    expect((await remove(someone.userId, someone.email, byCode.cookie)).status).toBe(403);
  });
});

describe("GET /api/admin/users", () => {
  it("lists accounts and guests newest first, with counts, and filters and searches", async () => {
    const account = await session("user", "email-otp");
    const guest = await session("user", "anonymous", { guest: true });
    await seedEverything(account.userId, account.email);

    const res = await get("/api/admin/users", admin.cookie);
    expect(res.status).toBe(200);
    const page = adminUserListSchema.parse(await res.json());
    const ids = page.users.map((u) => u.id);
    expect(ids.indexOf(guest.userId)).toBeLessThan(ids.indexOf(account.userId));
    const row = page.users.find((u) => u.id === account.userId);
    expect(row).toMatchObject({ email: account.email, isAnonymous: false, role: "user", itemCount: 1, pushDevices: 1 });
    expect(row?.lastActiveAt).not.toBeNull();
    // A guest shows no address: « Sans compte ».
    expect(page.users.find((u) => u.id === guest.userId)).toMatchObject({ email: null, isAnonymous: true });

    const guests = adminUserListSchema.parse(await (await get("/api/admin/users?kind=guests", admin.cookie)).json());
    expect(guests.users.every((u) => u.isAnonymous)).toBe(true);
    expect(guests.users.map((u) => u.id)).toContain(guest.userId);
    const accounts = adminUserListSchema.parse(
      await (await get("/api/admin/users?kind=accounts", admin.cookie)).json(),
    );
    expect(accounts.users.every((u) => !u.isAnonymous)).toBe(true);

    const found = adminUserListSchema.parse(
      await (await get(`/api/admin/users?q=${encodeURIComponent(account.email.toUpperCase())}`, admin.cookie)).json(),
    );
    expect(found.users.map((u) => u.id)).toEqual([account.userId]);
    // `%` is a character, not a wildcard.
    const none = adminUserListSchema.parse(await (await get("/api/admin/users?q=%25", admin.cookie)).json());
    expect(none.users).toEqual([]);
  });

  it("pages with a cursor, without gaps or repeats, and refuses a forged one", async () => {
    // Same creation time for the whole batch: the id breaks the ties.
    const at = new Date("2020-01-01T00:00:00.123Z");
    const batch = Array.from({ length: ADMIN_USERS_PAGE_SIZE + 3 }, (_, i) => ({
      id: `page-${String(i).padStart(3, "0")}`,
      name: "x",
      email: `page-${i}@example.test`,
      createdAt: at,
      updatedAt: at,
      isAnonymous: true,
    }));
    await handle.db.insert(schema.user).values(batch);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/api/admin/users?kind=guests${cursor ? `&cursor=${cursor}` : ""}`;
      const page = adminUserListSchema.parse(await (await get(path, admin.cookie)).json());
      seen.push(...page.users.map((u) => u.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((id) => id.startsWith("page-"))).toEqual(batch.map((u) => u.id).reverse());
    expect((await get("/api/admin/users?cursor=nope", admin.cookie)).status).toBe(400);
  });

  it("keeps a cursor exact to the microsecond", () => {
    const position = { createdAt: "2026-11-14 10:00:00.123456", id: "abc" };
    expect(decodeUserCursor(encodeUserCursor(position))).toEqual(position);
    expect(decodeUserCursor(Buffer.from("2026-11-14|x|y").toString("base64url"))).toBeNull();
  });
});

describe("GET /api/admin/users/{id}", () => {
  it("gives counts and sign-in methods, never the wardrobe's contents", async () => {
    const account = await session("user", "email-otp");
    await seedEverything(account.userId, account.email);
    const res = await get(`/api/admin/users/${account.userId}`, admin.cookie);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const detail = adminUserDetailSchema.parse(JSON.parse(raw));
    expect(detail).toMatchObject({
      email: account.email,
      itemCount: 1,
      profiles: 1,
      wishlists: 1,
      spottedItems: 1,
      ownedItems: 0,
      sessions: 1,
      pushDevices: 1,
    });
    expect(detail.signInMethods).toEqual(["passkey", "google", "email-otp"]);
    // Privacy: none of her items, lists or tags is named.
    expect(raw).not.toMatch(/Robe|Envies|Étiquette/);
    expect((await get("/api/admin/users/unknown-id", admin.cookie)).status).toBe(404);
  });
});

describe("DELETE /api/admin/users/{id}", () => {
  it("deletes every row she owns and her stored photos, and is audited", async () => {
    const account = await session("user", "email-otp");
    const keys = await seedEverything(account.userId, account.email);
    const before = await rowsPointingTo(account.userId);
    // Every table that can point to a person holds one of her rows, so the check below proves them all. The audit log
    // only names admins, and an admin cannot be deleted.
    expect(Object.entries(before).filter(([fk, n]) => n === 0 && fk !== "admin_audit_log.admin_id")).toEqual([]);

    expect((await remove(account.userId, "someone-else@example.test", admin.cookie)).status).toBe(400);
    expect(await rowsPointingTo(account.userId)).toEqual(before);

    const res = await remove(account.userId, account.email.toUpperCase(), admin.cookie);
    expect(res.status).toBe(204);
    expect(Object.entries(await rowsPointingTo(account.userId)).filter(([, n]) => n > 0)).toEqual([]);
    expect(await handle.db.select().from(schema.user).where(eq(schema.user.id, account.userId))).toEqual([]);
    const codes = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from verification where identifier = ${`sign-in-otp-${account.email}`}`,
    );
    expect(codes.rows[0]?.n).toBe(0);
    for (const key of keys) await expect(store.get(key)).rejects.toThrow();
    // Her capture stays in the log, without her.
    const captures = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from captures where url like ${"https://admin-users-%"} and requested_by is null`,
    );
    expect(captures.rows[0]?.n).toBeGreaterThan(0);

    const audit = adminAuditPageSchema.parse(await (await get("/api/admin/audit", admin.cookie)).json());
    const entry = audit.entries.find((e) => e.target === `user:${account.userId}` && e.details.status === 204);
    expect(entry).toMatchObject({ action: "user.delete", adminId: admin.userId, details: { guest: false } });
    expect(JSON.stringify(audit.entries)).not.toContain(account.email);

    expect((await remove(account.userId, account.email, admin.cookie)).status).toBe(404);
  });

  it("deletes a guest confirmed with « SUPPRIMER »", async () => {
    const guest = await session("user", "anonymous", { guest: true });
    expect((await remove(guest.userId, "supprimer", admin.cookie)).status).toBe(400);
    expect((await remove(guest.userId, "SUPPRIMER", admin.cookie)).status).toBe(204);
    expect(await handle.db.select().from(schema.user).where(eq(schema.user.id, guest.userId))).toEqual([]);
    // Her session is gone: she is a stranger now.
    expect((await get("/api/me/summary", guest.cookie)).status).toBe(401);
  });

  it("refuses to delete herself or another admin", async () => {
    const res = await remove(admin.userId, admin.email, admin.cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "self" });
    const other = await session("admin", "passkey");
    const second = await remove(other.userId, other.email, admin.cookie);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "admin" });
    expect(await handle.db.select().from(schema.user).where(eq(schema.user.id, other.userId))).toHaveLength(1);
  });
});
