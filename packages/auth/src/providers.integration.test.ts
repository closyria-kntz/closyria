import { createDb } from "@closyria/db";
import { migrateTestDatabase, startTestDatabase, type TestDatabase } from "@closyria/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type AuthDeps, authOptions, createAuth, memoryMailer } from "./index";
import { softAuthenticator } from "./testing/soft-authenticator";

const BASE_URL = "http://localhost:3001";
const SECRET = "test-secret-that-is-long-enough-0123456789";
const GOOGLE = { clientId: "google-client-id", clientSecret: "google-client-secret" };
const APPLE = { clientId: "com.closyria.web", clientSecret: "apple-client-secret-jwt" };

let database: TestDatabase;
let handle: ReturnType<typeof createDb>;
let mailer: ReturnType<typeof memoryMailer>;
let ipCounter = 0;

const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const deps = (extra: Partial<AuthDeps> = {}): AuthDeps => ({
  db: handle.db,
  mailer,
  baseUrl: BASE_URL,
  secret: SECRET,
  ...extra,
});

type Auth = ReturnType<typeof createAuth>;
type CallOptions = { body?: unknown; cookie?: string; method?: "GET" | "POST"; origin?: string };

async function call(auth: Auth, path: string, { body, cookie, method = "POST", origin = BASE_URL }: CallOptions = {}) {
  const headers = new Headers({ origin, "x-forwarded-for": nextIp(), "user-agent": "closyria-tests" });
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

/** Merges the cookies a response sets into an existing Cookie header. */
function withCookies(res: Response, cookie = ""): string {
  const jar = new Map(
    cookie
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf("=")), pair] as const),
  );
  for (const set of res.headers.getSetCookie()) {
    const pair = set.split(";")[0] ?? "";
    jar.set(pair.slice(0, pair.indexOf("=")), pair);
  }
  return [...jar.values()].join("; ");
}

type SessionBody = {
  user: { id: string; email: string; role: string; isAnonymous: boolean | null };
  session: { authMethod: string };
} | null;

async function getSession(auth: Auth, cookie: string): Promise<SessionBody> {
  const res = await call(auth, "/get-session", { cookie, method: "GET" });
  return (await res.json()) as SessionBody;
}

function lastCode(): string {
  const match = (mailer.messages.at(-1)?.text ?? "").match(/(?<!\d)\d{6}(?!\d)/);
  if (!match) throw new Error("no code in the last message");
  return match[0];
}

async function signInWithEmail(
  auth: Auth,
  email: string,
  { cookie, extra = {} } = {} as {
    cookie?: string;
    extra?: Record<string, unknown>;
  },
) {
  const sent = await call(auth, "/email-otp/send-verification-otp", { body: { email, type: "sign-in" } });
  expect(sent.status).toBe(200);
  const res = await call(auth, "/sign-in/email-otp", {
    body: { email, otp: lastCode(), ...extra },
    ...(cookie ? { cookie } : {}),
  });
  expect(res.status).toBe(200);
  return withCookies(res, cookie);
}

async function signInAnonymously(auth: Auth) {
  const res = await call(auth, "/sign-in/anonymous");
  expect(res.status).toBe(200);
  return withCookies(res);
}

/** Registers a passkey for the signed-in user behind `cookie`, as the browser would. */
async function registerPasskey(auth: Auth, cookie: string, authenticator = softAuthenticator(BASE_URL)) {
  const optionsRes = await call(auth, "/passkey/generate-register-options", { cookie, method: "GET" });
  expect(optionsRes.status).toBe(200);
  const options = (await optionsRes.json()) as { challenge: string; rp: { id: string } };
  const res = await call(auth, "/passkey/verify-registration", {
    cookie: withCookies(optionsRes, cookie),
    body: { response: authenticator.register(options) },
  });
  return { res, authenticator };
}

