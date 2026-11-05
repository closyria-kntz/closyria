import { randomUUID } from "node:crypto";
import { type Auth, createAuth, memoryMailer } from "@closyria/auth";
import { and, asc, createDb, eq, inArray, isNull, schema, sql } from "@closyria/db";
import type { TestDatabase } from "@closyria/testing";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerOwnedTables } from "../owned-tables";

/**
 * Anonymous -> account merge (spec §3 « Fusion anonyme → compte », point de vigilance 4), through the real Better Auth
 * link: an anonymous session signs in with an e-mail code, `onLinkAccount` runs `reassignUserData` with the tables
 * registered by the API process, then Better Auth deletes the anonymous user.
 */

const BASE_URL = "http://localhost:3001";
let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let mailer: ReturnType<typeof memoryMailer>;
let auth: Auth;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {}); // memoryMailer's log line
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 5 });
  registerOwnedTables();
  mailer = memoryMailer();
  auth = createAuth({
    db: handle.db,
    mailer,
    baseUrl: BASE_URL,
    secret: "test-secret-that-is-long-enough-0123456789",
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

async function call(path: string, body?: unknown, cookie?: string) {
  const headers = new Headers({
    origin: BASE_URL,
    "x-forwarded-for": `10.7.0.${++counter % 250}`,
    "user-agent": "closyria-tests",
  });
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method: "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

const cookieFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function signInAnonymously() {
  const res = await call("/sign-in/anonymous");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return { cookie: cookieFrom(res), userId: body.user.id };
}

/** Signs in with an e-mail code, from the given (anonymous) session if any; returns the account id. */
async function signInWithEmail(email: string, cookie?: string): Promise<string> {
  expect((await call("/email-otp/send-verification-otp", { email, type: "sign-in" })).status).toBe(200);
  const code = mailer.messages.at(-1)?.text.match(/(?<!\d)\d+(?!\d)/)?.[0];
  const res = await call("/sign-in/email-otp", { email, otp: code }, cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { user: { id: string } }).user.id;
}

async function newProduct() {
  const n = ++counter;
  const [shop] = await handle.db
    .insert(schema.shops)
    .values({ name: `Boutique M${n}`, slug: `merge-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await handle.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://merge-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

async function newProfile(userId: string, name: string, createdAt: Date, position = 0) {
  const [row] = await handle.db
    .insert(schema.profiles)
    .values({ userId, name, audience: "women", color: "plum", position, createdAt })
    .returning();
  if (!row) throw new Error("no profile");
  return row;
}

async function newTag(userId: string, name: string, color: string | null = null) {
  const [row] = await handle.db.insert(schema.tags).values({ userId, name, color }).returning();
  if (!row) throw new Error("no tag");
  return row;
}

async function newList(userId: string, name: string, position = 0) {
  const [row] = await handle.db.insert(schema.wishlists).values({ userId, name, position }).returning();
  if (!row) throw new Error("no list");
  return row;
}

async function newMedia(userId: string) {
  const id = randomUUID();
  const [row] = await handle.db
    .insert(schema.media)
    .values({
      id,
      userId,
      key: `users/${userId}/${id}.webp`,
      contentType: "image/webp",
      sizeBytes: 10,
      width: 3,
      height: 4,
    })
    .returning();
  if (!row) throw new Error("no media");
  return row;
}

async function newItem(values: typeof schema.items.$inferInsert) {
  const [row] = await handle.db.insert(schema.items).values(values).returning();
  if (!row) throw new Error("no item");
  return row;
}

const day = (n: number) => new Date(Date.UTC(2026, 10, n));

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const result = await handle.db.execute<{ n: number }>(query);
  return result.rows[0]?.n ?? -1;
}

/** Rows left behind by the anonymous user, and links that cross two users (none may survive a merge). */
async function expectNothingLeftOrCrossed(anonymousId: string) {
  expect(await count(sql`select count(*)::int as n from "user" where id = ${anonymousId}`)).toBe(0);
  for (const table of ["profiles", "tags", "items", "wishlists", "media", "events"]) {
    expect(
      await count(sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${anonymousId}`),
    ).toBe(0);
  }
  expect(
    await count(sql`select count(*)::int as n from items i join profiles p on p.id = i.profile_id
      where p.user_id <> i.user_id`),
  ).toBe(0);
  expect(
    await count(sql`select count(*)::int as n from item_tags it join items i on i.id = it.item_id
      join tags t on t.id = it.tag_id where t.user_id <> i.user_id`),
  ).toBe(0);
  expect(
    await count(sql`select count(*)::int as n from wishlist_items wi join items i on i.id = wi.item_id
      join wishlists w on w.id = wi.wishlist_id where w.user_id <> i.user_id`),
  ).toBe(0);
  expect(
    await count(sql`select count(*)::int as n from item_media im join items i on i.id = im.item_id
      join media m on m.id = im.media_id where m.user_id <> i.user_id`),
  ).toBe(0);
  expect(
    await count(sql`select count(*)::int as n from item_events e join items i on i.id = e.item_id
      left join profiles f on f.id = e.from_profile_id left join profiles t on t.id = e.to_profile_id
      where f.user_id <> i.user_id or t.user_id <> i.user_id`),
  ).toBe(0);
}

const profilesOf = (userId: string) =>
  handle.db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .orderBy(asc(schema.profiles.position), asc(schema.profiles.createdAt));

async function tagNamesOf(itemId: string) {
  const rows = await handle.db
    .select({ name: schema.tags.name })
    .from(schema.itemTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.itemTags.tagId))
    .where(eq(schema.itemTags.itemId, itemId));
  return rows.map((r) => r.name).sort();
}

async function listIdsOf(itemId: string) {
  const rows = await handle.db
    .select({ id: schema.wishlistItems.wishlistId })
    .from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.itemId, itemId));
  return rows.map((r) => r.id).sort();
}

