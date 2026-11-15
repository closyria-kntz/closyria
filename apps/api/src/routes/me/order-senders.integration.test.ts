import type { Mailer } from "@closyria/auth";
import { and, eq, schema } from "@closyria/db";
import type { SenderAddressList, SenderAddressView } from "@closyria/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../../catalog/test-app";

/**
 * « Mes adresses d'envoi » (spec §11): add an address, its 6-digit code by e-mail, verify, resend, remove. The codes
 * are read from the harness's memory mailer, as the browser tests read theirs.
 */

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
const NOW = new Date("2026-11-15T10:00:00Z");
const clock = { now: NOW };
const later = (ms: number) => {
  clock.now = new Date(clock.now.getTime() + ms);
};
const MINUTE = 60_000;
const mailControl = { fail: false };

let t: Harness;
let off: Harness;
let counter = 0;
const logged: string[] = [];

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  const inbound = {
    secret: "0123456789abcdef".repeat(4),
    domain: "commandes.dev.closyria.com",
    checkSender: async () => ({ kind: "ignored", fromAddress: "x@y.example" }) as const,
    queue: { parse: async () => {} },
  };
  // The app sends through a mailer that can fail; what leaves lands in the harness's memory mailer (`t.mail`).
  const mailer: Mailer = {
    async send(msg) {
      if (mailControl.fail) throw new Error("Brevo refused the e-mail (HTTP 500)");
      await t.mail.send(msg);
    },
  };
  [t, off] = await Promise.all([
    createCatalogHarness({ now: () => clock.now }, { inbound, mailer }),
    createCatalogHarness(),
  ]);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all([t?.stop(), off?.stop()]);
});

beforeEach(() => {
  clock.now = NOW;
  mailControl.fail = false;
});

