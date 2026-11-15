import { describe, expect, it, vi } from "vitest";
import { aligned, mailauthSenderCheck, sameMailbox } from "./sender";
import {
  envelopeFrom,
  fixtureResolver,
  gmailAutoForward,
  gmailForward,
  gmailForwardingSender,
  HER,
  INBOX_DOMAIN,
  icloudForward,
  outlookForward,
  signed,
  unsigned,
} from "./test-fixtures";

const TO = `marie-k7f2@${INBOX_DOMAIN}`;
const check = mailauthSenderCheck({ mta: "mx.closyria.com", resolver: fixtureResolver() });

describe("sameMailbox", () => {
  it("ignores case, and accepts her own +tag only when asked", () => {
    expect(sameMailbox("Marie.Test@Gmail.Example", "marie.test@gmail.example", { tag: false })).toBe(true);
    expect(sameMailbox("marie.test+caf_=x=y@gmail.example", "marie.test@gmail.example", { tag: false })).toBe(false);
    expect(sameMailbox("marie.test+caf_=x=y@gmail.example", "marie.test@gmail.example", { tag: true })).toBe(true);
    expect(sameMailbox("marie.testx@gmail.example", "marie.test@gmail.example", { tag: true })).toBe(false);
    expect(sameMailbox("sophie+marie.test@gmail.example", "marie.test@gmail.example", { tag: true })).toBe(false);
    expect(sameMailbox("marie.test@gmail.example.attacker.example", HER, { tag: true })).toBe(false);
    expect(sameMailbox("+@gmail.example", HER, { tag: true })).toBe(false);
  });
});

describe("aligned", () => {
  it("compares organizational domains", () => {
    expect(aligned("gmail.example", "gmail.example")).toBe(true);
    expect(aligned("mail.boutique.example", "boutique.example")).toBe(true);
    expect(aligned("outlook.fr", "eur.outlook.fr")).toBe(true);
    expect(aligned("attacker.example", "gmail.example")).toBe(false);
    // Two customers of the same public suffix are not the same organization.
    expect(aligned("marie.github.io", "attacker.github.io")).toBe(false);
  });
});

describe("mailauthSenderCheck: accepted (her mailbox, authenticated)", () => {
  it("Gmail, forwarded by hand: From is her, DKIM aligned", async () => {
    const raw = await signed(gmailForward(TO), "gmail");
    const verdict = await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER });
    expect(verdict).toEqual({ accepted: true, fromAddress: HER });
  });

  it("Outlook, forwarded by hand", async () => {
    const her = "marie.test@outlook.example";
    const raw = await signed(outlookForward(TO), "outlook");
    expect(await check({ raw, envelope: envelopeFrom("outlook", her, TO), accountEmail: her })).toEqual({
      accepted: true,
      fromAddress: her,
    });
  });

  it("iCloud, forwarded by hand", async () => {
    const her = "marie.test@icloud.example";
    const raw = await signed(icloudForward(TO), "icloud");
    expect(await check({ raw, envelope: envelopeFrom("icloud", her, TO), accountEmail: her })).toEqual({
      accepted: true,
      fromAddress: her,
    });
  });

  it("a forward by hand from her provider's servers without DKIM: SPF on her own envelope domain, aligned", async () => {
    const raw = unsigned(gmailForward(TO));
    expect((await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).accepted).toBe(true);
  });

  it("Gmail's automatic forwarding: the shop's From kept, her +caf_ mailbox as envelope, SPF passes", async () => {
    const raw = await signed(gmailAutoForward(TO), "shop");
    const envelope = envelopeFrom("gmail", gmailForwardingSender(TO), TO);
    expect(await check({ raw, envelope, accountEmail: HER })).toEqual({ accepted: true, fromAddress: HER });
  });

  it("compares her account address without case", async () => {
    const raw = await signed(gmailForward(TO, "Marie <Marie.Test@GMAIL.example>"), "gmail");
    const verdict = await check({
      raw,
      envelope: envelopeFrom("gmail", HER, TO),
      accountEmail: "MARIE.test@gmail.EXAMPLE",
    });
    expect(verdict).toEqual({ accepted: true, fromAddress: HER });
  });
});

