import { eq, schema } from "@closyria/db";
import { salePeriodListSchema, salePeriodSchema } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

// Chantier 4 « Alertes », task 7 (spec §6): the admin enters the sales periods (name, first and last day).

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
let t: Harness;
let adminCookie: string;
let userCookie: string;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  t = await createCatalogHarness({ now: () => new Date("2026-11-14T12:00:00Z") });
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

beforeEach(async () => {
  await t.db.delete(schema.salePeriods);
  await t.db.delete(schema.adminAuditLog);
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

const winter = { name: "Soldes d’hiver", startsOn: "2027-01-06", endsOn: "2027-02-02" };
const summer = { name: "Soldes d’été", startsOn: "2027-06-23", endsOn: "2027-07-20" };

const list = async () => salePeriodListSchema.parse(await (await call("GET", "/sale-periods")).json()).periods;

describe("admin sale periods", () => {
  it("creates periods and lists them, the latest start first", async () => {
    const created = await call("POST", "/sale-periods", winter);
    expect(created.status).toBe(201);
    const period = salePeriodSchema.parse(await created.json());
    expect(period).toMatchObject(winter);
    expect((await call("POST", "/sale-periods", summer)).status).toBe(201);
    expect((await list()).map((p) => p.name)).toEqual([summer.name, winter.name]);
  });

  it("accepts a one-day period and trims the name", async () => {
    const res = await call("POST", "/sale-periods", {
      name: "  Vente flash  ",
      startsOn: "2027-03-01",
      endsOn: "2027-03-01",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ name: "Vente flash", startsOn: "2027-03-01", endsOn: "2027-03-01" });
  });

  it("refuses an end before the start, an empty name and a bad date", async () => {
    const bad = [
      { ...winter, endsOn: "2027-01-05" },
      { ...winter, name: "   " },
      { ...winter, name: "x".repeat(81) },
      { ...winter, startsOn: "2027-02-30" },
      { name: winter.name, startsOn: winter.startsOn },
    ];
    for (const body of bad) {
      const res = await call("POST", "/sale-periods", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
    }
    expect(await list()).toEqual([]);
  });

  it("edits a period, with the same end rule, and answers 404 for an unknown one", async () => {
    const period = salePeriodSchema.parse(await (await call("POST", "/sale-periods", winter)).json());
    const patched = await call("PATCH", `/sale-periods/${period.id}`, { ...winter, endsOn: "2027-02-09" });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ ...winter, id: period.id, endsOn: "2027-02-09" });
    expect((await call("PATCH", `/sale-periods/${period.id}`, { ...winter, endsOn: "2027-01-01" })).status).toBe(400);
    expect((await list())[0]?.endsOn).toBe("2027-02-09");
    expect((await call("PATCH", `/sale-periods/${crypto.randomUUID()}`, winter)).status).toBe(404);
  });

  it("deletes a period: 204, then gone and 404", async () => {
    const period = salePeriodSchema.parse(await (await call("POST", "/sale-periods", winter)).json());
    expect((await call("DELETE", `/sale-periods/${period.id}`)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await call("DELETE", `/sale-periods/${period.id}`)).status).toBe(404);
  });

  it("journals every change with the period it touched", async () => {
    const period = salePeriodSchema.parse(await (await call("POST", "/sale-periods", winter)).json());
    await call("PATCH", `/sale-periods/${period.id}`, summer);
    await call("DELETE", `/sale-periods/${period.id}`);
    const rows = await t.db.select().from(schema.adminAuditLog);
    expect(rows.map((r) => r.action).sort()).toEqual([
      "sale_period.create",
      "sale_period.delete",
      "sale_period.update",
    ]);
    expect(rows.every((r) => r.target === `sale_period:${period.id}`)).toBe(true);
    const create = rows.find((r) => r.action === "sale_period.create");
    expect(create?.details).toMatchObject({ name: winter.name, startsOn: winter.startsOn, endsOn: winter.endsOn });
    // Reads are not journalled.
    await call("GET", "/sale-periods");
    expect(await t.db.select().from(schema.adminAuditLog)).toHaveLength(3);
  });

  it("is closed to non-admins and anonymous callers", async () => {
    const id = crypto.randomUUID();
    const routes: [string, string, unknown?][] = [
      ["GET", "/sale-periods"],
      ["POST", "/sale-periods", winter],
      ["PATCH", `/sale-periods/${id}`, winter],
      ["DELETE", `/sale-periods/${id}`],
    ];
    for (const [method, path, payload] of routes) {
      expect((await call(method, path, payload, userCookie)).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, payload, "")).status, `${method} ${path}`).toBe(401);
    }
    expect(await t.db.select().from(schema.salePeriods)).toEqual([]);
  });
});
