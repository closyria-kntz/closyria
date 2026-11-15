import { readFileSync } from "node:fs";
import { and, createDb, eq, findOrCreateShop, schema } from "@closyria/db";
import { INBOUND_EMAIL_RETENTION_DAYS, nextSendAt, type ParsedOrder, rawEmailKey } from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { createTestDatabase } from "@closyria/testing/vitest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { orderEmailParseHandler, type ParseDeps, parseInboundEmail } from "./parse";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let handle: ReturnType<typeof createDb>;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
  handle = createDb(database.url, { max: 8 });
}, 60_000);

afterAll(async () => {
  await handle?.pool.end();
  await database?.stop();
});

// Winter, 11:00 in Paris: an alert may go out at once.
const now = new Date("2026-11-14T10:00:00Z");
const HOUR = 3_600_000;
/** The e-mails of packages/extract's tests: invented, in the shapes shops send. */
const fixture = (name: string) =>
  readFileSync(new URL(`../../../../packages/extract/src/order-email/fixtures/${name}.eml`, import.meta.url));

async function person() {
  const { db } = handle;
  const n = ++counter;
  const userId = `parse-user-${n}`;
  const address = `camille.martin+${n}@exemple.test`;
  await db.insert(schema.user).values({ id: userId, name: "Camille", email: address, emailVerified: true });
  const [second] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Léo", audience: "men", color: "plum", position: 1 })
    .returning();
  const [profile] = await db
    .insert(schema.profiles)
    .values({ userId, name: "Moi", audience: "women", color: "plum", position: 0 })
    .returning();
  const [inbox] = await db
    .insert(schema.orderInboxes)
    .values({ userId, localPart: `camille-p${n}` })
    .returning();
  return {
    userId,
    address,
    profileId: profile?.id as string,
    otherProfileId: second?.id as string,
    inboxId: inbox?.id as string,
  };
}
type Person = Awaited<ReturnType<typeof person>>;

