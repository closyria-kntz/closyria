import { eq, schema } from "@closyria/db";
import {
  INBOUND_EMAIL_MAX_BYTES,
  MAX_IGNORED_INBOUND_EMAILS_PER_DAY,
  MAX_INBOUND_EMAILS_PER_DAY,
  type OrderInboxView,
  rawEmailKey,
} from "@closyria/shared";
import { memoryStore, type ObjectStore } from "@closyria/storage";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BASE_URL, createCatalogHarness } from "../catalog/test-app";
import { gmailForwardingSender, mailauthSenderCheck, type SenderCheck } from "../inbound/sender";
import { type Envelope, signRequest } from "../inbound/signature";
import {
  envelopeFrom,
  FIXTURE_GOOGLE,
  fixtureResolver,
  gmailAutoForward,
  gmailConfirmation,
  gmailForward,
  INBOX_DOMAIN,
  icloudForward,
  outlookForward,
  sealed,
  signed,
  unsigned,
} from "../inbound/test-fixtures";

type Harness = Awaited<ReturnType<typeof createCatalogHarness>>;
const SECRET = "0123456789abcdef".repeat(4);
const NOW = new Date("2026-11-14T10:15:00Z");
/** The clock of the reception, the signature and the inbox route; a test may move it, beforeEach puts it back. */
const clock = { now: NOW };
const nowS = () => Math.floor(clock.now.getTime() / 1000);
const DAY_MS = 86_400_000;

/** The store of the reception route: memory, with a switch to make writes fail or to run code before one lands. */
const objects = memoryStore();
const storeControl: { failPut: boolean; beforePut?: (() => Promise<void>) | undefined } = { failPut: false };
const deleted: string[] = [];
const inboundStore: ObjectStore = {
  async put(key, body, type) {
    await storeControl.beforePut?.();
    if (storeControl.failPut) throw new Error("storage down");
    await objects.put(key, body, type);
  },
  get: (key) => objects.get(key),
  async delete(key) {
    deleted.push(key);
    await objects.delete(key);
  },
};
const parsed: string[] = [];
const queueControl = { fail: false };

/** The sender check: the fixtures' DNS, Gmail's automatic forwarding on or off, the DNS failing or not. */
const senderControl = { autoForward: false, dnsFail: false };
const checks = {
  off: mailauthSenderCheck({ mta: "mx.closyria.com", resolver: fixtureResolver(), google: FIXTURE_GOOGLE }),
  on: mailauthSenderCheck({
    mta: "mx.closyria.com",
    resolver: fixtureResolver(),
    google: FIXTURE_GOOGLE,
    autoForward: true,
  }),
  down: mailauthSenderCheck({
    mta: "mx.closyria.com",
    resolver: fixtureResolver({ fail: true }),
    google: FIXTURE_GOOGLE,
  }),
};
const checkSender: SenderCheck = (input) =>
  (senderControl.dnsFail ? checks.down : senderControl.autoForward ? checks.on : checks.off)(input);

let t: Harness;
let off: Harness;
let counter = 0;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  [t, off] = await Promise.all([
    createCatalogHarness(
      { now: () => clock.now },
      {
        inbound: {
          secret: SECRET,
          domain: INBOX_DOMAIN,
          store: inboundStore,
          checkSender,
          queue: {
            async parse(id) {
              if (queueControl.fail) throw new Error("queue down");
              parsed.push(id);
            },
          },
          now: () => clock.now,
          nowS,
        },
      },
    ),
    createCatalogHarness(),
  ]);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all([t?.stop(), off?.stop()]);
});

beforeEach(() => {
  storeControl.failPut = false;
  storeControl.beforePut = undefined;
  queueControl.fail = false;
  senderControl.autoForward = false;
  senderControl.dnsFail = false;
  clock.now = NOW;
  parsed.length = 0;
  deleted.length = 0;
});