function call(method: string, path: string, cookie: string | undefined, body?: unknown, h: Harness = t) {
  return h.app.request(path, {
    method,
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function account(h: Harness = t) {
  const session = await h.signIn();
  const email = `compte${++counter}@gmail.example`;
  await h.db
    .update(schema.user)
    .set({ isAnonymous: false, name: "Marie Test", email, emailVerified: true })
    .where(eq(schema.user.id, session.userId));
  return { ...session, email };
}

const other = () => `autre${++counter}@hotmail.example`;

/** The code of the last e-mail sent to `to`. */
function codeSentTo(to: string): string {
  const message = t.mail.messages.filter((m) => m.to === to).at(-1);
  const code = message?.subject.match(/(\d{6})$/)?.[1];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}
const sentTo = (to: string) => t.mail.messages.filter((m) => m.to === to).length;

async function add(cookie: string, email: string) {
  const res = await call("POST", "/api/me/order-inbox/senders", cookie, { email });
  return { status: res.status, body: (await res.json()) as SenderAddressView & { error?: string } };
}

const verify = (cookie: string, id: string, code: string) =>
  call("POST", `/api/me/order-inbox/senders/${id}/verify`, cookie, { code });
const resend = (cookie: string, id: string) => call("POST", `/api/me/order-inbox/senders/${id}/resend`, cookie);

describe("who may use « Mes adresses d'envoi »", () => {
  it("a guest creates her account first (403)", async () => {
    const { cookie } = await t.signIn();
    expect((await call("GET", "/api/me/order-inbox/senders", cookie)).status).toBe(403);
    const res = await call("POST", "/api/me/order-inbox/senders", cookie, { email: "a@b.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "account_required" });
  });

  it("nothing while e-mails are not received here (409 inbound_off), nothing sent", async () => {
    const { cookie } = await account(off);
    const before = off.mail.messages.length;
    for (const [method, path] of [
      ["GET", "/api/me/order-inbox/senders"],
      ["POST", "/api/me/order-inbox/senders"],
    ] as const) {
      const res = await call(method, path, cookie, method === "POST" ? { email: "a@b.example" } : undefined, off);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "inbound_off" });
    }
    expect(off.mail.messages.length).toBe(before);
  });

  it("an account whose own e-mail is not verified sends no code (403 email_unverified)", async () => {
    const { cookie, userId } = await account();
    await t.db.update(schema.user).set({ emailVerified: false }).where(eq(schema.user.id, userId));
    const before = t.mail.messages.length;
    for (const res of [
      await call("GET", "/api/me/order-inbox/senders", cookie),
      await call("POST", "/api/me/order-inbox/senders", cookie, { email: other() }),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "email_unverified" });
    }
    expect(t.mail.messages.length).toBe(before);
  });

  it("needs a session (401)", async () => {
    expect((await call("GET", "/api/me/order-inbox/senders", undefined)).status).toBe(401);
  });
});

describe("adding and verifying an address", () => {
  it("lists the account address apart, sends a 6-digit code to the added one, verifies it", async () => {
    const { cookie, email, userId } = await account();
    const empty = (await (await call("GET", "/api/me/order-inbox/senders", cookie)).json()) as SenderAddressList;
    expect(empty).toEqual({ accountEmail: email, max: 10, addresses: [] });

    const address = other();
    const added = await add(cookie, `  ${address.toUpperCase()} `);
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ email: address, verified: false });
    const code = codeSentTo(address);
    expect(code).toMatch(/^\d{6}$/);
    const mail = t.mail.messages.at(-1);
    expect(mail?.subject).toBe(`Ton code Closyria : ${code}`);
    expect(JSON.stringify(added.body)).not.toContain(code);

    // Stored hashed, under a salt of its own; never in a log line.
    const [row] = await t.db
      .select()
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.userId, userId));
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toContain(code);
    expect(row?.codeSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.codeExpiresAt?.getTime()).toBe(NOW.getTime() + 15 * MINUTE);
    expect(logged.join("\n")).not.toContain(code);

    const list = (await (await call("GET", "/api/me/order-inbox/senders", cookie)).json()) as SenderAddressList;
    expect(list.addresses).toEqual([added.body]);

    const res = await verify(cookie, added.body.id, code);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: added.body.id, email: address, verified: true });
    const [done] = await t.db
      .select()
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.id, added.body.id));
    expect(done).toMatchObject({ codeHash: null, codeSalt: null, codeExpiresAt: null, attempts: 0 });
    expect(done?.verifiedAt?.getTime()).toBe(NOW.getTime());
    expect((await verify(cookie, added.body.id, code)).status).toBe(409);
    expect(await (await resend(cookie, added.body.id)).json()).toEqual({ error: "sender_verified" });
  });

  it("refuses an invalid address, the account address and one already added", async () => {
    const { cookie, email } = await account();
    for (const bad of ["pas-une-adresse", "marié@hotmail.example", ""]) {
      expect((await add(cookie, bad)).status, bad).toBe(400);
    }
    expect(await add(cookie, email.toUpperCase())).toEqual({ status: 409, body: { error: "sender_exists" } });
    const address = other();
    expect((await add(cookie, address)).status).toBe(201);
    expect(await add(cookie, address)).toEqual({ status: 409, body: { error: "sender_exists" } });
  });

  it("10 addresses at most, the account's included", async () => {
    const { cookie, userId } = await account();
    await t.db
      .insert(schema.orderSenderAddresses)
      .values(
        Array.from({ length: 8 }, (_, i) => ({ userId, email: `deja${i}-${counter}@x.example`, verifiedAt: NOW })),
      );
    expect((await add(cookie, other())).status).toBe(201);
    const before = t.mail.messages.length;
    expect(await add(cookie, other())).toEqual({ status: 409, body: { error: "sender_limit" } });
    expect(t.mail.messages.length).toBe(before);
  });

  it("a wrong code counts a try; 15 minutes later the code has expired", async () => {
    const { cookie } = await account();
    const address = other();
    const { body } = await add(cookie, address);
    const code = codeSentTo(address);
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await verify(cookie, body.id, wrong);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "code_wrong" });
    const [row] = await t.db
      .select({ attempts: schema.orderSenderAddresses.attempts })
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.id, body.id));
    expect(row?.attempts).toBe(1);
    expect((await verify(cookie, body.id, "12")).status).toBe(400);
    later(15 * MINUTE);
    expect(await (await verify(cookie, body.id, code)).json()).toEqual({ error: "code_expired" });
  });

  it("5 tries per code: then even the right one is refused until « Renvoyer le code »", async () => {
    const { cookie } = await account();
    const address = other();
    const { body } = await add(cookie, address);
    const code = codeSentTo(address);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++)
      expect(await (await verify(cookie, body.id, wrong)).json()).toEqual({ error: "code_wrong" });
    expect(await (await verify(cookie, body.id, wrong)).json()).toEqual({ error: "code_locked" });
    expect(await (await verify(cookie, body.id, code)).json()).toEqual({ error: "code_locked" });
    later(MINUTE);
    const again = await resend(cookie, body.id);
    expect(again.status).toBe(200);
    const fresh = codeSentTo(address);
    expect((await verify(cookie, body.id, fresh)).status).toBe(200);
  });

  it("« Renvoyer le code »: once a minute per address, the wait said, the former code stops", async () => {
    const { cookie } = await account();
    const first = other();
    const { body } = await add(cookie, first);
    const old = codeSentTo(first);
    expect(await (await resend(cookie, body.id)).json()).toEqual({ error: "rate_limited", retryAfterSeconds: 60 });
    later(20_000);
    expect(await (await resend(cookie, body.id)).json()).toEqual({ error: "rate_limited", retryAfterSeconds: 40 });
    later(40_000);
    expect((await resend(cookie, body.id)).status).toBe(200);
    expect(sentTo(first)).toBe(2);
    const fresh = codeSentTo(first);
    if (fresh !== old) expect(await (await verify(cookie, body.id, old)).json()).toEqual({ error: "code_wrong" });
  });

  it("5 codes an hour per account (adding counts); a refused request counts nothing", async () => {
    const { cookie, userId } = await account();
    const [a, b, c] = [await add(cookie, other()), await add(cookie, other()), await add(cookie, other())];
    later(MINUTE);
    expect((await resend(cookie, a.body.id)).status).toBe(200); // 4
    expect((await resend(cookie, b.body.id)).status).toBe(200); // 5
    // The hour began at the first code, a minute ago: 59 minutes to wait.
    expect(await (await resend(cookie, c.body.id)).json()).toEqual({
      error: "rate_limited",
      retryAfterSeconds: 59 * 60,
    });
    const fourth = other();
    expect(await add(cookie, fourth)).toEqual({
      status: 429,
      body: { error: "rate_limited", retryAfterSeconds: 59 * 60 },
    });
    const [none] = await t.db
      .select()
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.email, fourth));
    expect(none).toBeUndefined();
    const [count] = await t.db
      .select({ sends: schema.orderSenderSends.sends })
      .from(schema.orderSenderSends)
      .where(eq(schema.orderSenderSends.userId, userId));
    expect(count?.sends).toBe(5);
    later(59 * MINUTE);
    expect((await resend(cookie, c.body.id)).status).toBe(200);
  });

  it("3 codes a day to one same address, whatever the account; refused for a 4th, the wait said", async () => {
    const target = other();
    const sessions = [await account(), await account(), await account(), await account()];
    for (const who of sessions.slice(0, 3)) expect((await add(who.cookie, target)).status).toBe(201);
    later(MINUTE);
    const fourth = sessions[3] as (typeof sessions)[number];
    expect(await add(fourth.cookie, target)).toEqual({
      status: 429,
      body: { error: "rate_limited", retryAfterSeconds: 24 * 60 * 60 - 60 },
    });
    // Resending counts too, and the refusal changed nothing on her hour.
    const [first] = sessions;
    const [row] = await t.db
      .select({ id: schema.orderSenderAddresses.id })
      .from(schema.orderSenderAddresses)
      .where(
        and(eq(schema.orderSenderAddresses.userId, first?.userId ?? ""), eq(schema.orderSenderAddresses.email, target)),
      );
    expect((await resend(first?.cookie ?? "", row?.id ?? "")).status).toBe(429);
    const [sends] = await t.db
      .select({ sends: schema.orderSenderSends.sends })
      .from(schema.orderSenderSends)
      .where(eq(schema.orderSenderSends.userId, fourth.userId));
    expect(sends).toBeUndefined();
    // Another address still works for her, and the address itself is never kept in the counts.
    expect((await add(fourth.cookie, other())).status).toBe(201);
    const keys = await t.db.select({ key: schema.orderSenderCodeTargets.key }).from(schema.orderSenderCodeTargets);
    expect(keys.every((k) => /^[0-9a-f]{64}$/.test(k.key))).toBe(true);
    later(24 * 60 * MINUTE);
    expect((await add(fourth.cookie, target)).status).toBe(201);
  });

  it("an e-mail that does not leave: 502 mail_failed, nothing added, nothing counted, the former code kept", async () => {
    const { cookie, userId } = await account();
    const address = other();
    mailControl.fail = true;
    for (let i = 0; i < 6; i++)
      expect(await add(cookie, address)).toEqual({ status: 502, body: { error: "mail_failed" } });
    expect(
      await t.db.select().from(schema.orderSenderAddresses).where(eq(schema.orderSenderAddresses.userId, userId)),
    ).toEqual([]);
    expect(await t.db.select().from(schema.orderSenderSends).where(eq(schema.orderSenderSends.userId, userId))).toEqual(
      [],
    );
    mailControl.fail = false;
    const { body } = await add(cookie, address);
    const code = codeSentTo(address);
    const [before] = await t.db
      .select()
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.id, body.id));
    later(MINUTE);
    mailControl.fail = true;
    expect(await (await resend(cookie, body.id)).json()).toEqual({ error: "mail_failed" });
    mailControl.fail = false;
    const [after] = await t.db
      .select()
      .from(schema.orderSenderAddresses)
      .where(eq(schema.orderSenderAddresses.id, body.id));
    expect(after).toEqual(before);
    // `last_sent_at` was not moved: « Renvoyer le code » works at once.
    expect((await resend(cookie, body.id)).status).toBe(200);
    const [sends] = await t.db
      .select({ sends: schema.orderSenderSends.sends })
      .from(schema.orderSenderSends)
      .where(eq(schema.orderSenderSends.userId, userId));
    expect(sends?.sends).toBe(2);
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe("removing, and another account's addresses", () => {
  it("« Retirer » removes it; another account's address is unknown (404)", async () => {
    const me = await account();
    const sophie = await account();
    const address = other();
    const { body } = await add(sophie.cookie, address);
    const code = codeSentTo(address);
    for (const res of [
      await verify(me.cookie, body.id, code),
      await resend(me.cookie, body.id),
      await call("DELETE", `/api/me/order-inbox/senders/${body.id}`, me.cookie),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
    expect((await call("DELETE", "/api/me/order-inbox/senders/not-a-uuid", me.cookie)).status).toBe(400);
    const removed = await call("DELETE", `/api/me/order-inbox/senders/${body.id}`, sophie.cookie);
    expect(removed.status).toBe(204);
    const list = (await (await call("GET", "/api/me/order-inbox/senders", sophie.cookie)).json()) as SenderAddressList;
    expect(list.addresses).toEqual([]);
    expect((await call("DELETE", `/api/me/order-inbox/senders/${body.id}`, sophie.cookie)).status).toBe(404);
  });
});
