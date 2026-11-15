import { describe, expect, it, vi } from "vitest";
import { addressesOf, isAsciiAddress, isGroup } from "./headers";
import { aligned, gmailForwardingSender, mailauthSenderCheck, sameMailbox } from "./sender";
import {
  envelopeFrom,
  FIXTURE_GOOGLE,
  fixtureResolver,
  gmailAutoForward,
  gmailConfirmation,
  gmailForward,
  HER,
  INBOX_DOMAIN,
  icloudForward,
  outlookForward,
  sealed,
  signed,
  unsigned,
} from "./test-fixtures";

const TO = `marie-k7f2@${INBOX_DOMAIN}`;
const options = { mta: "mx.closyria.com", resolver: fixtureResolver(), google: FIXTURE_GOOGLE };
const check = mailauthSenderCheck(options);
const checkAuto = mailauthSenderCheck({ ...options, autoForward: true });
const accepted = (fromAddress: string) => ({ kind: "accepted", fromAddress });

describe("helpers", () => {
  it("compares mailboxes without case, never a +tag", () => {
    expect(sameMailbox("Marie.Test@Gmail.Example", "marie.test@gmail.example")).toBe(true);
    expect(sameMailbox("marie.test+x@gmail.example", "marie.test@gmail.example")).toBe(false);
  });

  it("aligns organizational domains, the private suffixes included", () => {
    expect(aligned("mail.boutique.example", "boutique.example")).toBe(true);
    expect(aligned("outlook.fr", "eur.outlook.fr")).toBe(true);
    expect(aligned("attacker.example", "gmail.example")).toBe(false);
    expect(aligned("marie.github.io", "attacker.github.io")).toBe(false);
  });

  it("writes Gmail's forwarding sender", () => {
    expect(gmailForwardingSender("Marie.Test@gmail.example", "Marie-K7F2@commandes.dev.closyria.com")).toBe(
      "marie.test+caf_=marie-k7f2=commandes.dev.closyria.com@gmail.example",
    );
  });

  it("reads address lists, groups and ASCII addresses", () => {
    expect(addressesOf(`"Moi" <${TO}>, b@c.example`)).toEqual([TO, "b@c.example"]);
    expect(addressesOf(`"${TO}" <other@x.example>`)).toEqual(["other@x.example"]);
    expect(addressesOf(`other@x.example (${TO})`)).toEqual(["other@x.example"]);
    expect(addressesOf(`vers votre adresse ${TO}.`)).toEqual([TO]);
    expect(isGroup("Amis: a@b.example, c@d.example;")).toBe(true);
    expect(isGroup('"Marie: la vraie" <a@b.example>')).toBe(false);
    expect(isAsciiAddress("marie@gmail.example")).toBe(true);
    for (const bad of ["marié@gmail.example", "marie@gmaïl.example", "a@b@c", "marie gmail.example"]) {
      expect(isAsciiAddress(bad), bad).toBe(false);
    }
  });
});

describe("rule 1, a forward she made: accepted with an aligned DKIM signature over the To naming this address", () => {
  it("Gmail", async () => {
    const raw = await signed(gmailForward(TO), "gmail");
    expect(await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).toEqual(accepted(HER));
  });

  it("Outlook", async () => {
    const her = "marie.test@outlook.example";
    const raw = await signed(outlookForward(TO), "outlook");
    expect(await check({ raw, envelope: envelopeFrom("outlook", her, TO), accountEmail: her })).toEqual(accepted(her));
  });

  it("iCloud", async () => {
    const her = "marie.test@icloud.example";
    const raw = await signed(icloudForward(TO), "icloud");
    expect(await check({ raw, envelope: envelopeFrom("icloud", her, TO), accountEmail: her })).toEqual(accepted(her));
  });

  it("the address in Cc", async () => {
    const message = gmailForward("ami@gmail.example").replace(/^To: .*$/m, `To: ami@gmail.example\nCc: ${TO}`);
    const raw = await signed(message, "gmail");
    expect(await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).toEqual(accepted(HER));
  });

  it("her account address without case", async () => {
    const raw = await signed(gmailForward(TO, "Marie <Marie.Test@GMAIL.example>"), "gmail");
    const verdict = await check({
      raw,
      envelope: envelopeFrom("gmail", HER, TO),
      accountEmail: "MARIE.test@gmail.EXAMPLE",
    });
    expect(verdict).toEqual(accepted(HER));
  });
});