function call(method: string, path: string, cookie: string | undefined, h: Harness = t) {
  return h.app.request(path, {
    method,
    headers: { origin: BASE_URL, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  });
}

/** A signed-in account (address `email`, verified unless told otherwise, first name Marie), with her order address. */
async function account(email: string, options: { verified?: boolean } = {}) {
  const session = await t.signIn();
  await t.db
    .update(schema.user)
    .set({ isAnonymous: false, name: "Marie Test", email, emailVerified: options.verified ?? true })
    .where(eq(schema.user.id, session.userId));
  const res = await call("POST", "/api/me/order-inbox", session.cookie);
  expect(res.status).toBe(200);
  const { address } = (await res.json()) as OrderInboxView;
  if (!address) throw new Error("no address");
  return { ...session, address };
}

function deliver(raw: Buffer, envelope: Envelope, options: { secret?: string; headers?: Record<string, string> } = {}) {
  return t.app.request("/api/inbound-email", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "message/rfc822",
      ...signRequest(options.secret ?? SECRET, envelope, raw, nowS()),
      ...options.headers,
    },
  });
}

async function rowsOf(address: string) {
  const local = address.split("@")[0] as string;
  const [inbox] = await t.db.select().from(schema.orderInboxes).where(eq(schema.orderInboxes.localPart, local));
  if (!inbox) return [];
  return t.db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.inboxId, inbox.id));
}

async function stored(key: string) {
  try {
    return await objects.get(key);
  } catch {
    return null;
  }
}

/** Distinct mailboxes per test: the user table's e-mails are unique. */
const mailbox = (provider: "gmail" | "outlook" | "icloud") => `marie.test${++counter}@${provider}.example`;

