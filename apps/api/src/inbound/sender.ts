import { promises as dns } from "node:dns";
import { type AuthenticateResult, authenticate, type DNSResolver } from "mailauth";
import { getDomain } from "tldts";
import type { Envelope } from "./signature";

/**
 * Who sent a received e-mail, and whether it may be filed (spec §5, plan « Global Constraints », Review Focus 1).
 *
 * Nothing in the message's headers is trusted: an `Authentication-Results` or `Received-SPF` written by the sender
 * says what the sender wants. SPF, DKIM and alignment are computed here, by `mailauth`, from the raw message and the
 * SMTP envelope Postfix saw (client address, HELO, MAIL FROM). The effective sender is the forwarding message's own,
 * her mailbox, never the shop's `From` inside a forwarded body:
 *
 * 1. a forward she made (Gmail « Transférer », Outlook « Transférer », iCloud « Transférer ») has her address in
 *    `From:`. Accepted when a DKIM signature that verifies is aligned with that address's domain, or SPF passed for an
 *    envelope domain aligned with it (relaxed alignment, as DMARC);
 * 2. an automatic forward (a Gmail forwarding address, a rule that redirects) keeps the shop's `From:` but sends
 *    with her mailbox as MAIL FROM (Gmail writes `marie+caf_=…@gmail.com`: a `+tag` of her own mailbox). Accepted when
 *    SPF passed for exactly that envelope domain (the provider vouches the message left from its servers for her).
 *
 * Anything else is ignored: someone else's forward (even well signed), her address forged without a signature that
 * verifies, a `From:` with several fields or addresses, a DNS failure (temperror counts as no).
 */

/** What the check decided. `fromAddress` is kept on the row: her mailbox when accepted, else the claimed sender. */
export type SenderVerdict = { accepted: boolean; fromAddress: string };

export type SenderCheck = (input: { raw: Buffer; envelope: Envelope; accountEmail: string }) => Promise<SenderVerdict>;

const MAX_STORED_ADDRESS = 320;
/** DNS answers mailauth waits for (SPF may chain up to 10 lookups). */
const DNS_TIMEOUT_MS = 3_000;

const lower = (address: string) => address.trim().toLowerCase();
const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

/** Same mailbox, case aside; with `tag`, a `+tag` of hers counts as hers (RFC 5233 subaddress). */
export function sameMailbox(candidate: string, own: string, options: { tag: boolean }): boolean {
  const a = lower(candidate);
  const b = lower(own);
  if (a === b) return true;
  if (!options.tag) return false;
  const at = a.lastIndexOf("@");
  const plus = a.indexOf("+");
  if (at < 1 || plus < 1 || plus > at) return false;
  return `${a.slice(0, plus)}${a.slice(at)}` === b;
}

/**
 * Relaxed alignment: both domains share their organizational domain (Public Suffix List, its private part included:
 * two customers of `github.io` are not one organization).
 */
export function aligned(a: string, b: string): boolean {
  const org = (domain: string) => getDomain(lower(domain), { allowPrivateDomains: true });
  const orgA = org(a);
  return orgA !== null && orgA === org(b);
}

/** The decision, from mailauth's results (pure: the tests feed it real results computed against fixtures). */
export function decideSender(result: AuthenticateResult, envelope: Envelope, accountEmail: string): SenderVerdict {
  const own = lower(accountEmail);
  const froms = result.dkim.headerFrom.map(lower);
  const from = result.dkim.fromFields === 1 && froms.length === 1 ? froms[0] : undefined;
  const mailFrom = lower(envelope.mailFrom);
  const spf = result.spf;
  const spfPass = spf !== false && spf.status.result === "pass";
  const dkimPassDomains = result.dkim.results
    // A signature over part of the body only (`l=`) leaves room for added text: not counted.
    .filter((r) => r.status.result === "pass" && r.signingDomain && !r.status.underSized)
    .map((r) => r.signingDomain as string);

  if (from && sameMailbox(from, own, { tag: false })) {
    const fromDomain = domainOf(from);
    const dkimOk = dkimPassDomains.some((d) => aligned(d, fromDomain));
    const spfOk = spfPass && mailFrom.includes("@") && aligned(domainOf(mailFrom), fromDomain);
    if (dkimOk || spfOk) return { accepted: true, fromAddress: own };
  }
  if (mailFrom.includes("@") && sameMailbox(mailFrom, own, { tag: true })) {
    if (spfPass && spf.domain.toLowerCase() === domainOf(mailFrom)) return { accepted: true, fromAddress: own };
  }
  const claimed = (from ?? froms[0] ?? mailFrom) || "(inconnu)";
  return { accepted: false, fromAddress: claimed.slice(0, MAX_STORED_ADDRESS) };
}

/** The system resolver, with a timeout and one retry. */
function systemResolver(): DNSResolver {
  const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  return (name, rrtype) => resolver.resolve(name, rrtype) as Promise<string[][] | string[]>;
}

/** The production check: mailauth with the system resolver (or the tests' own, serving the fixtures' keys). */
export function mailauthSenderCheck(options: { mta: string; resolver?: DNSResolver }): SenderCheck {
  const resolver = options.resolver ?? systemResolver();
  return async ({ raw, envelope, accountEmail }) => {
    try {
      const result = await authenticate(raw, {
        ip: envelope.clientIp,
        helo: envelope.helo,
        sender: envelope.mailFrom,
        mta: options.mta,
        resolver,
        disableArc: true,
        disableBimi: true,
        rejectRsaSha1: true,
      });
      return decideSender(result, envelope, accountEmail);
    } catch (error) {
      // A message mailauth cannot read is nobody's: ignored. Only the error's name, never the message.
      console.error(`inbound e-mail: authentication check failed (${error instanceof Error ? error.name : "error"})`);
      return { accepted: false, fromAddress: lower(envelope.mailFrom).slice(0, MAX_STORED_ADDRESS) || "(inconnu)" };
    }
  };
}
