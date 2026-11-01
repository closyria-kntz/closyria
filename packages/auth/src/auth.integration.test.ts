import { createHash, createHmac } from "node:crypto";
import { createDb } from "@closyria/db";
import { loadMessages } from "@closyria/i18n";
import { migrateTestDatabase, startTestDatabase, type TestDatabase } from "@closyria/testing";
import { eq, sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type Auth, createAuth, EMAIL_SEND_MAX, listOwnedColumns, memoryMailer, registerOwnedTable } from "./index";

// Test-only table standing in for the user data future chantiers will register.
const ownedItems = pgTable("test_owned_items", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  label: text("label").notNull(),
});

const BASE_URL = "http://localhost:3001";
const SECRET = "test-secret-that-is-long-enough-0123456789";

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let mailer: ReturnType<typeof memoryMailer>;
let auth: Auth;
let ipCounter = 0;

/** A fresh client IP, so per-IP rate limits only apply where a test wants them. */
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

type CallOptions = { body?: unknown; cookie?: string; ip?: string; method?: "GET" | "POST"; origin?: string };

async function call(
  path: string,
  { body, cookie, ip = nextIp(), method = "POST", origin = BASE_URL }: CallOptions = {},
) {
  const headers = new Headers({ origin, "x-forwarded-for": ip, "user-agent": "closyria-tests" });
  if (cookie) headers.set("cookie", cookie);
  if (body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** The `name=value` pairs a response sets, as a Cookie header. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function signInAnonymously() {
  const res = await call("/sign-in/anonymous");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user: { id: string } };
  return { cookie: cookieFrom(res), userId: body.user.id };
}

function lastCode(): string {
  const text = mailer.messages.at(-1)?.text ?? "";
  const match = text.match(/(?<!\d)\d+(?!\d)/);
  if (!match) throw new Error("no code in the last message");
  return match[0];
}

async function sendCode(email: string, ip?: string) {
  return call("/email-otp/send-verification-otp", { body: { email, type: "sign-in" }, ...(ip ? { ip } : {}) });
}

async function signInWithCode(email: string, otp: string, cookie?: string, ip?: string) {
  return call("/sign-in/email-otp", {
    body: { email, otp },
    ...(cookie ? { cookie } : {}),
    ...(ip ? { ip } : {}),
  });
}

async function sessionUser(cookie: string) {
  const res = await call("/get-session", { cookie, method: "GET" });
  const body = (await res.json()) as { user: { id: string; email: string; isAnonymous: boolean | null } } | null;
  return body?.user ?? null;
}

async function countUsers() {
  const result = await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from "user"`);
  return result.rows[0]?.n ?? 0;
}

const freshAuth = () => createAuth({ db: handle.db, mailer, baseUrl: BASE_URL, secret: SECRET });

beforeAll(async () => {
  database = await startTestDatabase();
  await migrateTestDatabase(database.url);
  handle = createDb(database.url, { max: 5 });
  await handle.db.execute(
    sql`create table test_owned_items (
      id serial primary key,
      user_id text not null references "user"(id) on delete cascade,
      label text not null
    )`,
  );
  registerOwnedTable(ownedItems, ownedItems.userId);
  vi.spyOn(console, "log").mockImplementation(() => {}); // memoryMailer's log line
  mailer = memoryMailer();
  auth = freshAuth();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("anonymous sessions", () => {
  it("creates a session on anonymous sign-in", async () => {
    const { cookie, userId } = await signInAnonymously();
    const user = await sessionUser(cookie);
    expect(user?.id).toBe(userId);
    expect(user?.isAnonymous).toBe(true);
  });

  it("keeps the existing session when two anonymous sign-ins share the same cookie", async () => {
    const { cookie, userId } = await signInAnonymously();
    const before = await countUsers();

    const responses = await Promise.all([
      call("/sign-in/anonymous", { cookie }),
      call("/sign-in/anonymous", { cookie }),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(((await res.json()) as { user: { id: string } }).user.id).toBe(userId);
    }
    expect(await countUsers()).toBe(before);
    expect((await sessionUser(cookie))?.id).toBe(userId);
  });

  it("does not swap a signed-in account for a new anonymous one", async () => {
    const email = "deja-connectee@example.test";
    await sendCode(email);
    const signedIn = await signInWithCode(email, lastCode());
    const cookie = cookieFrom(signedIn);
    const before = await countUsers();

    const res = await call("/sign-in/anonymous", { cookie });

    expect(res.status).toBe(200);
    expect(await countUsers()).toBe(before);
    expect((await sessionUser(cookie))?.email).toBe(email);
  });
});

describe("email one-time codes", () => {
  it("sends a 6-digit code in a French e-mail", async () => {
    const res = await sendCode("six@example.test");
    expect(res.status).toBe(200);

    const message = mailer.messages.at(-1);
    expect(message?.to).toBe("six@example.test");
    expect(message?.subject).toBe(loadMessages("fr").Auth.email.subject);
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(message?.html).toContain(lastCode());
  });

  it("opens a session with the right code", async () => {
    const email = "juste@example.test";
    await sendCode(email);
    const res = await signInWithCode(email, lastCode());

    expect(res.status).toBe(200);
    const user = await sessionUser(cookieFrom(res));
    expect(user?.email).toBe(email);
    expect(user?.isAnonymous).toBeFalsy();
  });

  it("refuses even the right code after 5 wrong attempts", async () => {
    const email = "essais@example.test";
    await sendCode(email);
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    // Each attempt from a different IP: the per-code limit must hold on its own.
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await signInWithCode(email, wrong)).status, `attempt ${attempt}`).toBe(400);
    }
    const sixth = await signInWithCode(email, code);

    expect(sixth.status).toBe(403);
    expect(cookieFrom(sixth)).toBe("");
  });

  it("refuses a code older than 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T10:00:00Z") });
    await sendCode("vieux@example.test");
    const oldCode = lastCode();
    await sendCode("presque@example.test");
    const recentCode = lastCode();

    vi.setSystemTime(new Date("2026-11-01T10:09:59Z"));
    expect((await signInWithCode("presque@example.test", recentCode)).status).toBe(200);

    vi.setSystemTime(new Date("2026-11-01T10:10:01Z"));
    expect((await signInWithCode("vieux@example.test", oldCode)).status).toBe(400);
  });

  it("limits code sending per client, and the limit survives a restart", async () => {
    const ip = nextIp();
    for (let i = 0; i < 3; i++) expect((await sendCode(`limite${i}@example.test`, ip)).status).toBe(200);
    expect((await sendCode("limite3@example.test", ip)).status).toBe(429);

    // The counter lives in the database, so a restarted process (fresh instance) still sees it.
    const stored = await handle.db.execute<{ count: number }>(
      sql`select count from rate_limit where key like ${`%${ip}%`}`,
    );
    expect(stored.rows[0]?.count).toBe(3);
    auth = freshAuth();
    expect((await sendCode("limite4@example.test", ip)).status).toBe(429);
  });
});

describe("per e-mail limit on code sending", () => {
  it("refuses an e-mail after the limit whatever the IP, and leaves other e-mails alone", async () => {
    const email = "Cible@Example.test";
    for (let i = 0; i < EMAIL_SEND_MAX; i++) {
      expect((await sendCode(i % 2 ? email : email.toLowerCase())).status, `send ${i + 1}`).toBe(200);
    }
    const sent = mailer.messages.length;

    expect((await sendCode(email)).status).toBe(429);
    expect((await sendCode(email.toLowerCase())).status).toBe(429);
    expect(mailer.messages.length).toBe(sent);
    expect((await sendCode("autre@example.test")).status).toBe(200);
  });

  it("allows the e-mail again after an hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-02T08:00:00Z") });
    const email = "patiente@example.test";
    for (let i = 0; i < EMAIL_SEND_MAX; i++) await sendCode(email);
    expect((await sendCode(email)).status).toBe(429);

    vi.setSystemTime(new Date("2026-11-02T09:00:01Z"));
    expect((await sendCode(email)).status).toBe(200);
  });

  const keyOf = (email: string) => createHmac("sha256", SECRET).update(`email-otp-send:${email}`).digest("hex");
  const rowsFor = async (email: string) =>
    (await handle.db.execute<{ key: string }>(sql`select key from email_rate_limit where key = ${keyOf(email)}`)).rows
      .length;

  it("stores only a keyed hash (HMAC) of the e-mail", async () => {
    await sendCode("secrete@example.test");
    const plainHash = createHash("sha256").update("email-otp-send:secrete@example.test").digest("hex");
    const all = await handle.db.execute<{ key: string }>(sql`select key from email_rate_limit`);
    expect(all.rows.map((r) => r.key)).not.toContain(plainHash);
    for (const row of all.rows) expect(row.key).not.toContain("@");
    expect(await rowsFor("secrete@example.test")).toBe(1);
  });

  it("purges rows whose window ended more than 24 hours ago", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-05T00:00:00Z") });
    await sendCode("ancienne@example.test");
    vi.setSystemTime(new Date("2026-11-05T02:00:00Z"));
    await sendCode("recente@example.test");

    // 25 h 00 min 01 s after the first window started: it ended 24 h 00 min 01 s ago.
    vi.setSystemTime(new Date("2026-11-06T01:00:01Z"));
    await sendCode("declencheuse@example.test");

    expect(await rowsFor("ancienne@example.test")).toBe(0);
    expect(await rowsFor("recente@example.test")).toBe(1);
  });
});

describe("password and other code paths are closed", () => {
  const registered = "inscrite@example.test";

  beforeAll(async () => {
    await sendCode(registered);
    expect((await signInWithCode(registered, lastCode())).status).toBe(200);
  });

  it.each(["/email-otp/request-password-reset", "/forget-password/email-otp"])("%s is not served", async (path) => {
    const sent = mailer.messages.length;
    const res = await call(path, { body: { email: registered } });
    expect(res.status).toBe(404);
    expect(mailer.messages.length).toBe(sent);
  });

  it.each(["email-verification", "forget-password", "change-email"])(
    "send-verification-otp refuses type %s",
    async (type) => {
      const sent = mailer.messages.length;
      const res = await call("/email-otp/send-verification-otp", { body: { email: registered, type } });
      expect(res.status).toBe(400);
      expect(mailer.messages.length).toBe(sent);
    },
  );
});

describe("anonymous data on sign-in", () => {
  async function insertItem(userId: string, label: string) {
    await handle.db.insert(ownedItems).values({ userId, label });
  }

  async function itemsOf(userId: string) {
    const rows = await handle.db.select().from(ownedItems).where(eq(ownedItems.userId, userId));
    return rows.map((r) => r.label).sort();
  }

  it("moves registered rows from the anonymous user to the new account", async () => {
    const anonymous = await signInAnonymously();
    await insertItem(anonymous.userId, "robe");

    const email = "nouvelle@example.test";
    await sendCode(email);
    const res = await signInWithCode(email, lastCode(), anonymous.cookie);
    expect(res.status).toBe(200);
    const account = await sessionUser(cookieFrom(res));

    expect(account?.id).not.toBe(anonymous.userId);
    expect(await itemsOf(account?.id ?? "")).toEqual(["robe"]);
    expect(await itemsOf(anonymous.userId)).toEqual([]);
  });

  it("moves them to the existing account when the e-mail already has one", async () => {
    const email = "existante@example.test";
    await sendCode(email);
    const first = await signInWithCode(email, lastCode());
    const existing = await sessionUser(cookieFrom(first));
    await insertItem(existing?.id ?? "", "manteau");

    const anonymous = await signInAnonymously();
    await insertItem(anonymous.userId, "jupe");

    await sendCode(email);
    const res = await signInWithCode(email, lastCode(), anonymous.cookie);
    expect(res.status).toBe(200);

    expect((await sessionUser(cookieFrom(res)))?.id).toBe(existing?.id);
    expect(await itemsOf(existing?.id ?? "")).toEqual(["jupe", "manteau"]);
    const [anonymousLeft] = (
      await handle.db.execute<{ n: number }>(sql`select count(*)::int as n from "user" where id = ${anonymous.userId}`)
    ).rows;
    expect(anonymousLeft?.n).toBe(0);
  });
});

describe("owned tables", () => {
  it("only registers user id columns with a cascading foreign key to user(id)", async () => {
    const owned = listOwnedColumns();
    expect(owned.length).toBeGreaterThan(0);
    for (const { table, column } of owned) {
      const result = await handle.db.execute<{ n: number }>(sql`
        select count(*)::int as n
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute r on r.attrelid = c.confrelid and r.attnum = c.confkey[1]
        where c.contype = 'f'
          and c.conrelid = ${table}::regclass
          and c.confrelid = '"user"'::regclass
          and cardinality(c.conkey) = 1
          and a.attname = ${column}
          and r.attname = 'id'
          and c.confdeltype = 'c'`);
      expect(result.rows[0]?.n, `${table}.${column}`).toBe(1);
    }
  });
});

describe("privacy and transport security", () => {
  it("does not store the IP address on sessions", async () => {
    const { userId } = await signInAnonymously();
    const rows = await handle.db.execute<{ ip_address: string | null; user_agent: string | null }>(
      sql`select ip_address, user_agent from session where user_id = ${userId}`,
    );
    expect(rows.rows).toEqual([{ ip_address: null, user_agent: "closyria-tests" }]);
  });

  it("sets a Secure, HttpOnly, SameSite=Lax session cookie over https", async () => {
    const httpsUrl = "https://closyria.test";
    const httpsAuth = createAuth({ db: handle.db, mailer, baseUrl: httpsUrl, secret: SECRET });
    const res = await httpsAuth.handler(
      new Request(`${httpsUrl}/api/auth/sign-in/anonymous`, {
        method: "POST",
        headers: { origin: httpsUrl, "x-forwarded-for": nextIp(), "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    const sessionCookie = res.headers.getSetCookie().find((c) => c.includes("session_token="));
    expect(sessionCookie).toBeDefined();
    const attributes = (sessionCookie ?? "").split(";").map((a) => a.trim().toLowerCase());
    expect(attributes).toContain("secure");
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("samesite=lax");
  });

  it("refuses a state-changing request from a foreign origin", async () => {
    const { cookie, userId } = await signInAnonymously();
    const res = await call("/sign-out", { cookie, body: {}, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect((await sessionUser(cookie))?.id).toBe(userId);
  });
});

describe("getSession", () => {
  it("returns the session for a cookie, null without one", async () => {
    const { cookie, userId } = await signInAnonymously();
    expect((await auth.getSession(new Headers({ cookie })))?.user.id).toBe(userId);
    expect(await auth.getSession(new Headers())).toBeNull();
  });
});