describe("POST /api/inbound-email: who may call it", () => {
  it("does not exist without INBOUND_EMAIL_SECRET (reception off)", async () => {
    const raw = unsigned("From: a@b.example\r\n\r\nx\r\n");
    const res = await off.app.request("/api/inbound-email", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "message/rfc822",
        ...signRequest(SECRET, envelopeFrom("gmail", "a@b.example", `x@${INBOX_DOMAIN}`), raw, nowS()),
      },
    });
    expect(res.status).toBe(404);
  });

  it("answers 404 to a request that came through Caddy (X-Forwarded-For), even well signed", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address), {
      headers: { "x-forwarded-for": "198.51.100.17" },
    });
    expect(res.status).toBe(404);
    expect(await rowsOf(address)).toEqual([]);
  });

  it("refuses a wrong signature with 401, nothing stored", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address), { secret: "f".repeat(64) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    const unsignedRes = await t.app.request("/api/inbound-email", {
      method: "POST",
      body: raw,
      headers: { "content-type": "message/rfc822" },
    });
    expect(unsignedRes.status).toBe(401);
    expect(await rowsOf(address)).toEqual([]);
    expect(parsed).toEqual([]);
  });

  it("refuses more than 2 MB with 413, nothing stored", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const big = Buffer.concat([
      await signed(gmailForward(address, `Marie <${her}>`), "gmail"),
      Buffer.alloc(INBOUND_EMAIL_MAX_BYTES, 0x61),
    ]);
    const res = await deliver(big, envelopeFrom("gmail", her, address));
    expect(res.status).toBe(413);
    expect(await rowsOf(address)).toEqual([]);
  });

  it("takes exactly 2 MB", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const head = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const raw = Buffer.concat([head, Buffer.alloc(INBOUND_EMAIL_MAX_BYTES - head.length, 0x61)]);
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(res.status).toBe(202);
  });

  it("refuses a body that is not a raw message", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = Buffer.from("{}");
    const res = await t.app.request("/api/inbound-email", {
      method: "POST",
      body: raw,
      headers: {
        "content-type": "application/json",
        ...signRequest(SECRET, envelopeFrom("gmail", her, address), raw, nowS()),
      },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/inbound-email: her forwards are filed", () => {
  for (const [name, provider, build] of [
    ["Gmail", "gmail", gmailForward],
    ["Outlook", "outlook", outlookForward],
    ["iCloud", "icloud", icloudForward],
  ] as const) {
    it(`${name}: row, raw message in private storage, reading queued, purge in 30 days`, async () => {
      const her = mailbox(provider);
      const { address, userId } = await account(her);
      const raw = await signed(build(address, `Marie Test <${her}>`), provider);
      const res = await deliver(raw, envelopeFrom(provider, her, address));
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ result: "queued" });
      const [row, ...more] = await rowsOf(address);
      expect(more).toEqual([]);
      expect(row).toMatchObject({ userId, fromAddress: her, authOk: true, status: "queued" });
      expect(row?.rawObjectKey).toBe(rawEmailKey(userId, row?.id as string));
      expect((await stored(row?.rawObjectKey as string))?.equals(raw)).toBe(true);
      expect(row?.purgeAfter.getTime()).toBe(NOW.getTime() + 30 * DAY_MS);
      expect(parsed).toEqual([row?.id]);
    });
  }

  it("Gmail's automatic forwarding: ignored while INBOUND_AUTOFORWARD is off, filed when on", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = await sealed(await signed(gmailAutoForward(address), "shop"), "google");
    const envelope = () => envelopeFrom("gmail", gmailForwardingSender(her, address), address);
    expect(await (await deliver(raw, envelope())).json()).toEqual({ result: "ignored" });
    senderControl.autoForward = true;
    expect(await (await deliver(raw, envelope())).json()).toEqual({ result: "queued" });
  });

  it("files a delivery once: Postfix's retry (same queue id) is a duplicate, nothing more stored", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const envelope = envelopeFrom("gmail", her, address);
    expect(await (await deliver(raw, envelope)).json()).toEqual({ result: "queued" });
    expect(await (await deliver(raw, envelope)).json()).toEqual({ result: "duplicate" });
    expect(await rowsOf(address)).toHaveLength(1);
    expect(parsed).toHaveLength(1);
  });

  it("with the DNS down, someone else's forward is still just ignored (202)", async () => {
    const her = mailbox("gmail");
    const sophie = mailbox("gmail");
    const { address } = await account(her);
    senderControl.dnsFail = true;
    const raw = await signed(gmailForward(address, `Sophie <${sophie}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", sophie, address));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ result: "ignored" });
  });

  it("answers 503 when the DNS does not answer, nothing stored (Postfix tries again)", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    senderControl.dnsFail = true;
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(res.status).toBe(503);
    expect(await rowsOf(address)).toEqual([]);
  });

  it("finds her address whatever its case", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address.toUpperCase()));
    expect(await res.json()).toEqual({ result: "queued" });
  });
});

describe("POST /api/inbound-email: anything else is ignored, without the message (Review Focus 1)", () => {
  async function expectIgnored(address: string, fromAddress: string) {
    const [row, ...more] = await rowsOf(address);
    expect(more).toEqual([]);
    expect(row).toMatchObject({ userId: null, fromAddress, authOk: false, status: "ignored", rawObjectKey: null });
    expect(parsed).toEqual([]);
  }

  it("forwarded by someone else", async () => {
    const her = mailbox("gmail");
    const sophie = mailbox("gmail");
    const { address } = await account(her);
    const raw = await signed(gmailForward(address, `Sophie <${sophie}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", sophie, address));
    expect(await res.json()).toEqual({ result: "ignored" });
    await expectIgnored(address, sophie);
  });

  it("her address forged from another server, with headers claiming it passed", async () => {
    const her = mailbox("gmail");
    const { address, userId } = await account(her);
    const raw = unsigned(
      "Authentication-Results: mx.closyria.com; spf=pass; dkim=pass header.d=gmail.example; dmarc=pass\n" +
        gmailForward(address, `Marie <${her}>`),
    );
    const res = await deliver(raw, envelopeFrom("attacker", her, address));
    expect(await res.json()).toEqual({ result: "ignored" });
    await expectIgnored(address, her);
    // Nothing of hers in storage either.
    const [row] = await rowsOf(address);
    expect(await stored(rawEmailKey(userId, row?.id as string))).toBeNull();
  });

  it("a signature that no longer verifies", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    const good = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const raw = Buffer.from(good.toString("utf8").replace("89,00 EUR", "1,00 EUR"));
    const res = await deliver(raw, envelopeFrom("attacker", her, address));
    expect(await res.json()).toEqual({ result: "ignored" });
    await expectIgnored(address, her);
  });

  it("her own forward, but her account's address is not verified", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her, { verified: false });
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(await res.json()).toEqual({ result: "ignored" });
    await expectIgnored(address, her);
  });

  it("an address nobody has, or another domain: nothing stored", async () => {
    const her = mailbox("gmail");
    const raw = await signed(gmailForward(`personne-zz22@${INBOX_DOMAIN}`, `Marie <${her}>`), "gmail");
    const before = await t.db.select().from(schema.inboundEmails);
    for (const to of [`personne-zz22@${INBOX_DOMAIN}`, `marie-k7f2@commandes.closyria.example`]) {
      const res = await deliver(raw, envelopeFrom("gmail", her, to));
      expect(await res.json()).toEqual({ result: "dropped" });
    }
    expect((await t.db.select().from(schema.inboundEmails)).length).toBe(before.length);
  });

  /** Fills today's quota of an address with `n` rows of `status`. */
  async function fill(address: string, n: number, status: "ignored" | "parsed") {
    const local = address.split("@")[0] as string;
    const [inbox] = await t.db.select().from(schema.orderInboxes).where(eq(schema.orderInboxes.localPart, local));
    await t.db.insert(schema.inboundEmails).values(
      Array.from({ length: n }, () => ({
        inboxId: inbox?.id as string,
        userId: status === "ignored" ? null : inbox?.userId,
        queueId: `Q${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`,
        fromAddress: "x@example.test",
        authOk: status !== "ignored",
        status,
        receivedAt: new Date(NOW.getTime() - 60_000),
        purgeAfter: new Date(NOW.getTime() + 30 * DAY_MS),
      })),
    );
  }

  it("keeps 20 ignored e-mails a day per address, then nothing; hers still go through", async () => {
    const her = mailbox("gmail");
    const sophie = mailbox("gmail");
    const { address } = await account(her);
    await fill(address, MAX_IGNORED_INBOUND_EMAILS_PER_DAY, "ignored");
    const other = await signed(gmailForward(address, `Sophie <${sophie}>`), "gmail");
    expect(await (await deliver(other, envelopeFrom("gmail", sophie, address))).json()).toEqual({ result: "dropped" });
    const mine = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    expect(await (await deliver(mine, envelopeFrom("gmail", her, address))).json()).toEqual({ result: "queued" });
  });

  it("keeps 100 of her e-mails a day per address, counting hers only", async () => {
    const her = mailbox("gmail");
    const { address } = await account(her);
    await fill(address, MAX_IGNORED_INBOUND_EMAILS_PER_DAY, "ignored");
    await fill(address, MAX_INBOUND_EMAILS_PER_DAY - 1, "parsed");
    const mine = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    expect(await (await deliver(mine, envelopeFrom("gmail", her, address))).json()).toEqual({ result: "queued" });
    expect(await (await deliver(mine, envelopeFrom("gmail", her, address))).json()).toEqual({ result: "dropped" });
  });
});