/** Everything a user holds in the wardrobe tables, to check a bystander is left untouched. */
async function wardrobeOf(userId: string) {
  const rows = async (query: ReturnType<typeof sql>) => (await handle.db.execute(query)).rows;
  return {
    profiles: await rows(sql`select * from profiles where user_id = ${userId} order by id`),
    tags: await rows(sql`select * from tags where user_id = ${userId} order by id`),
    items: await rows(sql`select * from items where user_id = ${userId} order by id`),
    wishlists: await rows(sql`select * from wishlists where user_id = ${userId} order by id`),
    itemTags: await rows(sql`select it.* from item_tags it join items i on i.id = it.item_id
      where i.user_id = ${userId} order by it.item_id, it.tag_id`),
    wishlistItems: await rows(sql`select wi.* from wishlist_items wi join items i on i.id = wi.item_id
      where i.user_id = ${userId} order by wi.wishlist_id, wi.item_id`),
  };
}

describe("anonymous -> account merge on sign-in", () => {
  it("merges into an account that already has the same product and same-name tags: no duplicate, nothing lost", async () => {
    const email = `garde-${randomUUID()}@example.test`;
    const accountId = await signInWithEmail(email);
    const shared = await newProduct(); // kept on both sides
    const onlyAnonymous = await newProduct();
    const inChildProfile = await newProduct();
    const onlyAccount = await newProduct();

    // The account: « Moi » (first by position) and « Léa », tags « Été » and « Travail », a list, two items.
    const accountMoi = await newProfile(accountId, "Moi", day(1), 0);
    const lea = await newProfile(accountId, "Léa", day(2), 1);
    const summer = await newTag(accountId, "Été"); // no colour: takes the anonymous one
    const work = await newTag(accountId, "Travail", "plum"); // has one: keeps it
    const accountList = await newList(accountId, "Mes envies", 0);
    const accountMedia = await newMedia(accountId);
    const accountItem = await newItem({
      userId: accountId,
      profileId: accountMoi.id,
      productId: shared.id,
      stage: "owned",
      notes: "compte",
      pricePaidCents: 3000,
    });
    await handle.db.insert(schema.itemMedia).values({ itemId: accountItem.id, mediaId: accountMedia.id, position: 0 });
    await handle.db.insert(schema.itemTags).values({ itemId: accountItem.id, tagId: summer.id });
    await handle.db.insert(schema.wishlistItems).values({ wishlistId: accountList.id, itemId: accountItem.id });
    const accountOnlyItem = await newItem({ userId: accountId, profileId: lea.id, productId: onlyAccount.id });
    await handle.db.insert(schema.itemTags).values({ itemId: accountOnlyItem.id, tagId: work.id });

    // A third user with the same product and tag names: never touched.
    const bystander = await signInAnonymously();
    const bystanderMoi = await newProfile(bystander.userId, "Moi", day(1));
    const bystanderTag = await newTag(bystander.userId, "été");
    const bystanderList = await newList(bystander.userId, "Idées");
    const bystanderItem = await newItem({ userId: bystander.userId, profileId: bystanderMoi.id, productId: shared.id });
    await handle.db.insert(schema.itemTags).values({ itemId: bystanderItem.id, tagId: bystanderTag.id });
    await handle.db.insert(schema.wishlistItems).values({ wishlistId: bystanderList.id, itemId: bystanderItem.id });
    const bystanderBefore = await wardrobeOf(bystander.userId);

    // The anonymous visitor: « Moi » and « Bébé », tags « été » (same name, other case) and « Soldes », a list.
    const anonymous = await signInAnonymously();
    const anonId = anonymous.userId;
    const anonMoi = await newProfile(anonId, "Moi", day(3), 0);
    const baby = await newProfile(anonId, "Bébé", day(4), 1);
    const anonSummer = await newTag(anonId, "été", "rose");
    const sales = await newTag(anonId, "Soldes");
    await newTag(anonId, "travail", "sage");
    const anonList = await newList(anonId, "Idées", 0);
    const anonMedia = await newMedia(anonId);
    const anonItem = await newItem({
      userId: anonId,
      profileId: anonMoi.id,
      productId: shared.id,
      stage: "for_sale",
      favorite: true,
      sizeLabel: "M",
      notes: "anonyme",
      pricePaidCents: 2500,
      salePriceCents: 2000,
    });
    await handle.db.insert(schema.itemMedia).values({ itemId: anonItem.id, mediaId: anonMedia.id, position: 0 });
    await handle.db.insert(schema.itemTags).values([
      { itemId: anonItem.id, tagId: anonSummer.id },
      { itemId: anonItem.id, tagId: sales.id },
    ]);
    await handle.db.insert(schema.wishlistItems).values({ wishlistId: anonList.id, itemId: anonItem.id });
    const [stageEvent] = await handle.db
      .insert(schema.itemEvents)
      .values({ itemId: anonItem.id, type: "stage", stage: "for_sale", at: day(5) })
      .returning();
    const anonOther = await newItem({ userId: anonId, profileId: anonMoi.id, productId: onlyAnonymous.id });
    await handle.db.insert(schema.itemTags).values({ itemId: anonOther.id, tagId: anonSummer.id });
    const [profileEvent] = await handle.db
      .insert(schema.itemEvents)
      .values({ itemId: anonOther.id, type: "profile", fromProfileId: baby.id, toProfileId: anonMoi.id, at: day(6) })
      .returning();
    const childItem = await newItem({ userId: anonId, profileId: baby.id, productId: inChildProfile.id });
    // A trashed item for the shared product: moves as it is (the uniqueness only covers active items).
    const trashed = await newItem({
      userId: anonId,
      profileId: anonMoi.id,
      productId: shared.id,
      deletedAt: day(7),
    });

    expect(await signInWithEmail(email, anonymous.cookie)).toBe(accountId);

    await expectNothingLeftOrCrossed(anonId);

    // Profiles: « Moi » merged into « Moi », « Bébé » added after the account's.
    const profiles = await profilesOf(accountId);
    expect(profiles.map((p) => p.name)).toEqual(["Moi", "Léa", "Bébé"]);
    expect(profiles[0]?.id).toBe(accountMoi.id);
    expect(profiles[2]?.id).toBe(baby.id);

    // Tags: « été » merged into « Été », « Soldes » added.
    const tags = await handle.db.select().from(schema.tags).where(eq(schema.tags.userId, accountId));
    expect(Object.fromEntries(tags.map((t) => [t.name, t.color]))).toEqual({
      Été: "rose",
      Travail: "plum",
      Soldes: null,
    });
    expect(tags.find((t) => t.name === "Été")?.id).toBe(summer.id);

    // The shared product: one active item, the account's, merged.
    const active = await handle.db
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.userId, accountId), eq(schema.items.productId, shared.id), isNull(schema.items.deletedAt)),
      );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      id: accountItem.id,
      userId: accountId,
      profileId: accountMoi.id,
      stage: "for_sale",
      favorite: true,
      sizeLabel: "M",
      notes: "compte",
      pricePaidCents: 3000,
      salePriceCents: 2000,
    });
    const photos = await handle.db
      .select()
      .from(schema.itemMedia)
      .where(eq(schema.itemMedia.itemId, accountItem.id))
      .orderBy(asc(schema.itemMedia.position));
    expect(photos.map((p) => p.mediaId)).toEqual([accountMedia.id, anonMedia.id]);
    expect(await tagNamesOf(accountItem.id)).toEqual(["Soldes", "Été"]);
    expect(await listIdsOf(accountItem.id)).toEqual([accountList.id, anonList.id].sort());
    const events = await handle.db.select().from(schema.itemEvents).where(eq(schema.itemEvents.itemId, accountItem.id));
    expect(events.map((e) => e.id)).toEqual([stageEvent?.id]);
    expect(await count(sql`select count(*)::int as n from items where id = ${anonItem.id}`)).toBe(0);

    // The other items move, in « Moi » of the account or in their moved profile, with merged tags.
    const moved = await handle.db
      .select()
      .from(schema.items)
      .where(inArray(schema.items.id, [anonOther.id, childItem.id, trashed.id]));
    expect(Object.fromEntries(moved.map((i) => [i.id, [i.userId, i.profileId, i.deletedAt !== null]]))).toEqual({
      [anonOther.id]: [accountId, accountMoi.id, false],
      [childItem.id]: [accountId, baby.id, false],
      [trashed.id]: [accountId, accountMoi.id, true],
    });
    expect(await tagNamesOf(anonOther.id)).toEqual(["Été"]);
    const [repointed] = await handle.db
      .select()
      .from(schema.itemEvents)
      .where(eq(schema.itemEvents.id, profileEvent?.id ?? ""));
    expect(repointed).toMatchObject({ fromProfileId: baby.id, toProfileId: accountMoi.id });

    // The account's own data is untouched; lists added, duplicate names allowed.
    expect(await tagNamesOf(accountOnlyItem.id)).toEqual(["Travail"]);
    const lists = await handle.db
      .select()
      .from(schema.wishlists)
      .where(eq(schema.wishlists.userId, accountId))
      .orderBy(asc(schema.wishlists.position));
    expect(lists.map((l) => l.name)).toEqual(["Mes envies", "Idées"]);

    expect(await wardrobeOf(bystander.userId)).toEqual(bystanderBefore);
  });

  it("folds into the first profile by position, not the oldest one", async () => {
    const email = `position-${randomUUID()}@example.test`;
    const accountId = await signInWithEmail(email);
    const moi = await newProfile(accountId, "Moi", day(1), 1);
    const lea = await newProfile(accountId, "Léa", day(2), 0); // newer, but first by position
    const anonymous = await signInAnonymously();
    const anonPrimary = await newProfile(anonymous.userId, "Moi", day(3), 0);
    const anonOlder = await newProfile(anonymous.userId, "Ancien", day(1), 1);
    const product = await newProduct();
    const item = await newItem({ userId: anonymous.userId, profileId: anonPrimary.id, productId: product.id });

    expect(await signInWithEmail(email, anonymous.cookie)).toBe(accountId);

    await expectNothingLeftOrCrossed(anonymous.userId);
    expect((await profilesOf(accountId)).map((p) => [p.id, p.position])).toEqual([
      [lea.id, 0],
      [moi.id, 1],
      [anonOlder.id, 2],
    ]);
    const [movedItem] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(movedItem).toMatchObject({ userId: accountId, profileId: lea.id });
  });

  it("never merges a trashed item: active beside trashed, trashed beside trashed", async () => {
    const email = `corbeille-${randomUUID()}@example.test`;
    const accountId = await signInWithEmail(email);
    const accountMoi = await newProfile(accountId, "Moi", day(1));
    const trashedOnAccount = await newProduct();
    const trashedOnBoth = await newProduct();
    const accountTrashed = await newItem({
      userId: accountId,
      profileId: accountMoi.id,
      productId: trashedOnAccount.id,
      stage: "owned",
      deletedAt: day(2),
    });
    const accountTrashedToo = await newItem({
      userId: accountId,
      profileId: accountMoi.id,
      productId: trashedOnBoth.id,
      deletedAt: day(2),
    });
    const anonymous = await signInAnonymously();
    const anonMoi = await newProfile(anonymous.userId, "Moi", day(3));
    const anonActive = await newItem({
      userId: anonymous.userId,
      profileId: anonMoi.id,
      productId: trashedOnAccount.id,
      favorite: true,
    });
    const anonTrashed = await newItem({
      userId: anonymous.userId,
      profileId: anonMoi.id,
      productId: trashedOnBoth.id,
      deletedAt: day(4),
    });

    expect(await signInWithEmail(email, anonymous.cookie)).toBe(accountId);

    await expectNothingLeftOrCrossed(anonymous.userId);
    const rows = await handle.db
      .select()
      .from(schema.items)
      .where(eq(schema.items.userId, accountId))
      .orderBy(asc(schema.items.id));
    const state = Object.fromEntries(rows.map((i) => [i.id, [i.productId, i.stage, i.favorite, i.deletedAt !== null]]));
    expect(state).toEqual({
      [accountTrashed.id]: [trashedOnAccount.id, "owned", false, true],
      [accountTrashedToo.id]: [trashedOnBoth.id, "spotted", false, true],
      [anonActive.id]: [trashedOnAccount.id, "spotted", true, false],
      [anonTrashed.id]: [trashedOnBoth.id, "spotted", false, true],
    });
    expect(rows.find((i) => i.id === anonActive.id)?.profileId).toBe(accountMoi.id);
  });

  it("moves several profiles into an account with none, positions in their order from 0", async () => {
    const email = `profils-${randomUUID()}@example.test`;
    const accountId = await signInWithEmail(email);
    const anonymous = await signInAnonymously();
    const second = await newProfile(anonymous.userId, "Léa", day(1), 4);
    const first = await newProfile(anonymous.userId, "Moi", day(2), 2);
    const third = await newProfile(anonymous.userId, "Bébé", day(3), 9);
    const product = await newProduct();
    const item = await newItem({ userId: anonymous.userId, profileId: third.id, productId: product.id });

    expect(await signInWithEmail(email, anonymous.cookie)).toBe(accountId);

    await expectNothingLeftOrCrossed(anonymous.userId);
    expect((await profilesOf(accountId)).map((p) => [p.id, p.position])).toEqual([
      [first.id, 0],
      [second.id, 1],
      [third.id, 2],
    ]);
    const [movedItem] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(movedItem).toMatchObject({ userId: accountId, profileId: third.id });
  });

  it("moves everything as it is when the account has no wardrobe yet", async () => {
    const email = `vide-${randomUUID()}@example.test`;
    const accountId = await signInWithEmail(email);
    const anonymous = await signInAnonymously();
    const anonMoi = await newProfile(anonymous.userId, "Moi", day(1));
    const tag = await newTag(anonymous.userId, "Été");
    const list = await newList(anonymous.userId, "Idées");
    const product = await newProduct();
    const item = await newItem({ userId: anonymous.userId, profileId: anonMoi.id, productId: product.id });
    await handle.db.insert(schema.itemTags).values({ itemId: item.id, tagId: tag.id });
    await handle.db.insert(schema.wishlistItems).values({ wishlistId: list.id, itemId: item.id });

    expect(await signInWithEmail(email, anonymous.cookie)).toBe(accountId);

    await expectNothingLeftOrCrossed(anonymous.userId);
    expect((await profilesOf(accountId)).map((p) => p.id)).toEqual([anonMoi.id]);
    const [movedItem] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(movedItem).toMatchObject({ userId: accountId, profileId: anonMoi.id });
    expect(await tagNamesOf(item.id)).toEqual(["Été"]);
    expect(await listIdsOf(item.id)).toEqual([list.id]);
  });

  it("moves everything to a brand new account", async () => {
    const anonymous = await signInAnonymously();
    const anonMoi = await newProfile(anonymous.userId, "Moi", day(1));
    const product = await newProduct();
    const item = await newItem({ userId: anonymous.userId, profileId: anonMoi.id, productId: product.id });

    const accountId = await signInWithEmail(`nouvelle-${randomUUID()}@example.test`, anonymous.cookie);

    expect(accountId).not.toBe(anonymous.userId);
    await expectNothingLeftOrCrossed(anonymous.userId);
    const [movedItem] = await handle.db.select().from(schema.items).where(eq(schema.items.id, item.id));
    expect(movedItem).toMatchObject({ userId: accountId, profileId: anonMoi.id });
  });
});
