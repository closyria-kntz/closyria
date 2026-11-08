import { randomUUID } from "node:crypto";
import { eq, schema } from "@closyria/db";
import type { OpinionView, SharedWishlistView, WishlistView } from "@closyria/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";
import { upsertOpinion } from "../wardrobe/opinions";
import { hashShareToken } from "../wardrobe/share-token";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

const keyA = "A".repeat(22);
const keyB = "B".repeat(22);

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

/** A shared list with one item, opinions allowed. */
async function setup(settings: Partial<typeof schema.wishlists.$inferInsert> = {}) {
  const { cookie, userId } = await t.signIn();
  const k = ++counter;
  const list = (await (await call("POST", "/api/me/wishlists", cookie, { name: "Été" })).json()) as WishlistView;
  const profiles = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: { id: string }[] };
  const profile = profiles.profiles[0] as { id: string };
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique O${k}`, slug: `opinions-shop-${k}` })
    .returning();
  const [product] = await t.db
    .insert(schema.products)
    .values({
      shopId: shop?.id as string,
      canonicalUrl: `https://opinions-${k}.test/p`,
      name: `Robe ${k}`,
      priceCents: 4990,
      currency: "EUR",
    })
    .returning();
  const [item] = await t.db
    .insert(schema.items)
    .values({ userId, profileId: profile.id, productId: product?.id as string })
    .returning();
  if (!item) throw new Error("no item");
  expect((await call("POST", `/api/me/wishlists/${list.id}/items`, cookie, { itemId: item.id })).status).toBe(200);
  const share = await call("POST", `/api/me/wishlists/${list.id}/share`, cookie);
  const token = ((await share.json()) as { url: string }).url.slice("/l/".length);
  if (Object.keys(settings).length > 0)
    await t.db.update(schema.wishlists).set(settings).where(eq(schema.wishlists.id, list.id));
  return { cookie, userId, list, item, token };
}