describe("Gmail's forwarding confirmation", () => {
  it("keeps its code for 24 hours when the Gmail address that asked is hers, nothing else stored", async () => {
    const her = `marie.test${++counter}@gmail.example`;
    const { address, cookie } = await account(her);
    const raw = await signed(gmailConfirmation(address, her, "185412963"), "google");
    const res = await deliver(raw, envelopeFrom("google", "forwarding-noreply@google.example", address));
    expect(await res.json()).toEqual({ result: "confirmation" });
    expect(await rowsOf(address)).toEqual([]);
    expect(parsed).toEqual([]);
    expect(await (await call("GET", "/api/me/order-inbox", cookie)).json()).toEqual({
      address,
      pendingGmailCode: "185412963",
    });
    clock.now = new Date(NOW.getTime() + 24 * 3_600_000 + 1);
    expect(await (await call("GET", "/api/me/order-inbox", cookie)).json()).toEqual({
      address,
      pendingGmailCode: null,
    });
  });

  it("asked by another address: ignored, no code", async () => {
    const her = mailbox("gmail");
    const { address, cookie } = await account(her);
    const raw = await signed(gmailConfirmation(address, "sophie.autre@gmail.example"), "google");
    const res = await deliver(raw, envelopeFrom("google", "forwarding-noreply@google.example", address));
    expect(await res.json()).toEqual({ result: "ignored" });
    expect(await (await call("GET", "/api/me/order-inbox", cookie)).json()).toEqual({
      address,
      pendingGmailCode: null,
    });
  });
});