/** Signs in with a passkey from a browser without any session. */
async function signInWithPasskey(auth: Auth, authenticator: ReturnType<typeof softAuthenticator>, tamper = false) {
  const optionsRes = await call(auth, "/passkey/generate-authenticate-options", { method: "GET" });
  expect(optionsRes.status).toBe(200);
  const options = (await optionsRes.json()) as { challenge: string; rpId: string };
  const res = await call(auth, "/passkey/verify-authentication", {
    cookie: withCookies(optionsRes),
    body: { response: authenticator.authenticate(options, { tamper }) },
  });
  return { res, cookie: withCookies(res) };
}

beforeAll(async () => {
  database = await startTestDatabase();
  await migrateTestDatabase(database.url);
  handle = createDb(database.url, { max: 5 });
  vi.spyOn(console, "log").mockImplementation(() => {}); // memoryMailer's log line
  mailer = memoryMailer();
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await handle?.pool.end();
  await database?.stop();
});

describe("Google and Apple", () => {
  it("refuses social sign-in with a clear 4xx when the provider is not configured", async () => {
    const auth = createAuth(deps());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {}); // "Provider not found"
    for (const provider of ["google", "apple"]) {
      const res = await call(auth, "/sign-in/social", { body: { provider, callbackURL: "/" } });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect(logged).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("redirects to Google and Apple when they are configured", async () => {
    const auth = createAuth(deps({ social: { google: GOOGLE, apple: APPLE } }));
    const google = await call(auth, "/sign-in/social", { body: { provider: "google", callbackURL: "/" } });
    expect(google.status).toBe(200);
    expect(((await google.json()) as { url: string }).url).toMatch(/^https:\/\/accounts\.google\.com\//);
    const apple = await call(auth, "/sign-in/social", { body: { provider: "apple", callbackURL: "/" } });
    expect(apple.status).toBe(200);
    expect(((await apple.json()) as { url: string }).url).toMatch(/^https:\/\/appleid\.apple\.com\//);
  });

  it("enables only the configured provider", async () => {
    const auth = createAuth(deps({ social: { google: GOOGLE } }));
    expect((await call(auth, "/sign-in/social", { body: { provider: "google", callbackURL: "/" } })).status).toBe(200);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {}); // "Provider not found"
    const apple = await call(auth, "/sign-in/social", { body: { provider: "apple", callbackURL: "/" } });
    logged.mockRestore();
    expect(apple.status).toBeGreaterThanOrEqual(400);
    expect(apple.status).toBeLessThan(500);
  });

  it("trusts Apple's origin (form_post callback) only when Apple is enabled", () => {
    expect(authOptions(deps()).trustedOrigins).not.toContain("https://appleid.apple.com");
    expect(authOptions(deps({ social: { google: GOOGLE } })).trustedOrigins).not.toContain("https://appleid.apple.com");
    expect(authOptions(deps({ social: { apple: APPLE } })).trustedOrigins).toContain("https://appleid.apple.com");
  });
});

describe("admin role", () => {
  it("is user by default and admin once promoted with the documented SQL", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "fondatrice@example.com");
    expect((await getSession(auth, cookie))?.user.role).toBe("user");

    await handle.db.execute(sql`UPDATE "user" SET role = 'admin' WHERE email = 'fondatrice@example.com'`);

    expect((await getSession(auth, cookie))?.user.role).toBe("admin");
    expect((await auth.getSession(new Headers({ cookie })))?.user.role).toBe("admin");
  });

  it("ignores a role sent at sign-up", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "intrus@example.com", { extra: { role: "admin", name: "x" } });
    expect((await getSession(auth, cookie))?.user.role).toBe("user");
  });

  it("refuses a role sent through the profile update", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "intruse@example.com");
    const res = await call(auth, "/update-user", { cookie, body: { role: "admin" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await getSession(auth, cookie))?.user.role).toBe("user");
  });

  it("only accepts user or admin in the database", async () => {
    const auth = createAuth(deps());
    await signInWithEmail(auth, "role-check@example.com");
    await expect(
      handle.db.execute(sql`UPDATE "user" SET role = 'superadmin' WHERE email = 'role-check@example.com'`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("session authMethod", () => {
  it("records anonymous, then email-otp when the anonymous user signs in", async () => {
    const auth = createAuth(deps());
    const anonymous = await signInAnonymously(auth);
    expect((await getSession(auth, anonymous))?.session.authMethod).toBe("anonymous");

    const linked = await signInWithEmail(auth, "liee@example.com", { cookie: anonymous });
    const session = await getSession(auth, linked);
    expect(session?.user.isAnonymous).toBeFalsy();
    expect(session?.session.authMethod).toBe("email-otp");
  });

  it("only accepts the known methods in the database", async () => {
    await expect(
      handle.db.execute(sql`UPDATE "session" SET auth_method = 'password' WHERE true`),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("passkeys", () => {
  it("opens a session marked passkey with a registered authenticator", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "passkey@example.com");
    const { res, authenticator } = await registerPasskey(auth, cookie);
    expect(res.status).toBe(200);
    const owner = await getSession(auth, cookie);

    const signIn = await signInWithPasskey(auth, authenticator);
    expect(signIn.res.status).toBe(200);
    const session = await getSession(auth, signIn.cookie);
    expect(session?.user.id).toBe(owner?.user.id);
    expect(session?.session.authMethod).toBe("passkey");

    // The admin check of a later task: role admin AND a passkey session.
    await handle.db.execute(sql`UPDATE "user" SET role = 'admin' WHERE email = 'passkey@example.com'`);
    const admin = await auth.getSession(new Headers({ cookie: signIn.cookie }));
    expect(admin?.user.role).toBe("admin");
    expect(admin?.session.authMethod).toBe("passkey");
    expect((await auth.getSession(new Headers({ cookie })))?.session.authMethod).toBe("email-otp");
  });

  it("refuses an assertion whose signature does not verify", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "passkey-tamper@example.com");
    const { authenticator } = await registerPasskey(auth, cookie);
    const signIn = await signInWithPasskey(auth, authenticator, true);
    expect(signIn.res.status).toBeGreaterThanOrEqual(400);
    expect(signIn.res.status).toBeLessThan(500);
    expect(await getSession(auth, signIn.cookie)).toBeNull();
  });

  it("refuses an unknown authenticator", async () => {
    const auth = createAuth(deps());
    const signIn = await signInWithPasskey(auth, softAuthenticator(BASE_URL));
    expect(signIn.res.status).toBe(401);
  });

  it("refuses a registration signed for another origin", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "passkey-origin@example.com");
    // Better Auth logs the failed verification (origins only) and answers 500 for it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res } = await registerPasskey(auth, cookie, softAuthenticator("https://evil.example"));
    expect(res.status).not.toBe(200);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    const rows = await handle.db.execute<{ n: number }>(
      sql`select count(*)::int as n from passkey p join "user" u on u.id = p.user_id
          where u.email = 'passkey-origin@example.com'`,
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("does not let passkey registration open a session", async () => {
    const auth = createAuth(deps());
    const cookie = await signInWithEmail(auth, "passkey-register@example.com");
    const optionsRes = await call(auth, "/passkey/generate-register-options", { cookie, method: "GET" });
    const options = (await optionsRes.json()) as { challenge: string; rp: { id: string } };
    const res = await call(auth, "/passkey/verify-registration", {
      cookie: withCookies(optionsRes, cookie),
      body: { response: softAuthenticator(BASE_URL).register(options), createSession: true },
    });
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.includes("session_token="))).toBe(false);
  });

  it("refuses passkey registration to anonymous users", async () => {
    const auth = createAuth(deps());
    const cookie = await signInAnonymously(auth);
    const res = await call(auth, "/passkey/generate-register-options", { cookie, method: "GET" });
    expect(res.status).toBe(403);
  });
});