const getShared = (token: string) => t.app.request(`/api/shared/${token}`);
const putOpinion = (token: string, itemId: string, body: unknown, ip = "1.1.1.1") =>
  t.app.request(`/api/shared/${token}/items/${itemId}/opinion`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
const delOpinion = (token: string, itemId: string, body: unknown) =>
  t.app.request(`/api/shared/${token}/items/${itemId}/opinion`, {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const opinion = (over: Record<string, unknown> = {}) => ({
  name: "Camille",
  level: 3,
  note: "Trop belle",
  deviceKey: keyA,
  ...over,
});
const opinionRowsOf = (listId: string) =>
  t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.wishlistId, listId));
const view = async (token: string) => (await (await getShared(token)).json()) as SharedWishlistView;

describe("public opinions", () => {
  it("writes, reads back (isNew false) and replaces with the same key", async () => {
    const s = await setup();
    const res = await putOpinion(s.token, s.item.id, opinion());
    expect(res.status).toBe(200);
    expect(((await res.json()) as OpinionView).isNew).toBe(false);
    expect((await putOpinion(s.token, s.item.id, opinion({ level: 4, note: null }))).status).toBe(200);
    const items = (await view(s.token)).items;
    expect(items[0]?.opinions).toHaveLength(1);
    expect(items[0]?.opinions[0]).toMatchObject({ name: "Camille", level: 4, note: null, isNew: false });
  });

  it("refuses the same name from another key, unless she claims it", async () => {
    const s = await setup();
    await putOpinion(s.token, s.item.id, opinion());
    const taken = await putOpinion(s.token, s.item.id, opinion({ name: "CAMILLE", deviceKey: keyB }));
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "name_taken" });
    const claimed = await putOpinion(s.token, s.item.id, opinion({ name: "CAMILLE", deviceKey: keyB, claim: true }));
    expect(claimed.status).toBe(200);
    expect((await view(s.token)).items[0]?.opinions).toHaveLength(1);
  });

  it("deletes only with a key attached to the name", async () => {
    const s = await setup();
    await putOpinion(s.token, s.item.id, opinion());
    const refused = await delOpinion(s.token, s.item.id, { name: "Camille", deviceKey: keyB });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    expect((await view(s.token)).items[0]?.opinions).toHaveLength(1);
    expect((await delOpinion(s.token, s.item.id, { name: "Camille", deviceKey: keyA })).status).toBe(204);
    expect((await view(s.token)).items[0]?.opinions).toHaveLength(0);
  });

  it("answers 403 opinions_closed when off, existing opinions stay visible", async () => {
    const s = await setup();
    await putOpinion(s.token, s.item.id, opinion());
    await t.db.update(schema.wishlists).set({ allowOpinions: false }).where(eq(schema.wishlists.id, s.list.id));
    const res = await putOpinion(s.token, s.item.id, opinion({ level: 1 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "opinions_closed" });
    const v = await view(s.token);
    expect(v.allowOpinions).toBe(false);
    expect(v.items[0]?.opinions).toHaveLength(1);
  });

  it("takes 40 flags as a name and 200 toned emojis as a note (graphemes, not code points)", async () => {
    const s = await setup();
    const res = await putOpinion(s.token, s.item.id, opinion({ name: "🇫🇷".repeat(40), note: "👍🏽".repeat(200) }));
    expect(res.status).toBe(200);
    expect(await opinionRowsOf(s.list.id)).toHaveLength(1);
  });

  it("refuses a web address in the name", async () => {
    const s = await setup();
    const res = await putOpinion(s.token, s.item.id, opinion({ name: "zara.com" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "web_address" });
    expect(await opinionRowsOf(s.list.id)).toHaveLength(0);
  });

  it("refuses a web address in the note", async () => {
    const s = await setup();
    const res = await putOpinion(s.token, s.item.id, opinion({ note: "www.zara.com" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "web_address" });
  });

  it("answers 404 for an item outside the list and for an unknown token", async () => {
    const s = await setup();
    expect((await putOpinion(s.token, randomUUID(), opinion())).status).toBe(404);
    expect((await putOpinion("a".repeat(22), s.item.id, opinion())).status).toBe(404);
  });

  it("limits to 30 writes an hour per key and list", async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++)
      expect((await putOpinion(s.token, s.item.id, opinion({ level: 1 + (i % 4) }))).status).toBe(200);
    expect((await putOpinion(s.token, s.item.id, opinion())).status).toBe(429);
  });

  it("survives two simultaneous writes with the same name and key", async () => {
    const s = await setup();
    const res = await Promise.all([
      putOpinion(s.token, s.item.id, opinion(), "2.2.2.2"),
      putOpinion(s.token, s.item.id, opinion({ level: 2 }), "2.2.2.3"),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const rows = await t.db
      .select()
      .from(schema.wishlistOpinions)
      .where(eq(schema.wishlistOpinions.wishlistId, s.list.id));
    expect(rows).toHaveLength(1);
  });

  it("erases opinions when the item leaves the list", async () => {
    const s = await setup();
    await putOpinion(s.token, s.item.id, opinion());
    await call("DELETE", `/api/me/wishlists/${s.list.id}/items/${s.item.id}`, s.cookie);
    expect(
      await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.wishlistId, s.list.id)),
    ).toHaveLength(0);
  });

  it("keeps opinions when sharing stops; a new share shows them and the same device still edits hers", async () => {
    const s = await setup();
    expect((await putOpinion(s.token, s.item.id, opinion())).status).toBe(200);
    expect((await call("DELETE", `/api/me/wishlists/${s.list.id}/share`, s.cookie)).status).toBe(204);
    expect(
      await t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.wishlistId, s.list.id)),
    ).toHaveLength(1);
    const again = await call("POST", `/api/me/wishlists/${s.list.id}/share`, s.cookie);
    const token = ((await again.json()) as { url: string }).url.slice("/l/".length);
    const view = (await (await getShared(token)).json()) as { items: { opinions: { name: string }[] }[] };
    expect(view.items.flatMap((i) => i.opinions.map((o) => o.name))).toEqual(["Camille"]);
    expect((await putOpinion(token, s.item.id, opinion({ level: 4 }))).status).toBe(200);
  });
});