describe("POST /api/inbound-email: storage order", () => {
  it("a failed write marks the row failed, leaves no object and queues nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const her = mailbox("gmail");
    const { address, userId } = await account(her);
    storeControl.failPut = true;
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(await res.json()).toEqual({ result: "failed" });
    const [row] = await rowsOf(address);
    expect(row).toMatchObject({ userId, status: "failed", rawObjectKey: null });
    expect(deleted).toEqual([rawEmailKey(userId, row?.id as string)]);
    expect(parsed).toEqual([]);
    vi.mocked(console.error).mockRestore();
  });

  it("a row deleted while its message was being written (her account): the object goes too", async () => {
    const her = mailbox("gmail");
    const { address, userId } = await account(her);
    storeControl.beforePut = async () => {
      await t.db.delete(schema.inboundEmails).where(eq(schema.inboundEmails.userId, userId));
    };
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(await res.json()).toEqual({ result: "dropped" });
    expect(deleted).toHaveLength(1);
    expect(await stored(deleted[0] as string)).toBeNull();
    expect(parsed).toEqual([]);
  });

  it("a queue that does not answer marks the row failed (the message stays for 30 days, for a manual entry)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const her = mailbox("gmail");
    const { address } = await account(her);
    queueControl.fail = true;
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    const res = await deliver(raw, envelopeFrom("gmail", her, address));
    expect(await res.json()).toEqual({ result: "failed" });
    const [row] = await rowsOf(address);
    expect(row?.status).toBe("failed");
    expect(row?.rawObjectKey).not.toBeNull();
    vi.mocked(console.error).mockRestore();
  });

  it("never logs the message or the addresses", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const her = mailbox("gmail");
    const { address } = await account(her);
    storeControl.failPut = true;
    const raw = await signed(gmailForward(address, `Marie <${her}>`), "gmail");
    await deliver(raw, envelopeFrom("gmail", her, address));
    const logged = error.mock.calls.flat().map(String).join("\n");
    for (const secret of [her, address, "89,00 EUR"]) expect(logged).not.toContain(secret);
    error.mockRestore();
  });
});

describe("/api/me/order-inbox", () => {
  it("refuses a guest with 403 account_required", async () => {
    const guest = await t.signIn();
    for (const method of ["GET", "POST"]) {
      const res = await call(method, "/api/me/order-inbox", guest.cookie);
      expect(res.status, method).toBe(403);
      expect(await res.json()).toEqual({ error: "account_required" });
    }
    expect(await t.db.select().from(schema.orderInboxes).where(eq(schema.orderInboxes.userId, guest.userId))).toEqual(
      [],
    );
  });

  it("refuses without a session", async () => {
    expect((await call("GET", "/api/me/order-inbox", undefined)).status).toBe(401);
  });

  it("has none at first, then `{first name}-{4 characters}` on the environment's domain", async () => {
    const session = await t.signIn();
    await t.db
      .update(schema.user)
      .set({ isAnonymous: false, name: "Hélène Martin", email: mailbox("gmail"), emailVerified: true })
      .where(eq(schema.user.id, session.userId));
    expect(await (await call("GET", "/api/me/order-inbox", session.cookie)).json()).toEqual({
      address: null,
      pendingGmailCode: null,
    });
    const created = (await (await call("POST", "/api/me/order-inbox", session.cookie)).json()) as OrderInboxView;
    expect(created.address).toMatch(/^helene-[abcdefghjkmnpqrstuvwxyz23456789]{4}@commandes\.dev\.closyria\.com$/);
    expect(await (await call("GET", "/api/me/order-inbox", session.cookie)).json()).toEqual(created);
  });

  it("« commande » without a first name", async () => {
    const session = await t.signIn();
    const email = mailbox("gmail");
    await t.db
      .update(schema.user)
      .set({ isAnonymous: false, name: email, email, emailVerified: true })
      .where(eq(schema.user.id, session.userId));
    const { address } = (await (await call("POST", "/api/me/order-inbox", session.cookie)).json()) as OrderInboxView;
    expect(address).toMatch(/^commande-[a-z2-9]{4}@/);
  });

  it("« Changer d'adresse »: a new one, the former stops working (its e-mails dropped, nothing kept)", async () => {
    const her = mailbox("gmail");
    const { address: former, cookie } = await account(her);
    const res = await call("POST", "/api/me/order-inbox", cookie);
    const { address: current } = (await res.json()) as OrderInboxView;
    expect(current).not.toBe(former);
    expect(await (await call("GET", "/api/me/order-inbox", cookie)).json()).toEqual({
      address: current,
      pendingGmailCode: null,
    });

    const toFormer = await signed(gmailForward(former, `Marie <${her}>`), "gmail");
    expect(await (await deliver(toFormer, envelopeFrom("gmail", her, former))).json()).toEqual({ result: "dropped" });
    expect(await rowsOf(former)).toEqual([]);

    const toCurrent = await signed(gmailForward(current as string, `Marie <${her}>`), "gmail");
    expect(await (await deliver(toCurrent, envelopeFrom("gmail", her, current as string))).json()).toEqual({
      result: "queued",
    });
  });
});