describe("mailauthSenderCheck: ignored (Review Focus 1)", () => {
  it("forwarded by someone else, even well signed", async () => {
    const sophie = "sophie.autre@gmail.example";
    const raw = await signed(gmailForward(TO, `Sophie <${sophie}>`), "gmail");
    expect(await check({ raw, envelope: envelopeFrom("gmail", sophie, TO), accountEmail: HER })).toEqual({
      accepted: false,
      fromAddress: sophie,
    });
  });

  it("her address forged from another server, with made-up Authentication-Results saying pass", async () => {
    const forged =
      "Authentication-Results: mx.closyria.com; spf=pass smtp.mailfrom=gmail.example; dkim=pass header.d=gmail.example; dmarc=pass\n" +
      "Received-SPF: pass (mx.closyria.com: domain of marie.test@gmail.example designates 192.0.2.66 as permitted sender)\n" +
      "ARC-Authentication-Results: i=1; mx.google.example; dkim=pass; spf=pass; dmarc=pass\n" +
      gmailForward(TO);
    const raw = unsigned(forged);
    expect(await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).toEqual({
      accepted: false,
      fromAddress: HER,
    });
  });

  it("her address in From, signed by another domain (valid but not aligned)", async () => {
    const raw = await signed(gmailForward(TO), "attacker");
    const envelope = envelopeFrom("attacker", "bounce@attacker.example", TO);
    expect((await check({ raw, envelope, accountEmail: HER })).accepted).toBe(false);
  });

  it("a Gmail signature that no longer verifies (body changed after signing)", async () => {
    const raw = Buffer.from(
      (await signed(gmailForward(TO), "gmail")).toString("utf8").replace("89,00 EUR", "1,00 EUR"),
    );
    expect((await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).accepted).toBe(false);
  });

  it("a Gmail signature over part of the body only (l=), text added after it", async () => {
    const message = gmailForward(TO);
    const raw = Buffer.concat([await signed(message, "gmail", 40), Buffer.from("Commande frauduleuse\r\n")]);
    expect((await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).accepted).toBe(false);
  });

  it("her mailbox as envelope, but sent from a server her domain does not allow (SPF fails)", async () => {
    const raw = await signed(gmailAutoForward(TO), "shop");
    const envelope = envelopeFrom("attacker", gmailForwardingSender(TO), TO);
    expect((await check({ raw, envelope, accountEmail: HER })).accepted).toBe(false);
  });

  it("someone else's automatic forward", async () => {
    const raw = await signed(gmailAutoForward(TO), "shop");
    const envelope = envelopeFrom("gmail", gmailForwardingSender(TO, "sophie.autre@gmail.example"), TO);
    expect(await check({ raw, envelope, accountEmail: HER })).toEqual({
      accepted: false,
      fromAddress: "commandes@boutique.example",
    });
  });

  it("the shop's own message sent straight to her address (not a forward of hers)", async () => {
    const raw = await signed(gmailAutoForward(TO), "shop");
    const envelope = envelopeFrom("shop", "bounce@boutique.example", TO);
    expect((await check({ raw, envelope, accountEmail: HER })).accepted).toBe(false);
  });

  it("two addresses in From", async () => {
    const raw = await signed(gmailForward(TO, `Marie <${HER}>, Sophie <sophie.autre@gmail.example>`), "gmail");
    expect(
      (await check({ raw, envelope: envelopeFrom("attacker", "x@attacker.example", TO), accountEmail: HER })).accepted,
    ).toBe(false);
  });

  it("the DNS does not answer: nothing can be verified", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = mailauthSenderCheck({ mta: "mx.closyria.com", resolver: fixtureResolver({ fail: true }) });
    const raw = await signed(gmailForward(TO), "gmail");
    expect((await failing({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).accepted).toBe(false);
    vi.restoreAllMocks();
  });
});