describe("races and hidden items", () => {
  const input = (token: string, list: { id: string }, itemId: string) => ({
    ...opinion(),
    wishlistId: list.id,
    shareTokenHash: hashShareToken(token),
    itemId,
  });
  const rowsOf = (listId: string) =>
    t.db.select().from(schema.wishlistOpinions).where(eq(schema.wishlistOpinions.wishlistId, listId));

  it("writes nothing when the share stopped after the token was resolved", async () => {
    const s = await setup();
    await call("DELETE", `/api/me/wishlists/${s.list.id}/share`, s.cookie);
    expect(await upsertOpinion(t.db, input(s.token, s.list, s.item.id))).toEqual({ ok: false, error: "not_found" });
    expect(await rowsOf(s.list.id)).toHaveLength(0);
  });

  it("writes nothing when the item left the list after the token was resolved", async () => {
    const s = await setup();
    await call("DELETE", `/api/me/wishlists/${s.list.id}/items/${s.item.id}`, s.cookie);
    expect(await upsertOpinion(t.db, input(s.token, s.list, s.item.id))).toEqual({ ok: false, error: "not_found" });
    expect(await rowsOf(s.list.id)).toHaveLength(0);
  });

  it("answers 404 for an item in the trash", async () => {
    const s = await setup();
    await t.db.update(schema.items).set({ deletedAt: new Date() }).where(eq(schema.items.id, s.item.id));
    expect((await putOpinion(s.token, s.item.id, opinion())).status).toBe(404);
    expect(await rowsOf(s.list.id)).toHaveLength(0);
  });
});

describe("public view", () => {
  it("never shows a guest's placeholder name (« Anonymous »)", async () => {
    const s = await setup({ showOwnerName: true });
    const [owner] = await t.db.select().from(schema.user).where(eq(schema.user.id, s.userId));
    expect(owner).toMatchObject({ name: "Anonymous", isAnonymous: true });
    expect((await view(s.token)).ownerName).toBeNull();
  });

  it("shows the first name, owner opinion and budget amount only when allowed", async () => {
    const s = await setup({ showOwnerName: false, showOwnerOpinions: false, showBudget: false });
    await t.db
      .update(schema.user)
      .set({ name: "Amina Benali", isAnonymous: false })
      .where(eq(schema.user.id, s.userId));
    await t.db
      .update(schema.items)
      .set({ loveLevel: 4, priority: true, why: "Pour l'été", notes: "secret", sizeLabel: "M" })
      .where(eq(schema.items.id, s.item.id));
    const mediaId = randomUUID();
    await t.db.insert(schema.media).values({
      id: mediaId,
      userId: s.userId,
      key: `private-${mediaId}`,
      contentType: "image/jpeg",
      sizeBytes: 10,
      width: 5,
      height: 5,
    });
    await t.db.insert(schema.itemMedia).values({ itemId: s.item.id, mediaId });
    await t.db
      .insert(schema.budgets)
      .values({ userId: s.userId, wishlistId: s.list.id, amountCents: 20000, period: "month" });
    const closed = await view(s.token);
    expect(closed.ownerName).toBeNull();
    expect(closed.budget).toBeNull();
    expect(closed.items[0]?.ownerOpinion).toBeNull();

    await t.db
      .update(schema.wishlists)
      .set({ showOwnerName: true, showOwnerOpinions: true, showBudget: true })
      .where(eq(schema.wishlists.id, s.list.id));
    const res = await getShared(s.token);
    const text = await res.text();
    const open = JSON.parse(text) as SharedWishlistView;
    expect(open.ownerName).toBe("Amina");
    expect(open.budget).toEqual({ amountCents: 20000, currency: "EUR" });
    expect(open.items[0]?.ownerOpinion).toEqual({ level: 4, priority: true, why: "Pour l'été" });
    for (const key of ["notes", "sizeLabel", "sizeNote", "profileId", "photos", "media", "mediaId"])
      expect(Object.keys(open.items[0] ?? {})).not.toContain(key);
    for (const key of ["period", "startsOn", "endsOn", "spentCents", "spent", "remainingCents", "current"])
      expect(Object.keys(open.budget ?? {})).not.toContain(key);
    for (const key of ["userId", "email", "profiles", "notes"]) expect(Object.keys(open)).not.toContain(key);
    expect(text).not.toContain(mediaId);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("period");
  });

  it("leaves ownerOpinion null when nothing is filled in", async () => {
    const s = await setup({ showOwnerOpinions: true });
    expect((await view(s.token)).items[0]?.ownerOpinion).toBeNull();
  });

  it("follows her renamed levels", async () => {
    const s = await setup();
    const levels = [1, 2, 3, 4].map((level) => ({ level, emoji: "🌸", label: `Niveau ${level}` }));
    expect((await call("PUT", "/api/me/love-levels", s.cookie, { levels })).status).toBe(200);
    expect((await view(s.token)).levels.map((l) => l.label)).toEqual(levels.map((l) => l.label));
  });
});
