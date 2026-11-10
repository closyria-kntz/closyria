import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listShippingOptions } from "../../catalog/shipping-options";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => new Date("2026-11-05T12:00:00Z") });
  const admin = await t.signIn();
  await t.db.update(schema.user).set({ role: "admin", isAnonymous: false }).where(eq(schema.user.id, admin.userId));
  await t.db.update(schema.session).set({ authMethod: "passkey" }).where(eq(schema.session.userId, admin.userId));
  adminCookie = admin.cookie;
  userCookie = (await t.signIn()).cookie;
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, body?: unknown, cookie = adminCookie) {
  return t.app.request(`/api/admin${path}`, {
    method,
    headers: {
      origin: BASE_URL,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newShop() {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Ship ${n}`, slug: `ship-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  return shop;
}

// biome-ignore lint/suspicious/noExplicitAny: loose reader of JSON answers in tests
const json = async (res: Response) => (await res.json()) as Record<string, any>;

describe("admin shipping options", () => {
  it("creates two options and lists them in order", async () => {
    const shop = await newShop();
    const first = await call("POST", `/shops/${shop.id}/shipping-options`, {
      label: "Standard",
      shippingCents: 690,
      freeFromCents: 5000,
    });
    expect(first.status).toBe(201);
    const second = await call("POST", `/shops/${shop.id}/shipping-options`, {
      label: "Express",
      shippingCents: 1290,
      freeFromCents: null,
    });
    expect(second.status).toBe(201);
    const list = await json(await call("GET", `/shops/${shop.id}/shipping-options`));
    expect(list.options.map((o: { label: string }) => o.label)).toEqual(["Standard", "Express"]);
    expect(list.options[0]).toMatchObject({ shippingCents: 690, freeFromCents: 5000, position: 0 });
    expect(list.options[1]).toMatchObject({ freeFromCents: null, position: 1 });
    expect((await listShippingOptions(t.db, shop.id)).map((o) => o.label)).toEqual(["Standard", "Express"]);
  });

  it("rejects an empty label and a zero threshold", async () => {
    const shop = await newShop();
    const path = `/shops/${shop.id}/shipping-options`;
    expect((await call("POST", path, { label: "  ", shippingCents: 100, freeFromCents: null })).status).toBe(400);
    expect((await call("POST", path, { label: "A", shippingCents: 100, freeFromCents: 0 })).status).toBe(400);
    expect((await call("POST", path, { label: "A", shippingCents: -1, freeFromCents: null })).status).toBe(400);
    expect((await call("GET", path)).status).toBe(200);
    expect((await json(await call("GET", path))).options).toEqual([]);
  });

  it("updates an option and answers 404 for unknown ones", async () => {
    const shop = await newShop();
    const other = await newShop();
    const created = await json(
      await call("POST", `/shops/${shop.id}/shipping-options`, { label: "A", shippingCents: 100, freeFromCents: null }),
    );
    const patched = await call("PATCH", `/shops/${shop.id}/shipping-options/${created.id}`, {
      label: "B",
      shippingCents: 250,
      freeFromCents: 4000,
    });
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ id: created.id, label: "B", shippingCents: 250, freeFromCents: 4000 });
    // An option is only reachable through its own shop.
    const wrong = await call("PATCH", `/shops/${other.id}/shipping-options/${created.id}`, {
      label: "C",
      shippingCents: 1,
      freeFromCents: null,
    });
    expect(wrong.status).toBe(404);
    expect((await call("DELETE", `/shops/${other.id}/shipping-options/${created.id}`)).status).toBe(404);
    expect((await call("GET", `/shops/${crypto.randomUUID()}/shipping-options`)).status).toBe(404);
  });

  it("deletes an option: 204 then absent", async () => {
    const shop = await newShop();
    const created = await json(
      await call("POST", `/shops/${shop.id}/shipping-options`, { label: "A", shippingCents: 100, freeFromCents: null }),
    );
    expect((await call("DELETE", `/shops/${shop.id}/shipping-options/${created.id}`)).status).toBe(204);
    expect((await json(await call("GET", `/shops/${shop.id}/shipping-options`))).options).toEqual([]);
    expect((await call("DELETE", `/shops/${shop.id}/shipping-options/${created.id}`)).status).toBe(404);
  });

  it("is closed to non-admins and anonymous callers", async () => {
    const shop = await newShop();
    const id = crypto.randomUUID();
    const body = { label: "A", shippingCents: 1, freeFromCents: null };
    const routes: [string, string, unknown?][] = [
      ["GET", `/shops/${shop.id}/shipping-options`],
      ["POST", `/shops/${shop.id}/shipping-options`, body],
      ["PATCH", `/shops/${shop.id}/shipping-options/${id}`, body],
      ["DELETE", `/shops/${shop.id}/shipping-options/${id}`],
    ];
    for (const [method, path, payload] of routes) {
      expect((await call(method, path, payload, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, payload, "")).status, `${method} ${path}`).toBe(401);
    }
  });

  it("journals every write", async () => {
    await t.db.delete(schema.adminAuditLog);
    const shop = await newShop();
    const created = await json(
      await call("POST", `/shops/${shop.id}/shipping-options`, { label: "A", shippingCents: 100, freeFromCents: null }),
    );
    await call("PATCH", `/shops/${shop.id}/shipping-options/${created.id}`, {
      label: "B",
      shippingCents: 100,
      freeFromCents: null,
    });
    await call("DELETE", `/shops/${shop.id}/shipping-options/${created.id}`);
    const rows = await t.db.select().from(schema.adminAuditLog);
    expect(rows.map((r) => r.action).sort()).toEqual(["shipping.create", "shipping.delete", "shipping.update"]);
    expect(rows.every((r) => r.target === `shop:${shop.id}`)).toBe(true);
  });
});