/** An accepted e-mail as the reception leaves it: `queued`, its raw message stored. */
async function received(store: ObjectStore, who: Person, raw: Buffer | string) {
  const { db } = handle;
  const [row] = await db
    .insert(schema.inboundEmails)
    .values({
      inboxId: who.inboxId,
      userId: who.userId,
      queueId: `Q${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
      fromAddress: who.address,
      authOk: true,
      status: "queued",
      purgeAfter: new Date(now.getTime() + INBOUND_EMAIL_RETENTION_DAYS * 24 * HOUR),
    })
    .returning();
  const id = row?.id as string;
  const key = rawEmailKey(who.userId, id);
  await store.put(key, Buffer.from(raw), "message/rfc822");
  await db.update(schema.inboundEmails).set({ rawObjectKey: key }).where(eq(schema.inboundEmails.id, id));
  return id;
}

const ordersOf = (userId: string) =>
  handle.db.select().from(schema.orders).where(eq(schema.orders.userId, userId)).orderBy(schema.orders.createdAt);
const linesOf = (orderId: string) =>
  handle.db
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, orderId))
    .orderBy(schema.orderLines.position);
const parcelsOf = (orderId: string) =>
  handle.db.select().from(schema.parcels).where(eq(schema.parcels.orderId, orderId));
const statusOf = async (id: string) =>
  (await handle.db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, id)))[0]?.status;
const alertsOf = (userId: string) =>
  handle.db.select().from(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));

const deps = (store: ObjectStore, ai: ParseDeps["ai"] = null): ParseDeps => ({ db: handle.db, store, ai });

describe("parseInboundEmail", () => {
  it("makes a draft order of a Shopify confirmation, in her first profile, and tells her", async () => {
    const store = memoryStore();
    const who = await person();
    const id = await received(store, who, fixture("shopify-fr-confirmation"));

    expect(await parseInboundEmail(deps(store), id, now)).toBe("parsed");

    const [order, ...others] = await ordersOf(who.userId);
    expect(others).toHaveLength(0);
    expect(order).toMatchObject({
      profileId: who.profileId,
      externalRef: "1042",
      status: "draft",
      source: "email",
      parseMethod: "known",
      inboundEmailId: id,
      orderedAt: new Date("2026-11-09T13:32:00Z"),
    });
    const [shop] = await handle.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, order?.shopId as string));
    expect(shop?.name).toBe("maison-lune.example");
    expect(
      (await linesOf(order?.id as string)).map((l) => [l.name, l.sizeLabel, l.color, l.quantity, l.priceCents]),
    ).toEqual([
      ["Robe Lina", "M", "Écru", 1, 8900],
      ["Pull Côme", "S", null, 2, 6000],
    ]);
    expect(await parcelsOf(order?.id as string)).toHaveLength(0);
    expect(await statusOf(id)).toBe("parsed");
    expect(await alertsOf(who.userId)).toMatchObject([
      {
        kind: "order_received",
        orderId: order?.id,
        shopId: order?.shopId,
        status: "pending",
        sendAfter: nextSendAt(now),
      },
    ]);
  });

  it("completes the order with the shipping e-mail: one order, one parcel, one notification (RF 2)", async () => {
    const store = memoryStore();
    const who = await person();
    const first = await received(store, who, fixture("shopify-fr-confirmation"));
    const second = await received(store, who, fixture("shopify-fr-shipping"));
    await parseInboundEmail(deps(store), first, now);
    expect(await parseInboundEmail(deps(store), second, now)).toBe("parsed");

    const orders = await ordersOf(who.userId);
    expect(orders).toHaveLength(1);
    const orderId = orders[0]?.id as string;
    expect(await linesOf(orderId)).toHaveLength(2);
    expect(await parcelsOf(orderId)).toMatchObject([
      {
        trackingNumber: "6A12345678901",
        carrier: "colissimo",
        status: "pending",
        // A new number is asked at the next sweep (2026-11-15).
        nextCheckAt: now,
        checkUntil: new Date(now.getTime() + 30 * 24 * HOUR),
      },
    ]);
    expect(await alertsOf(who.userId)).toHaveLength(1);
    expect(await statusOf(second)).toBe("parsed");
    // The same shipping e-mail forwarded again: still one order and one parcel.
    const again = await received(store, who, fixture("shopify-fr-shipping"));
    expect(await parseInboundEmail(deps(store), again, now)).toBe("parsed");
    expect(await ordersOf(who.userId)).toHaveLength(1);
    expect(await parcelsOf(orderId)).toHaveLength(1);
  });

  it("fills the prices and the date when the confirmation comes after the shipping e-mail", async () => {
    const store = memoryStore();
    const who = await person();
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-shipping")), now);
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-confirmation")), now);
    const [order, ...others] = await ordersOf(who.userId);
    expect(others).toHaveLength(0);
    expect(order?.orderedAt).toEqual(new Date("2026-11-09T13:32:00Z"));
    expect((await linesOf(order?.id as string)).map((l) => [l.name, l.priceCents, l.currency])).toEqual([
      ["Robe Lina", 8900, "EUR"],
      ["Pull Côme", 6000, "EUR"],
    ]);
    expect(await parcelsOf(order?.id as string)).toHaveLength(1);
  });

  it("reads two e-mails of one order at the same moment into one order", async () => {
    const store = memoryStore();
    const who = await person();
    const ids = [
      await received(store, who, fixture("shopify-en-confirmation")),
      await received(store, who, fixture("shopify-en-shipping")),
      await received(store, who, fixture("shopify-en-shipping")),
    ];
    await Promise.all(ids.map((id) => parseInboundEmail(deps(store), id, now)));
    const orders = await ordersOf(who.userId);
    expect(orders).toHaveLength(1);
    expect(await parcelsOf(orders[0]?.id as string)).toMatchObject([
      { trackingNumber: "1Z999AA10123456784", carrier: "ups" },
    ]);
    expect(await linesOf(orders[0]?.id as string)).toHaveLength(2);
  });

  it("adds a parcel to a confirmed order without touching its articles", async () => {
    const store = memoryStore();
    const who = await person();
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-en-confirmation")), now);
    const [order] = await ordersOf(who.userId);
    await handle.db
      .update(schema.orders)
      .set({ status: "confirmed" })
      .where(eq(schema.orders.id, order?.id as string));
    await handle.db.delete(schema.orderLines).where(eq(schema.orderLines.name, "Canvas Tote"));
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-en-shipping")), now);
    expect(await ordersOf(who.userId)).toHaveLength(1);
    expect(await linesOf(order?.id as string)).toHaveLength(1);
    expect(await parcelsOf(order?.id as string)).toHaveLength(1);
  });

  it("waits for a « C'est bon » under way, then adds no article to the order it validated", async () => {
    const store = memoryStore();
    const who = await person();
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-confirmation")), now);
    const [order] = await ordersOf(who.userId);
    const orderId = order?.id as string;
    const shipping = await received(store, who, fixture("shopify-fr-shipping"));
    // She removed every article while correcting it, then Task 4's confirm runs in its own transaction: it locks the
    // order and validates it. The shipping e-mail read meanwhile must not put the articles back.
    await handle.db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, orderId));
    const client = await handle.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from orders where id = $1 for update", [orderId]);
      await client.query("update orders set status = 'confirmed' where id = $1", [orderId]);
      let done = false;
      const reading = parseInboundEmail(deps(store), shipping, now).then((r) => {
        done = true;
        return r;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(done).toBe(false);
      await client.query("commit");
      expect(await reading).toBe("parsed");
    } finally {
      client.release();
    }
    expect(await linesOf(orderId)).toHaveLength(0);
    expect(await parcelsOf(orderId)).toHaveLength(1);
  });

  it("never completes a dismissed order, nor another person's", async () => {
    const store = memoryStore();
    const who = await person();
    const other = await person();
    await parseInboundEmail(deps(store), await received(store, other, fixture("shopify-fr-confirmation")), now);
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-confirmation")), now);
    const [dismissed] = await ordersOf(who.userId);
    await handle.db
      .update(schema.orders)
      .set({ status: "dismissed" })
      .where(eq(schema.orders.id, dismissed?.id as string));
    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-shipping")), now);
    expect((await ordersOf(who.userId)).map((o) => o.status)).toEqual(["dismissed", "draft"]);
    expect(await ordersOf(other.userId)).toHaveLength(1);
    // Both orders point to the shop the first e-mail created.
    expect((await ordersOf(other.userId))[0]?.shopId).toBe((await ordersOf(who.userId))[1]?.shopId);
  });

  it("reuses the shop that owns the e-mail's domain", async () => {
    const store = memoryStore();
    const who = await person();
    const [shop] = await handle.db
      .insert(schema.shops)
      .values({ name: "Atelier Pivoine", slug: `atelier-pivoine-${counter}` })
      .returning();
    await handle.db
      .insert(schema.shopDomains)
      .values({ domain: "atelier-pivoine.example", shopId: shop?.id as string });
    await parseInboundEmail(deps(store), await received(store, who, fixture("structured-order-parcel")), now);
    const [order] = await ordersOf(who.userId);
    expect(order).toMatchObject({
      shopId: shop?.id,
      externalRef: "AP-558812",
      orderedAt: new Date("2026-11-08T20:47:00Z"),
    });
    expect(await parcelsOf(order?.id as string)).toMatchObject([
      { trackingNumber: "EE123456785FR", carrier: "chronopost" },
    ]);
  });

  it("ties a line to the product its link names, among that shop's products only, never creating one", async () => {
    const store = memoryStore();
    const who = await person();
    const shop = await findOrCreateShop(handle.db, "https://maison-lune.example/");
    const [other] = await handle.db
      .insert(schema.shops)
      .values({ name: "Ailleurs", slug: `ailleurs-${counter}` })
      .returning();
    const [robe] = await handle.db
      .insert(schema.products)
      .values({ shopId: shop.id, canonicalUrl: "https://maison-lune.example/products/robe-lina?variant=4471" })
      .returning();
    // Same address but filed under another shop: not this order's.
    await handle.db.insert(schema.products).values({
      shopId: other?.id as string,
      canonicalUrl: "https://maison-lune.example/collections/ete/products/pull-come",
    });
    const before = (await handle.db.select({ id: schema.products.id }).from(schema.products)).length;

    await parseInboundEmail(deps(store), await received(store, who, fixture("shopify-fr-confirmation-liens")), now);

    const [order] = await ordersOf(who.userId);
    expect((await linesOf(order?.id as string)).map((l) => [l.name, l.productId])).toEqual([
      ["Robe Lina", robe?.id],
      ["Pull Côme", null],
    ]);
    expect((await handle.db.select({ id: schema.products.id }).from(schema.products)).length).toBe(before);
  });

  it("does nothing twice when the job runs again", async () => {
    const store = memoryStore();
    const who = await person();
    const id = await received(store, who, fixture("shopify-fr-confirmation"));
    expect(await parseInboundEmail(deps(store), id, now)).toBe("parsed");
    expect(await parseInboundEmail(deps(store), id, now)).toBe("none");
    expect(await ordersOf(who.userId)).toHaveLength(1);
    expect(await parseInboundEmail(deps(store), crypto.randomUUID(), now)).toBe("none");
  });
});

describe("parseInboundEmail — the AI's turn", () => {
  const aiOrder: ParsedOrder = {
    shopName: "Les Petites Mailles",
    shopHost: null,
    externalRef: null,
    orderedAt: null,
    lines: [
      {
        name: "Gilet Margaux",
        sizeLabel: "Taille unique",
        color: "miel",
        quantity: 1,
        priceCents: 6500,
        currency: "EUR",
      },
    ],
    trackings: [],
  };

  it("asks the AI only when no known format reads it, and keeps the shop of the original sender", async () => {
    const store = memoryStore();
    const who = await person();
    const texts: string[] = [];
    const ai = async (text: string) => {
      texts.push(text);
      return aiOrder;
    };
    await parseInboundEmail(deps(store, ai), await received(store, who, fixture("shopify-fr-confirmation")), now);
    expect(texts).toHaveLength(0);
    const id = await received(store, who, fixture("unknown-handmade"));
    expect(await parseInboundEmail(deps(store, ai), id, now)).toBe("parsed");
    expect(texts[0]).toContain("gilet Margaux");
    const order = (await ordersOf(who.userId))[1];
    expect(order).toMatchObject({ parseMethod: "ai", externalRef: null });
    const [shop] = await handle.db
      .select()
      .from(schema.shopDomains)
      .where(eq(schema.shopDomains.shopId, order?.shopId as string));
    expect(shop?.domain).toBe("petites-mailles.example");
  });

  it("sends the subject with the text, and never asks the AI for a person with no profile", async () => {
    const store = memoryStore();
    const texts: string[] = [];
    const ai = async (text: string) => {
      texts.push(text);
      return aiOrder;
    };
    const who = await person();
    await parseInboundEmail(deps(store, ai), await received(store, who, fixture("unknown-handmade")), now);
    expect(texts[0]?.split("\n")[0]).toBe("Objet : TR: Merci Camille !");
    const none = await person();
    await handle.db.delete(schema.profiles).where(eq(schema.profiles.userId, none.userId));
    const id = await received(store, none, fixture("unknown-handmade"));
    expect(await parseInboundEmail(deps(store, ai), id, now)).toBe("failed");
    expect(texts).toHaveLength(1);
  });

  it("keeps the shop's name the AI read on the order, never renaming the catalogue's shop (2026-11-15)", async () => {
    const store = memoryStore();
    const who = await person();
    const ai = async () => ({ ...aiOrder, shopName: "  Les Petites   Mailles  " });
    const id = await received(store, who, fixture("unknown-handmade"));
    expect(await parseInboundEmail(deps(store, ai), id, now)).toBe("parsed");
    const [order] = await ordersOf(who.userId);
    expect(order?.shopName).toBe("Les Petites Mailles");
    const [shop] = await handle.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, order?.shopId as string));
    // The shared catalogue keeps the domain as the pending shop's name.
    expect(shop).toMatchObject({ name: "petites-mailles.example", status: "pending" });
  });

  it("keeps a name too long to 80 characters, and none when the e-mail gives none", async () => {
    const store = memoryStore();
    const who = await person();
    const long = `${"Atelier ".repeat(14)}Fin`;
    await parseInboundEmail(
      deps(store, async () => ({ ...aiOrder, shopName: long })),
      await received(store, who, fixture("unknown-handmade")),
      now,
    );
    expect((await ordersOf(who.userId))[0]?.shopName?.length).toBeLessThanOrEqual(80);
    const other = await person();
    await parseInboundEmail(
      deps(store, async () => ({ ...aiOrder, shopName: null })),
      await received(store, other, fixture("unknown-handmade")),
      now,
    );
    expect((await ordersOf(other.userId))[0]?.shopName).toBeNull();
  });

  it("a later e-mail of the order fills a missing name, never the one she typed (« Corriger »)", async () => {
    const store = memoryStore();
    const tracked = (shopName: string | null) => async () => ({
      ...aiOrder,
      shopName,
      trackings: [{ trackingNumber: "6A18537412398", carrier: "colissimo" as const }],
    });
    // No name in the first e-mail: the second one gives it.
    const who = await person();
    await parseInboundEmail(deps(store, tracked(null)), await received(store, who, fixture("unknown-handmade")), now);
    await parseInboundEmail(
      deps(store, tracked("Les Petites Mailles")),
      await received(store, who, fixture("unknown-handmade")),
      now,
    );
    const [filled, ...more] = await ordersOf(who.userId);
    expect(more).toHaveLength(0);
    expect(filled?.shopName).toBe("Les Petites Mailles");
    // A name she typed, matching no shop: kept.
    const her = await person();
    await parseInboundEmail(deps(store, tracked(null)), await received(store, her, fixture("unknown-handmade")), now);
    const [typed] = await ordersOf(her.userId);
    await handle.db
      .update(schema.orders)
      .set({ shopId: null, shopName: "Mailles de Lou" })
      .where(eq(schema.orders.id, typed?.id as string));
    await parseInboundEmail(
      deps(store, tracked("Les Petites Mailles")),
      await received(store, her, fixture("unknown-handmade")),
      now,
    );
    const [kept, ...again] = await ordersOf(her.userId);
    expect(again).toHaveLength(0);
    expect(kept?.shopName).toBe("Mailles de Lou");
  });

  it("leaves the shop empty rather than guess one", async () => {
    const store = memoryStore();
    const who = await person();
    const ai = async () => aiOrder;
    const raw = [
      "From: Lou <lou.oya@gmail.com>",
      "Subject: Merci !",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<p>Ton gilet part lundi.</p><a href="https://xyz.mjt.lu/lnk/1">a</a><a href="https://xyz.mjt.lu/lnk/2">b</a><a href="https://boutique-oya.example/">c</a>',
    ].join("\n");
    const before = await handle.db.select({ id: schema.shops.id }).from(schema.shops);
    expect(await parseInboundEmail(deps(store, ai), await received(store, who, raw), now)).toBe("parsed");
    expect((await ordersOf(who.userId))[0]?.shopId).toBeNull();
    expect(await handle.db.select({ id: schema.shops.id }).from(schema.shops)).toHaveLength(before.length);
  });

  it("fails it (« On n'a pas su lire cet e-mail ») without AI, past the cap, or for what is no order", async () => {
    const store = memoryStore();
    const who = await person();
    for (const ai of [null, async () => null]) {
      const id = await received(store, who, fixture("unknown-handmade"));
      expect(await parseInboundEmail(deps(store, ai), id, now)).toBe("failed");
      expect(await statusOf(id)).toBe("failed");
    }
    const junk = await received(store, who, "Subject: Coucou\nContent-Type: text/plain\n\nOn se voit samedi ?");
    expect(await parseInboundEmail(deps(store), junk, now)).toBe("failed");
    expect(await ordersOf(who.userId)).toHaveLength(0);
    expect(await alertsOf(who.userId)).toHaveLength(0);
  });

  it("fails an e-mail whose raw message is gone, and one with no profile to put it in", async () => {
    const store = memoryStore();
    const who = await person();
    const id = await received(store, who, fixture("shopify-fr-confirmation"));
    await store.delete(rawEmailKey(who.userId, id));
    expect(await parseInboundEmail(deps(store), id, now)).toBe("failed");

    const none = await person();
    await handle.db.delete(schema.profiles).where(eq(schema.profiles.userId, none.userId));
    const lonely = await received(store, none, fixture("shopify-fr-confirmation"));
    expect(await parseInboundEmail(deps(store), lonely, now)).toBe("failed");
  });
});

describe("orderEmailParseHandler", () => {
  it("fails a job with bad data, retries a passing error, and marks the e-mail failed on the last attempt", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = memoryStore();
    const who = await person();
    const handler = orderEmailParseHandler(
      deps(store, async () => {
        throw new Error("model unavailable");
      }),
      () => now,
    );
    await expect(handler([{ id: "j1", data: { inboundEmailId: "nope" } }])).rejects.toThrow(/invalid job data/);

    const id = await received(store, who, fixture("unknown-handmade"));
    await expect(handler([{ id: "j2", data: { inboundEmailId: id }, retryCount: 0, retryLimit: 3 }])).rejects.toThrow(
      /model unavailable/,
    );
    expect(await statusOf(id)).toBe("queued");
    await handler([{ id: "j3", data: { inboundEmailId: id }, retryCount: 3, retryLimit: 3 }]);
    expect(await statusOf(id)).toBe("failed");

    const ok = await received(store, who, fixture("shopify-fr-confirmation"));
    await handler([{ id: "j4", data: { inboundEmailId: ok } }]);
    expect(await statusOf(ok)).toBe("parsed");
    expect(
      await handle.db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.userId, who.userId), eq(schema.orders.inboundEmailId, ok))),
    ).toHaveLength(1);
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});
