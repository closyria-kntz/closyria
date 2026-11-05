import { eq, schema } from "@closyria/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";
import { ensureDefaultProfile } from "../../wardrobe/profiles";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let counter = 0;
const UNKNOWN_ID = "7b1f6a52-3a0b-4a4c-9f0e-5b1c2d3e4f50";

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await t?.stop();
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown) {
  return t.app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

type ProfileJson = {
  id: string;
  name: string;
  audience: string;
  childDetail: string | null;
  color: string;
  position: number;
  itemCount?: number;
};

async function newProduct() {
  const n = ++counter;
  const [shop] = await t.db
    .insert(schema.shops)
    .values({ name: `Boutique P${n}`, slug: `me-prof-shop-${n}` })
    .returning();
  if (!shop) throw new Error("no shop");
  const [product] = await t.db
    .insert(schema.products)
    .values({ shopId: shop.id, canonicalUrl: `https://me-prof-${n}.test/p`, name: `Robe ${n}` })
    .returning();
  if (!product) throw new Error("no product");
  return product;
}

describe("GET /api/me/profiles", () => {
  it("answers 401 without a session", async () => {
    expect((await call("GET", "/api/me/profiles", undefined)).status).toBe(401);
  });

  it("creates « Moi » on the first call, once", async () => {
    const { cookie } = await t.signIn();
    const res = await call("GET", "/api/me/profiles", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: ProfileJson[] };
    expect(body.profiles).toEqual([
      {
        id: expect.any(String),
        name: "Moi",
        audience: "women",
        childDetail: null,
        color: "plum",
        position: 0,
        itemCount: 0,
      },
    ]);
    const again = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] };
    expect(again.profiles.map((p) => p.id)).toEqual(body.profiles.map((p) => p.id));
  });

  it("creates a single « Moi » under concurrent first calls", async () => {
    const { userId } = await t.signIn();
    const results = await Promise.all(Array.from({ length: 8 }, () => ensureDefaultProfile(t.db, userId)));
    expect(new Set(results.map((p) => p.id)).size).toBe(1);
    const rows = await t.db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    expect(rows).toHaveLength(1);
  });
});

describe("POST /api/me/profiles", () => {
  it("creates a profile after the existing ones", async () => {
    const { cookie } = await t.signIn();
    const res = await call("POST", "/api/me/profiles", cookie, {
      name: "Léa",
      audience: "child",
      childDetail: "girl",
      color: "sage",
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as ProfileJson;
    expect(created).toMatchObject({ name: "Léa", audience: "child", childDetail: "girl", color: "sage", position: 1 });
    const list = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] };
    expect(list.profiles.map((p) => p.name)).toEqual(["Moi", "Léa"]);
  });

  it("refuses an invalid body and a child detail without the child audience", async () => {
    const { cookie } = await t.signIn();
    const empty = await call("POST", "/api/me/profiles", cookie, { name: "", audience: "women", color: "plum" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid_request" });
    const tooLong = await call("POST", "/api/me/profiles", cookie, {
      name: "x".repeat(41),
      audience: "women",
      color: "plum",
    });
    expect(tooLong.status).toBe(400);
    const mismatch = await call("POST", "/api/me/profiles", cookie, {
      name: "Paul",
      audience: "men",
      childDetail: "boy",
      color: "sky",
    });
    expect(mismatch.status).toBe(400);
  });
});

describe("PATCH, DELETE and order", () => {
  it("renames a profile and clears the child detail when the audience is no longer child", async () => {
    const { cookie } = await t.signIn();
    const created = (await (
      await call("POST", "/api/me/profiles", cookie, {
        name: "Léa",
        audience: "child",
        childDetail: "baby",
        color: "rose",
      })
    ).json()) as ProfileJson;
    const res = await call("PATCH", `/api/me/profiles/${created.id}`, cookie, { name: "Léa B.", audience: "women" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, name: "Léa B.", audience: "women", childDetail: null });
  });

  it("deletes an empty profile and refuses one that holds items", async () => {
    const { cookie } = await t.signIn();
    const lea = (await (
      await call("POST", "/api/me/profiles", cookie, { name: "Léa", audience: "women", color: "rose" })
    ).json()) as ProfileJson;
    const product = await newProduct();
    const kept = await call("POST", "/api/me/items", cookie, {
      productId: product.id,
      profileId: lea.id,
      action: "favorite",
    });
    expect(kept.status).toBe(201);
    const refused = await call("DELETE", `/api/me/profiles/${lea.id}`, cookie);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "profile_not_empty" });

    const empty = (await (
      await call("POST", "/api/me/profiles", cookie, { name: "Vide", audience: "mixed", color: "sand" })
    ).json()) as ProfileJson;
    expect((await call("DELETE", `/api/me/profiles/${empty.id}`, cookie)).status).toBe(204);
    const list = (await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] };
    expect(list.profiles.map((p) => [p.name, p.itemCount])).toEqual([
      ["Moi", 0],
      ["Léa", 1],
    ]);
  });

  it("reorders the profiles", async () => {
    const { cookie } = await t.signIn();
    const moi = ((await (await call("GET", "/api/me/profiles", cookie)).json()) as { profiles: ProfileJson[] })
      .profiles[0] as ProfileJson;
    const lea = (await (
      await call("POST", "/api/me/profiles", cookie, { name: "Léa", audience: "women", color: "rose" })
    ).json()) as ProfileJson;
    const res = await call("POST", "/api/me/profiles/order", cookie, { ids: [lea.id, moi.id] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: ProfileJson[] };
    expect(body.profiles.map((p) => [p.name, p.position])).toEqual([
      ["Léa", 0],
      ["Moi", 1],
    ]);
    // Not the full set of her profiles.
    expect((await call("POST", "/api/me/profiles/order", cookie, { ids: [lea.id] })).status).toBe(400);
  });
});

describe("isolation", () => {
  it("answers 404 on every profile route for another user's profile", async () => {
    const owner = await t.signIn();
    const other = await t.signIn();
    const lea = (await (
      await call("POST", "/api/me/profiles", owner.cookie, { name: "Léa", audience: "women", color: "rose" })
    ).json()) as ProfileJson;
    const patch = await call("PATCH", `/api/me/profiles/${lea.id}`, other.cookie, { name: "Volé" });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: "not_found" });
    expect((await call("DELETE", `/api/me/profiles/${lea.id}`, other.cookie)).status).toBe(404);
    const ownList = (await (await call("GET", "/api/me/profiles", other.cookie)).json()) as {
      profiles: ProfileJson[];
    };
    const ownIds = ownList.profiles.map((p) => p.id);
    expect(ownIds).not.toContain(lea.id);
    expect((await call("POST", "/api/me/profiles/order", other.cookie, { ids: [...ownIds, lea.id] })).status).toBe(404);
    expect((await call("PATCH", `/api/me/profiles/${UNKNOWN_ID}`, other.cookie, { name: "X" })).status).toBe(404);
    const [row] = await t.db.select().from(schema.profiles).where(eq(schema.profiles.id, lea.id));
    expect(row?.name).toBe("Léa");
  });
});

describe("GET /api/me/summary", () => {
  it("tells whether the session is anonymous, the active item count and the profiles", async () => {
    const { cookie } = await t.signIn();
    const product = await newProduct();
    await call("POST", "/api/me/items", cookie, { productId: product.id, action: "favorite" });
    const res = await call("GET", "/api/me/summary", cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isAnonymous: true,
      itemCount: 1,
      profiles: [expect.objectContaining({ name: "Moi", itemCount: 1 })],
    });
  });
});
