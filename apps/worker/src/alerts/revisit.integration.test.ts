import { createDb, eq, inArray, schema, trackingImpossible } from "@closyria/db";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { planRevisits, REVISIT_BUDGET, REVISIT_INTERVAL_MS, revisitHandler } from "./revisit";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 4 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

const at = new Date("2026-11-14T13:00:00Z");
const hoursAgo = (n: number) => new Date(at.getTime() - n * 60 * 60_000);

let sent: { queue: string; captureId: string }[] = [];
const queue = {
  send: async (name: string, data: object) => {
    sent.push({ queue: name, captureId: (data as { captureId: string }).captureId });
    return null;
  },
};

beforeEach(async () => {
  sent = [];
  // Each test sees only its own products: earlier ones leave the follow.
  await handle.db.update(schema.items).set({ alertsEnabled: false });
  await handle.db.delete(schema.crawlSlowdowns);
});

async function person() {
  const n = ++counter;
  const userId = `revisit-user-${n}`;
  await handle.db.insert(schema.user).values({ id: userId, name: userId, email: `${userId}@example.test` });
  const [profile] = await handle.db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum" })
    .returning();
  if (!profile) throw new Error("no profile");
  return { userId, profileId: profile.id };
}

async function shopRow(values: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [shop] = await handle.db
    .insert(schema.shops)
    .values({ name: `Revisit ${n}`, slug: `revisit-${n}`, platform: "other", status: "published", ...values })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

/** A product of `shopId`, captured `capturedHoursAgo` hours ago, in someone's followed wishes unless told otherwise. */
async function tracked(
  shopId: string,
  capturedHoursAgo: number | null = 7,
  options: { follow?: boolean; item?: Partial<typeof schema.items.$inferInsert> } = {},
) {
  const n = ++counter;
  const [product] = await handle.db
    .insert(schema.products)
    .values({
      shopId,
      canonicalUrl: `https://revisit-${n}.example/p`,
      name: "Robe Iris",
      captureStatus: "ok",
      lastCapturedAt: capturedHoursAgo === null ? null : hoursAgo(capturedHoursAgo),
    })
    .returning();
  if (!product) throw new Error("no product");
  if (options.follow !== false) {
    const owner = await person();
    await handle.db
      .insert(schema.items)
      .values({ userId: owner.userId, profileId: owner.profileId, productId: product.id, ...options.item });
  }
  return product.id;
}

async function capturesOf(productIds: string[]) {
  return handle.db.select().from(schema.captures).where(inArray(schema.captures.productId, productIds));
}

async function failedCapture(shopId: string, errorCode: string, createdAt: Date) {
  await handle.db.insert(schema.captures).values({
    shopId,
    url: "https://revisit.example/x",
    trigger: "user",
    status: "failed",
    errorCode,
    createdAt,
    finishedAt: createdAt,
  });
}

describe("planRevisits", () => {
  it("queues one low-priority revisit for a followed product of a shop without import, checked over 6 h ago", async () => {
    const shop = await shopRow();
    const productId = await tracked(shop.id, 7);

    expect(await planRevisits(handle.db, queue, at)).toBe(1);

    const [capture] = await capturesOf([productId]);
    expect(capture).toMatchObject({ trigger: "revisit", status: "queued", shopId: shop.id, productId });
    expect(sent).toEqual([{ queue: "capture-revisit", captureId: capture?.id }]);
  });

  it("leaves a product checked within 6 h, and one nobody follows (ordered, trashed, alerts off)", async () => {
    const shop = await shopRow();
    const fresh = await tracked(shop.id, 5);
    const ordered = await tracked(shop.id, 7, { item: { stage: "ordered" } });
    const trashed = await tracked(shop.id, 7, { item: { deletedAt: hoursAgo(1) } });
    const muted = await tracked(shop.id, 7, { item: { alertsEnabled: false } });
    const orphan = await tracked(shop.id, 7, { follow: false });

    expect(await planRevisits(handle.db, queue, at)).toBe(0);
    expect(await capturesOf([fresh, ordered, trashed, muted, orphan])).toEqual([]);
  });

  it("leaves a shop whose hourly import reads it already, but revisits one whose import cannot run", async () => {
    const imported = await shopRow({ platform: "shopify", importEnabled: true });
    const importedWoo = await shopRow({ platform: "woocommerce", importEnabled: true });
    const off = await shopRow({ platform: "shopify", importEnabled: false });
    const notImportable = await shopRow({ platform: "prestashop", importEnabled: true });
    const major = await shopRow({ platform: "shopify", importEnabled: true, isMajorBrand: true });
    const pending = await shopRow({ platform: "shopify", importEnabled: true, status: "pending" });
    const covered = [await tracked(imported.id), await tracked(importedWoo.id)];
    const revisited = [
      await tracked(off.id),
      await tracked(notImportable.id),
      await tracked(major.id),
      await tracked(pending.id),
    ];

    expect(await planRevisits(handle.db, queue, at)).toBe(4);
    expect(await capturesOf(covered)).toEqual([]);
    expect((await capturesOf(revisited)).map((c) => c.productId).sort()).toEqual([...revisited].sort());
  });

  it("never revisits a shop whose last capture was blocked or refused by robots.txt, nor a blocking major brand", async () => {
    const blocked = await shopRow();
    await failedCapture(blocked.id, "blocked", hoursAgo(10));
    const robots = await shopRow();
    await failedCapture(robots.id, "robots_disallowed", hoursAgo(10));
    const recovered = await shopRow();
    await failedCapture(recovered.id, "blocked", hoursAgo(20));
    await handle.db.insert(schema.captures).values({
      shopId: recovered.id,
      url: "https://revisit.example/y",
      trigger: "monitor",
      status: "succeeded",
      method: "jsonld",
      createdAt: hoursAgo(10),
    });
    const timedOut = await shopRow();
    await failedCapture(timedOut.id, "timeout", hoursAgo(10));
    const manualMajor = await shopRow({ isMajorBrand: true, captureMode: "manual" });
    const refused = await shopRow({ status: "refused" });
    const never = [await tracked(blocked.id), await tracked(robots.id), await tracked(manualMajor.id)];
    const neverEither = await tracked(refused.id);
    const revisited = [await tracked(recovered.id), await tracked(timedOut.id)];

    expect(await planRevisits(handle.db, queue, at)).toBe(2);
    expect(await capturesOf([...never, neverEither])).toEqual([]);
    expect((await capturesOf(revisited)).map((c) => c.productId).sort()).toEqual([...revisited].sort());
  });

  it(`takes at most ${REVISIT_BUDGET} products a pass, the longest unchecked first`, async () => {
    const shop = await shopRow();
    const ids: string[] = [];
    // Oldest last in insertion order: the order comes from the check date, not the table.
    for (let i = 0; i < REVISIT_BUDGET + 5; i++) ids.push(await tracked(shop.id, 7 + i));
    const never = await tracked(shop.id, null);

    expect(await planRevisits(handle.db, queue, at)).toBe(REVISIT_BUDGET);
    const queued = new Set((await capturesOf([...ids, never])).map((c) => c.productId));
    expect(queued.size).toBe(REVISIT_BUDGET);
    expect(queued.has(never)).toBe(true);
    // The 6 most recently checked (7 to 12 h ago) wait for the next pass.
    for (const id of ids.slice(0, 6)) expect(queued.has(id)).toBe(false);
    // The next pass takes the 6 left; the 60 already queued are not queued twice.
    expect(await planRevisits(handle.db, queue, at)).toBe(6);
    expect(await capturesOf([...ids, never])).toHaveLength(REVISIT_BUDGET + 6);
    await handle.db
      .update(schema.captures)
      .set({ status: "failed", errorCode: "timeout" })
      .where(inArray(schema.captures.productId, [...ids, never]));
    // Revisited within 6 h, even without success: nothing more before 6 h.
    expect(await planRevisits(handle.db, queue, at)).toBe(0);
  });

  it("Shopify in the nightly rhythm: no Shopify revisit, the other shops go on; doubled changes nothing", async () => {
    const shopify = await shopRow({ platform: "shopify" });
    const other = await shopRow({ platform: "wix" });
    const onShopify = await tracked(shopify.id);
    const elsewhere = await tracked(other.id);
    await handle.db.insert(schema.crawlSlowdowns).values({
      platform: "shopify",
      level: "nightly",
      since: hoursAgo(1),
      until: new Date(at.getTime() + 60 * 60_000),
      updatedAt: hoursAgo(1),
    });

    expect(await planRevisits(handle.db, queue, at)).toBe(1);
    expect(await capturesOf([onShopify])).toEqual([]);
    expect(await capturesOf([elsewhere])).toHaveLength(1);

    await handle.db.update(schema.crawlSlowdowns).set({ level: "doubled" });
    expect(await planRevisits(handle.db, queue, at)).toBe(1);
    expect(await capturesOf([onShopify])).toHaveLength(1);
  });

  it("one capture per product: several followers, or a capture already under way, queue nothing more", async () => {
    const shop = await shopRow();
    const shared = await tracked(shop.id);
    const other = await person();
    await handle.db
      .insert(schema.items)
      .values({ userId: other.userId, profileId: other.profileId, productId: shared });
    const busy = await tracked(shop.id);
    await handle.db.insert(schema.captures).values({
      shopId: shop.id,
      productId: busy,
      url: "https://revisit.example/b",
      trigger: "user",
      status: "running",
    });

    expect(await planRevisits(handle.db, queue, at)).toBe(1);
    expect(await capturesOf([shared])).toHaveLength(1);
    expect((await capturesOf([busy])).map((c) => c.trigger)).toEqual(["user"]);
  });

  it("revisits again 6 h after the last revisit", async () => {
    const shop = await shopRow();
    const productId = await tracked(shop.id, 30);
    expect(await planRevisits(handle.db, queue, at)).toBe(1);
    await handle.db
      .update(schema.captures)
      .set({ status: "succeeded" })
      .where(eq(schema.captures.productId, productId));
    expect(await planRevisits(handle.db, queue, new Date(at.getTime() + REVISIT_INTERVAL_MS - 60_000))).toBe(0);
    expect(await planRevisits(handle.db, queue, new Date(at.getTime() + REVISIT_INTERVAL_MS + 60_000))).toBe(1);
  });

  it("a queue that cannot take the job: the capture fails with queue_unavailable", async () => {
    const shop = await shopRow();
    const productId = await tracked(shop.id);
    const broken = {
      send: async () => {
        throw new Error("queue down");
      },
    };
    expect(await planRevisits(handle.db, broken, at)).toBe(0);
    const [capture] = await capturesOf([productId]);
    expect(capture).toMatchObject({ status: "failed", errorCode: "queue_unavailable" });
  });
});

describe("revisitHandler", () => {
  it("a job without data plans the revisits; one with a captureId runs it; other data fails", async () => {
    const shop = await shopRow();
    // Never checked: due whatever the clock (the handler plans at the real time).
    const productId = await tracked(shop.id, null);
    const ran: string[] = [];
    const handler = revisitHandler(handle.db, queue, async (captureId) => {
      ran.push(captureId);
    });

    await handler([{ data: {} }]);
    const [capture] = await capturesOf([productId]);
    expect(capture?.trigger).toBe("revisit");
    expect(ran).toEqual([]);

    if (!capture) throw new Error("no capture");
    await handler([{ data: { captureId: capture.id } }]);
    expect(ran).toEqual([capture.id]);

    await expect(handler([{ data: { nope: 1 } }])).rejects.toThrow(/invalid job data/);
  });
});

describe("trackingImpossible", () => {
  it("true for a shop that blocks or refuses robots without an import, false when imported or revisitable", async () => {
    const blocked = await shopRow();
    await failedCapture(blocked.id, "blocked", hoursAgo(1));
    const robots = await shopRow();
    await failedCapture(robots.id, "robots_disallowed", hoursAgo(1));
    const manualMajor = await shopRow({ isMajorBrand: true, captureMode: "manual" });
    const importedBlocked = await shopRow({ platform: "shopify", importEnabled: true });
    await failedCapture(importedBlocked.id, "blocked", hoursAgo(1));
    const fine = await shopRow();

    expect(await trackingImpossible(handle.db, await tracked(blocked.id))).toBe(true);
    expect(await trackingImpossible(handle.db, await tracked(robots.id))).toBe(true);
    expect(await trackingImpossible(handle.db, await tracked(manualMajor.id))).toBe(true);
    expect(await trackingImpossible(handle.db, await tracked(importedBlocked.id))).toBe(false);
    expect(await trackingImpossible(handle.db, await tracked(fine.id))).toBe(false);
    // Unknown product: nothing to say.
    expect(await trackingImpossible(handle.db, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});
