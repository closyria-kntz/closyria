import { and, eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const NOW = new Date("2026-11-05T12:00:00Z");

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => NOW });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

type Accepted = { productId: string; captureId: string; status: string };

function post(url: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return t.app.request("/api/captures", {
    method: "POST",
    body: JSON.stringify({ url }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...headers, ...(cookie ? { cookie } : {}) },
  });
}

async function newShop(domain: string, overrides: Partial<typeof schema.shops.$inferInsert> = {}) {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Shop ${n}`, slug: `test-shop-${n}`, ...overrides })
    .returning();
  if (!shop) throw new Error("no shop");
  await t.db.insert(schema.shopDomains).values({ domain, shopId: shop.id });
  return shop;
}

const host = () => `shop-${++counter}.test`;

describe("POST /api/captures", () => {
  it("answers 401 without a session", async () => {
    expect((await post("https://a.test/p/1")).status).toBe(401);
  });

  it("answers 400 invalid_url for an address that is not http(s)", async () => {
    const { cookie } = await t.signIn();
    for (const url of ["javascript:alert(1)", "not a url", "https://user:pw@a.test/p"]) {
      const res = await post(url, cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_url" });
    }
  });

  it("answers 400 invalid_request for a body without an address", async () => {
    const { cookie } = await t.signIn();
    const res = await post(undefined, cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("queues a capture for a link of an auto shop and enqueues one job", async () => {
    const { cookie, userId } = await t.signIn();
    const domain = host();
    const shop = await newShop(domain);
    const before = t.calls.length;
    const res = await post(`https://${domain}/products/robe`, cookie);
    expect(res.status).toBe(202);
    const body = (await res.json()) as Accepted;
    expect(body.status).toBe("queued");
    expect(t.calls.slice(before)).toEqual([{ queue: "capture-user", captureId: body.captureId }]);

    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, body.captureId));
    expect(capture).toMatchObject({
      productId: body.productId,
      shopId: shop.id,
      url: `https://${domain}/products/robe`,
      trigger: "user",
      requestedBy: userId,
      status: "queued",
      dataReady: false,
    });
    const [product] = await t.db.select().from(schema.products).where(eq(schema.products.id, body.productId));
    expect(product).toMatchObject({ shopId: shop.id, name: null, priceCents: null, captureStatus: "pending" });
  });

  it("gives the same product for the same link with tracking parameters, and returns the active capture", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    await newShop(domain);
    const first = (await (await post(`https://${domain}/p/1`, cookie)).json()) as Accepted;
    const before = t.calls.length;
    const res = await post(`https://${domain}/p/1?utm_source=x#top`, cookie);
    expect(res.status).toBe(202);
    const second = (await res.json()) as Accepted;
    expect(second.productId).toBe(first.productId);
    expect(second.captureId).toBe(first.captureId);
    expect(t.calls.length).toBe(before);
  });

  it("keeps ?variant= as a distinct product", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    await newShop(domain);
    const a = (await (await post(`https://${domain}/p/1?variant=1`, cookie)).json()) as Accepted;
    const b = (await (await post(`https://${domain}/p/1?variant=2`, cookie)).json()) as Accepted;
    expect(a.productId).not.toBe(b.productId);
  });

  it("recognises shop.mango.com when mango.com is registered, without creating a shop", async () => {
    const { cookie } = await t.signIn();
    const domain = `${++counter}mango.test`;
    const shop = await newShop(domain);
    const shopsBefore = await t.db.$count(schema.shops);
    const res = await post(`https://shop.${domain}/fr/p/1`, cookie);
    expect(res.status).toBe(202);
    const body = (await res.json()) as Accepted;
    const [product] = await t.db.select().from(schema.products).where(eq(schema.products.id, body.productId));
    expect(product?.shopId).toBe(shop.id);
    expect(await t.db.$count(schema.shops)).toBe(shopsBefore);
  });

  it("follows merged_into_id to the surviving shop", async () => {
    const { cookie } = await t.signIn();
    const survivor = await newShop(host());
    const oldDomain = host();
    await newShop(oldDomain, { mergedIntoId: survivor.id });
    const body = (await (await post(`https://www.${oldDomain}/p/9`, cookie)).json()) as Accepted;
    const [product] = await t.db.select().from(schema.products).where(eq(schema.products.id, body.productId));
    expect(product?.shopId).toBe(survivor.id);
  });

  it("creates a pending shop for an unknown domain", async () => {
    const { cookie } = await t.signIn();
    const domain = `new-${++counter}.example.test`;
    const res = await post(`https://www.${domain}/p/1`, cookie);
    expect(res.status).toBe(202);
    const [row] = await t.db.select().from(schema.shopDomains).where(eq(schema.shopDomains.domain, domain));
    expect(row).toBeDefined();
    const [shop] = await t.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, row?.shopId ?? ""));
    expect(shop).toMatchObject({
      name: domain,
      slug: domain.replaceAll(".", "-"),
      status: "pending",
      platform: "unknown",
      captureMode: "auto",
    });
  });

  it("suffixes the slug when it collides with another shop", async () => {
    const { cookie } = await t.signIn();
    const domain = `clash-${++counter}.test`;
    await t.db.insert(schema.shops).values({ name: "Other", slug: domain.replaceAll(".", "-") });
    expect((await post(`https://${domain}/p/1`, cookie)).status).toBe(202);
    const [row] = await t.db.select().from(schema.shopDomains).where(eq(schema.shopDomains.domain, domain));
    const [shop] = await t.db
      .select()
      .from(schema.shops)
      .where(eq(schema.shops.id, row?.shopId ?? ""));
    expect(shop?.slug).toBe(`${domain.replaceAll(".", "-")}-2`);
  });

  it("skips a manual shop: skipped_manual, no job, product in manual", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    await newShop(domain, { captureMode: "manual" });
    const before = t.calls.length;
    const res = await post(`https://${domain}/p/1`, cookie);
    expect(res.status).toBe(202);
    const body = (await res.json()) as Accepted;
    expect(body.status).toBe("skipped_manual");
    expect(t.calls.length).toBe(before);
    const [product] = await t.db.select().from(schema.products).where(eq(schema.products.id, body.productId));
    expect(product?.captureStatus).toBe("manual");
  });

  it("answers succeeded at once, without a job, for a product captured 2 hours ago", async () => {
    const { cookie, userId } = await t.signIn();
    const domain = host();
    const shop = await newShop(domain);
    const [product] = await t.db
      .insert(schema.products)
      .values({
        shopId: shop.id,
        canonicalUrl: `https://${domain}/p/fresh`,
        name: "Robe",
        currency: "EUR",
        priceCents: 2999,
        captureStatus: "ok",
        lastCapturedAt: new Date(NOW.getTime() - 2 * 3600_000),
      })
      .returning();
    const before = t.calls.length;
    const res = await post(`https://${domain}/p/fresh`, cookie);
    expect(res.status).toBe(202);
    const body = (await res.json()) as Accepted;
    expect(body).toMatchObject({ productId: product?.id, status: "succeeded" });
    expect(t.calls.length).toBe(before);
    const [capture] = await t.db.select().from(schema.captures).where(eq(schema.captures.id, body.captureId));
    expect(capture).toMatchObject({ status: "succeeded", dataReady: true, trigger: "user", requestedBy: userId });
  });

  it("queues again for a product captured 30 hours ago", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    const shop = await newShop(domain);
    await t.db.insert(schema.products).values({
      shopId: shop.id,
      canonicalUrl: `https://${domain}/p/old`,
      name: "Robe",
      currency: "EUR",
      priceCents: 2999,
      captureStatus: "ok",
      lastCapturedAt: new Date(NOW.getTime() - 30 * 3600_000),
    });
    const body = (await (await post(`https://${domain}/p/old`, cookie)).json()) as Accepted;
    expect(body.status).toBe("queued");
  });

  it("creates one product and no 500 for two simultaneous posts of a new link", async () => {
    const { cookie } = await t.signIn();
    const other = await t.signIn();
    const domain = `race-${++counter}.test`;
    const url = `https://${domain}/p/1`;
    const responses = await Promise.all([post(url, cookie), post(url, other.cookie), post(url, cookie)]);
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Accepted[];
    expect(new Set(bodies.map((b) => b.productId)).size).toBe(1);
    expect(await t.db.$count(schema.products, eq(schema.products.canonicalUrl, url))).toBe(1);
    expect(await t.db.$count(schema.shopDomains, eq(schema.shopDomains.domain, domain))).toBe(1);
    expect(await t.db.$count(schema.shops, eq(schema.shops.slug, domain.replaceAll(".", "-")))).toBe(1);
    const active = await t.db
      .select()
      .from(schema.captures)
      .where(and(eq(schema.captures.productId, bodies[0]?.productId ?? ""), eq(schema.captures.status, "queued")));
    expect(active).toHaveLength(1);
  });

  it("keeps the capture as failed/queue_unavailable and answers 500 when the queue is down", async () => {
    const down = await createCatalogHarness({
      queue: {
        enqueue: async () => {
          throw new Error("queue down");
        },
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { cookie } = await down.signIn();
      const url = "https://queue-down.test/p/1";
      const res = await down.app.request("/api/captures", {
        method: "POST",
        body: JSON.stringify({ url }),
        headers: { origin: BASE_URL, "content-type": "application/json", cookie },
      });
      expect(res.status).toBe(500);
      const rows = await down.db.select().from(down.schema.captures);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "failed", errorCode: "queue_unavailable" });
      expect(rows[0]?.finishedAt).not.toBeNull();
      const view = await down.app.request(`/api/captures/${rows[0]?.id}`, { headers: { cookie } });
      expect(view.status).toBe(200);
      expect(await view.json()).toMatchObject({ status: "failed", errorCode: "queue_unavailable" });
    } finally {
      await down.stop();
    }
  }, 60_000);

  it("answers 400 for a data: URL and for an address of 2049 characters", async () => {
    const { cookie } = await t.signIn();
    for (const url of ["data:text/html,<p>x</p>", `https://a.test/${"a".repeat(2049 - "https://a.test/".length)}`]) {
      const res = await post(url, cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_url" });
    }
  });

  it("creates one shop for two simultaneous new links on the same domain", async () => {
    const { cookie } = await t.signIn();
    const domain = `twin-${++counter}.test`;
    const responses = await Promise.all([1, 2, 3, 4].map((i) => post(`https://${domain}/p/${i}`, cookie)));
    expect(responses.map((r) => r.status)).toEqual([202, 202, 202, 202]);
    expect(await t.db.$count(schema.shopDomains, eq(schema.shopDomains.domain, domain))).toBe(1);
    expect(await t.db.$count(schema.shops, eq(schema.shops.name, domain))).toBe(1);
  });

  it("limits per address with the injected limit, whatever the session", async () => {
    const small = await createCatalogHarness({ limits: { perAddress: { max: 2, windowMs: 60_000 } } });
    try {
      const a = await small.signIn();
      const b = await small.signIn();
      const send = (cookie: string, i: number) =>
        small.app.request("/api/captures", {
          method: "POST",
          body: JSON.stringify({ url: `https://addr.test/p/${i}` }),
          headers: { origin: BASE_URL, "content-type": "application/json", cookie, "x-forwarded-for": "203.0.113.7" },
        });
      expect((await send(a.cookie, 1)).status).toBe(202);
      expect((await send(b.cookie, 2)).status).toBe(202);
      expect((await send(a.cookie, 3)).status).toBe(429);
      const other = await small.app.request("/api/captures", {
        method: "POST",
        body: JSON.stringify({ url: "https://addr.test/p/4" }),
        headers: {
          origin: BASE_URL,
          "content-type": "application/json",
          cookie: a.cookie,
          "x-forwarded-for": "203.0.113.8",
        },
      });
      expect(other.status).toBe(202);
    } finally {
      await small.stop();
    }
  }, 60_000);

  it("uses the account limit (not the anonymous one) for a non-anonymous user", async () => {
    const acct = await createCatalogHarness({
      limits: { perAnonymousUser: { max: 1, windowMs: 60_000 }, perUser: { max: 3, windowMs: 60_000 } },
    });
    try {
      const anon = await acct.signIn();
      const member = await acct.signIn();
      await acct.db.update(schema.user).set({ isAnonymous: false }).where(eq(schema.user.id, member.userId));
      const send = (cookie: string, i: number) =>
        acct.app.request("/api/captures", {
          method: "POST",
          body: JSON.stringify({ url: `https://acct.test/p/${i}` }),
          headers: { origin: BASE_URL, "content-type": "application/json", cookie },
        });
      expect((await send(anon.cookie, 1)).status).toBe(202);
      expect((await send(anon.cookie, 2)).status).toBe(429);
      for (let i = 1; i <= 3; i++) expect((await send(member.cookie, i)).status).toBe(202);
      expect((await send(member.cookie, 4)).status).toBe(429);
    } finally {
      await acct.stop();
    }
  }, 60_000);

  it("answers 429 on the 31st capture of an anonymous session within the hour", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    await newShop(domain);
    for (let i = 1; i <= 30; i++) {
      expect((await post(`https://${domain}/p/${i}`, cookie)).status).toBe(202);
    }
    const res = await post(`https://${domain}/p/31`, cookie);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/captures/:id", () => {
  it("answers 401 without a session, 400 for a malformed id, 404 for an unknown one", async () => {
    const { cookie } = await t.signIn();
    const id = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";
    expect((await t.app.request(`/api/captures/${id}`)).status).toBe(401);
    expect((await t.app.request("/api/captures/nope", { headers: { cookie } })).status).toBe(400);
    const res = await t.app.request(`/api/captures/${id}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns the status and the product view, photos ordered with /api/catalog-images URLs", async () => {
    const { cookie } = await t.signIn();
    const domain = host();
    await newShop(domain);
    const accepted = (await (await post(`https://${domain}/p/view`, cookie)).json()) as Accepted;
    await t.db
      .update(schema.products)
      .set({ name: "Robe rose", currency: "EUR", priceCents: 1999 })
      .where(eq(schema.products.id, accepted.productId));
    const [second, first] = await t.db
      .insert(schema.productImages)
      .values([
        { productId: accepted.productId, position: 1, key: "k/2.webp", width: 10, height: 20, sourceHash: "b" },
        { productId: accepted.productId, position: 0, key: "k/1.webp", width: 30, height: 40, sourceHash: "a" },
      ])
      .returning();
    await t.db.insert(schema.productSizes).values([
      { productId: accepted.productId, label: "M", position: 1, available: false },
      { productId: accepted.productId, label: "S", position: 0, available: true, priceCents: 1799 },
    ]);
    const res = await t.app.request(`/api/captures/${accepted.captureId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      id: string;
      status: string;
      dataReady: boolean;
      errorCode: string | null;
      product: { name: string; images: { id: string; url: string }[]; sizes: { label: string }[]; shop: object };
    };
    expect(view).toMatchObject({ id: accepted.captureId, status: "queued", dataReady: false, errorCode: null });
    expect(view.product.name).toBe("Robe rose");
    expect(view.product.images.map((i) => i.url)).toEqual([
      `/api/catalog-images/${first?.id}`,
      `/api/catalog-images/${second?.id}`,
    ]);
    expect(view.product.sizes.map((s) => s.label)).toEqual(["S", "M"]);
    expect(view.product.shop).toEqual({ name: expect.any(String), slug: expect.any(String) });
  });
});