describe("rule 1: ignored (Review Focus 1)", () => {
  const ignoredFor = (fromAddress: string) => ({ kind: "ignored", fromAddress });

  it("from her provider's servers but without DKIM: SPF alone is not enough", async () => {
    const raw = unsigned(gmailForward(TO));
    expect(await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).toEqual(ignoredFor(HER));
  });

  it("a message of hers to someone else, replayed to her order address", async () => {
    const raw = await signed(gmailForward("ami@gmail.example"), "gmail");
    expect(await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).toEqual(
      ignoredFor(HER),
    );
  });

  it("her signature does not cover the To field (it could have been changed)", async () => {
    const raw = await signed(gmailForward(TO), "gmail", { headerList: "From:Subject:Date:Message-ID" });
    expect((await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).kind).toBe("ignored");
  });

  it("her signed message with a second To field added above the signed one", async () => {
    const raw = await signed(gmailForward("ami@gmail.example"), "gmail");
    const replayed = Buffer.concat([Buffer.from(`To: ${TO}\r\n`), raw]);
    expect((await check({ raw: replayed, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).kind).toBe(
      "ignored",
    );
  });

  it("forwarded by someone else, even well signed", async () => {
    const sophie = "sophie.autre@gmail.example";
    const raw = await signed(gmailForward(TO, `Sophie <${sophie}>`), "gmail");
    expect(await check({ raw, envelope: envelopeFrom("gmail", sophie, TO), accountEmail: HER })).toEqual(
      ignoredFor(sophie),
    );
  });

  it("her address forged from another server, with made-up Authentication-Results saying pass", async () => {
    const forged =
      "Authentication-Results: mx.closyria.com; spf=pass smtp.mailfrom=gmail.example; dkim=pass header.d=gmail.example; dmarc=pass\n" +
      "Received-SPF: pass (mx.closyria.com: domain of marie.test@gmail.example designates 192.0.2.66 as permitted sender)\n" +
      "ARC-Authentication-Results: i=1; mx.google.example; dkim=pass; spf=pass; dmarc=pass\n" +
      gmailForward(TO);
    expect(
      await check({ raw: unsigned(forged), envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER }),
    ).toEqual(ignoredFor(HER));
  });

  it("her address in From, signed by another domain (valid but not aligned)", async () => {
    const raw = await signed(gmailForward(TO), "attacker");
    const envelope = envelopeFrom("attacker", "bounce@attacker.example", TO);
    expect((await check({ raw, envelope, accountEmail: HER })).kind).toBe("ignored");
  });

  it("a Gmail signature that no longer verifies (body changed after signing)", async () => {
    const raw = Buffer.from(
      (await signed(gmailForward(TO), "gmail")).toString("utf8").replace("89,00 EUR", "1,00 EUR"),
    );
    expect((await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).kind).toBe("ignored");
  });

  it("a Gmail signature over part of the body only (l=), text added after it", async () => {
    const raw = Buffer.concat([
      await signed(gmailForward(TO), "gmail", { bodyLength: 40 }),
      Buffer.from("Commande frauduleuse\r\n"),
    ]);
    expect((await check({ raw, envelope: envelopeFrom("attacker", HER, TO), accountEmail: HER })).kind).toBe("ignored");
  });

  it("display-name tricks: her address as the name of another mailbox", async () => {
    for (const from of [
      `"${HER}" <x@attacker.example>`,
      `${HER} <x@attacker.example>`,
      `Marie (${HER}) <x@attacker.example>`,
    ]) {
      const raw = await signed(gmailForward(TO, from), "attacker");
      const verdict = await check({
        raw,
        envelope: envelopeFrom("attacker", "x@attacker.example", TO),
        accountEmail: HER,
      });
      expect(verdict.kind, from).toBe("ignored");
    }
  });

  it("a From group, even of her address alone and signed by her provider", async () => {
    for (const from of [`Moi: ${HER};`, `Amis: ${HER}, sophie.autre@gmail.example;`]) {
      const raw = await signed(gmailForward(TO, from), "gmail");
      expect((await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).kind, from).toBe(
        "ignored",
      );
    }
  });

  it("two addresses in From, or two From fields", async () => {
    const two = await signed(gmailForward(TO, `Marie <${HER}>, Sophie <sophie.autre@gmail.example>`), "gmail");
    expect((await check({ raw: two, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).kind).toBe(
      "ignored",
    );
    const signedOnce = await signed(gmailForward(TO), "gmail");
    const twice = Buffer.concat([Buffer.from(`From: ${HER}\r\n`), signedOnce]);
    expect((await check({ raw: twice, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).kind).toBe(
      "ignored",
    );
  });

  it("a non-ASCII address in From", async () => {
    const her = "marié.test@gmail.example";
    const raw = await signed(gmailForward(TO, `Marie <${her}>`), "gmail");
    expect((await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: her })).kind).toBe("ignored");
  });

  it("the DNS does not answer: try again later (temperror)", async () => {
    const failing = mailauthSenderCheck({ ...options, resolver: fixtureResolver({ fail: true }) });
    const raw = await signed(gmailForward(TO), "gmail");
    expect(await failing({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER })).toEqual({
      kind: "retry",
    });
  });

  it("the DNS does not answer, but the message is not hers: ignored, no retry", async () => {
    const failing = mailauthSenderCheck({ ...options, resolver: fixtureResolver({ fail: true }) });
    const sophie = "sophie.autre@gmail.example";
    const raw = await signed(gmailForward(TO, `Sophie <${sophie}>`), "gmail");
    expect(await failing({ raw, envelope: envelopeFrom("gmail", sophie, TO), accountEmail: HER })).toEqual({
      kind: "ignored",
      fromAddress: sophie,
    });
  });

  it("an unreadable message is ignored", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const verdict = await check({ raw: Buffer.alloc(0), envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER });
    expect(verdict.kind).toBe("ignored");
    vi.restoreAllMocks();
  });
});

describe("rule 2, Gmail's automatic forwarding (INBOUND_AUTOFORWARD)", () => {
  const autoForward = async () => sealed(await signed(gmailAutoForward(TO), "shop"), "google");
  const envelope = (mailFrom = gmailForwardingSender(HER, TO)) => envelopeFrom("gmail", mailFrom, TO);

  it("off by default: ignored even when everything matches", async () => {
    expect((await check({ raw: await autoForward(), envelope: envelope(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("on: accepted with her exact caf_ sender, SPF for her Gmail domain and Google's ARC seal", async () => {
    expect(await checkAuto({ raw: await autoForward(), envelope: envelope(), accountEmail: HER })).toEqual(
      accepted(HER),
    );
  });

  it("on: a Google DKIM signature is the other accepted proof", async () => {
    const raw = await signed(gmailAutoForward(TO), "google");
    expect(await checkAuto({ raw, envelope: envelope(), accountEmail: HER })).toEqual(accepted(HER));
  });

  it("on: a signature of the Gmail mailbox domain is no proof (any Gmail user's mail has one)", async () => {
    const raw = await signed(gmailAutoForward(TO), "gmail");
    expect((await checkAuto({ raw, envelope: envelope(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("the DNS does not answer: retry for her exact forwarding sender when on, ignored when off", async () => {
    const down = { ...options, resolver: fixtureResolver({ fail: true }) };
    const raw = await autoForward();
    expect(
      await mailauthSenderCheck({ ...down, autoForward: true })({ raw, envelope: envelope(), accountEmail: HER }),
    ).toEqual({ kind: "retry" });
    expect((await mailauthSenderCheck(down)({ raw, envelope: envelope(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("on: refused without Google's proof", async () => {
    const raw = await signed(gmailAutoForward(TO), "shop");
    expect((await checkAuto({ raw, envelope: envelope(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("on: refused with any other tag, another mailbox, or a forward to another address", async () => {
    const raw = await autoForward();
    for (const mailFrom of [
      "marie.test+anything@gmail.example",
      "marie.test@gmail.example",
      gmailForwardingSender("sophie.autre@gmail.example", TO),
      gmailForwardingSender(HER, `autre-zz22@${INBOX_DOMAIN}`),
    ]) {
      expect((await checkAuto({ raw, envelope: envelope(mailFrom), accountEmail: HER })).kind, mailFrom).toBe(
        "ignored",
      );
    }
  });

  it("on: refused from a server Gmail's SPF does not allow", async () => {
    const raw = await autoForward();
    const fromElsewhere = envelopeFrom("attacker", gmailForwardingSender(HER, TO), TO);
    expect((await checkAuto({ raw, envelope: fromElsewhere, accountEmail: HER })).kind).toBe("ignored");
  });

  it("on: Gmail domains only (an Outlook mailbox gets nothing from this rule)", async () => {
    const her = "marie.test@outlook.example";
    const raw = await sealed(await signed(gmailAutoForward(TO), "shop"), "google");
    const env = envelopeFrom("outlook", gmailForwardingSender(her, TO), TO);
    expect((await checkAuto({ raw, envelope: env, accountEmail: her })).kind).toBe("ignored");
  });
});

describe("Gmail's forwarding confirmation", () => {
  const google = (mailFrom = "forwarding-noreply@google.example") => envelopeFrom("google", mailFrom, TO);

  it("gives the code when the address that asked is hers, only while automatic forwarding is accepted", async () => {
    const raw = await signed(gmailConfirmation(TO, HER), "google");
    expect(await checkAuto({ raw, envelope: google(), accountEmail: HER })).toEqual({
      kind: "gmail_confirmation",
      code: "185412963",
    });
    // INBOUND_AUTOFORWARD off: the code would never be shown, so it is not kept either (the e-mail is ignored).
    expect((await check({ raw, envelope: google(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("her own confirmation for another destination, replayed to her order address: ignored", async () => {
    const raw = await signed(gmailConfirmation("ailleurs@outlook.example", HER), "google");
    expect((await checkAuto({ raw, envelope: google(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("asked by someone else: ignored", async () => {
    const raw = await signed(gmailConfirmation(TO, "sophie.autre@gmail.example"), "google");
    expect((await checkAuto({ raw, envelope: google(), accountEmail: HER })).kind).toBe("ignored");
  });

  it("not signed by Google, or signed by another domain: ignored", async () => {
    for (const raw of [
      unsigned(gmailConfirmation(TO, HER)),
      await signed(gmailConfirmation(TO, HER), "attacker"),
      Buffer.from(
        (await signed(gmailConfirmation(TO, HER), "google")).toString("utf8").replace("185412963", "999999999"),
      ),
    ]) {
      expect((await checkAuto({ raw, envelope: google(), accountEmail: HER })).kind).toBe("ignored");
    }
  });
});

describe("her verified sender addresses (« Mes adresses d'envoi », spec §11)", () => {
  const OUTLOOK = "marie.test@outlook.example";
  const ICLOUD = "marie.test@icloud.example";

  it("rule 1 from a verified address: accepted, the address that matched recorded", async () => {
    const raw = await signed(outlookForward(TO), "outlook");
    const verdict = await check({
      raw,
      envelope: envelopeFrom("outlook", OUTLOOK, TO),
      accountEmail: HER,
      verifiedSenders: [ICLOUD, OUTLOOK],
    });
    expect(verdict).toEqual(accepted(OUTLOOK));
  });

  it("the account address still works alongside them", async () => {
    const raw = await signed(gmailForward(TO), "gmail");
    expect(
      await check({ raw, envelope: envelopeFrom("gmail", HER, TO), accountEmail: HER, verifiedSenders: [OUTLOOK] }),
    ).toEqual(accepted(HER));
  });

  it("an address that is not in the list (not verified, removed, someone else's) is ignored", async () => {
    const raw = await signed(outlookForward(TO), "outlook");
    for (const verifiedSenders of [[], [ICLOUD], undefined]) {
      const verdict = await check({
        raw,
        envelope: envelopeFrom("outlook", OUTLOOK, TO),
        accountEmail: HER,
        ...(verifiedSenders ? { verifiedSenders } : {}),
      });
      expect(verdict).toEqual({ kind: "ignored", fromAddress: OUTLOOK });
    }
  });

  it("a verified address forged without its provider's DKIM, or signed by another domain: ignored", async () => {
    const input = { accountEmail: HER, verifiedSenders: [OUTLOOK] };
    const forged = unsigned(outlookForward(TO));
    expect((await check({ raw: forged, envelope: envelopeFrom("attacker", OUTLOOK, TO), ...input })).kind).toBe(
      "ignored",
    );
    const otherDomain = await signed(outlookForward(TO), "attacker");
    expect(
      (await check({ raw: otherDomain, envelope: envelopeFrom("attacker", "x@attacker.example", TO), ...input })).kind,
    ).toBe("ignored");
    // Her Gmail signature does not vouch for her Outlook address.
    const crossed = await signed(gmailForward(TO, `Marie <${OUTLOOK}>`), "gmail");
    expect((await check({ raw: crossed, envelope: envelopeFrom("gmail", HER, TO), ...input })).kind).toBe("ignored");
  });

  it("the DNS does not answer on a verified address's own forward: try again later", async () => {
    const failing = mailauthSenderCheck({ ...options, resolver: fixtureResolver({ fail: true }) });
    const raw = await signed(outlookForward(TO), "outlook");
    expect(
      await failing({
        raw,
        envelope: envelopeFrom("outlook", OUTLOOK, TO),
        accountEmail: HER,
        verifiedSenders: [OUTLOOK],
      }),
    ).toEqual({ kind: "retry" });
  });

  it("rule 2 for a verified Gmail address (account elsewhere), only when on", async () => {
    const raw = await sealed(await signed(gmailAutoForward(TO), "shop"), "google");
    const input = {
      raw,
      envelope: envelopeFrom("gmail", gmailForwardingSender(HER, TO), TO),
      accountEmail: OUTLOOK,
      verifiedSenders: [HER],
    };
    expect(await checkAuto(input)).toEqual(accepted(HER));
    expect((await check(input)).kind).toBe("ignored");
    expect((await checkAuto({ ...input, verifiedSenders: [] })).kind).toBe("ignored");
  });

  it("Gmail's confirmation asked by a verified Gmail address gives its code", async () => {
    const raw = await signed(gmailConfirmation(TO, HER), "google");
    const envelope = envelopeFrom("google", "forwarding-noreply@google.example", TO);
    expect(await checkAuto({ raw, envelope, accountEmail: OUTLOOK, verifiedSenders: [HER] })).toEqual({
      kind: "gmail_confirmation",
      code: "185412963",
    });
    expect((await checkAuto({ raw, envelope, accountEmail: OUTLOOK })).kind).toBe("ignored");
  });
});
