import { promises as dns } from "node:dns";
import { type AuthenticateResult, authenticate, type DKIMResult, type DNSResolver } from "mailauth";
import PostalMime from "postal-mime";
import { getDomain } from "tldts";
import { addressesOf, decodeEncodedWords, headerFields, isAsciiAddress, isGroup } from "./headers";
import type { Envelope } from "./signature";

/**
 * Who sent a received e-mail, and whether it may be filed (spec §5 and §10.1, Review Focus 1).
 *
 * Nothing in the message's headers is trusted as a verdict: an `Authentication-Results` or `Received-SPF` written by
 * the sender says what the sender wants. SPF, DKIM, ARC and alignment are computed here, by `mailauth`, from the raw
 * message and the SMTP envelope Postfix saw. The effective sender is the forwarding message's own, her mailbox, never
 * the shop's `From` inside a forwarded body:
 *
 * « Her address » is her account address or one of her verified sender addresses (« Mes adresses d'envoi », spec
 * §11): every rule below runs for whichever of them matches, with that address's own domain. A pending (unverified)
 * address is never given here.
 *
 * 1. a forward she made (« Transférer » in Gmail, Outlook, iCloud): her address alone in a well-formed `From:` (no
 *    group, plain ASCII), a DKIM signature that verifies, aligned with her domain, over the whole body, and which
 *    signs the `To:` or `Cc:` holding this order address (so a message of hers sent elsewhere, replayed here, does
 *    not count). SPF alone is never enough;
 * 2. Gmail's automatic forwarding, only with INBOUND_AUTOFORWARD=on: the shop's `From:` kept, MAIL FROM exactly
 *    `<her local part>+caf_=<order address, @ as =>@<her Gmail domain>`, SPF passing for that domain, and a second
 *    proof that Google sent it (a verified ARC set or a DKIM signature from Google);
 * 3. Gmail's forwarding confirmation (`forwarding-noreply@google.com`, signed by google.com), when the address that
 *    asked for the forwarding, in its text, is hers: its code is kept for « Mes commandes par e-mail ».
 *
 * Anything else is ignored. A DNS failure (temperror) on the check that would decide (rule 1's DKIM of her domain, rule
 * 2's SPF) asks Postfix to try again later; elsewhere it changes nothing.
 */

export type SenderVerdict =
  | { kind: "accepted"; fromAddress: string }
  | { kind: "ignored"; fromAddress: string }
  /** DNS temperror: nothing stored, Postfix retries. */
  | { kind: "retry" }
  /** Gmail's « Confirmation de transfert » for one of her own Gmail addresses: the code, nothing else kept. */
  | { kind: "gmail_confirmation"; code: string };

export type SenderCheck = (input: {
  raw: Buffer;
  envelope: Envelope;
  accountEmail: string;
  /** Her verified sender addresses (« Mes adresses d'envoi »), besides the account's; never a pending one. */
  verifiedSenders?: readonly string[];
}) => Promise<SenderVerdict>;

/** Google's names (overridden by the tests, whose fake DNS serves `.example` domains). */
export type GooglePolicy = {
  /** Gmail mailbox domains: the only ones automatic forwarding is accepted from. */
  mailboxDomains: readonly string[];
  /**
   * Domains whose ARC set or DKIM signature shows Google relayed the message. A second check only: rule 2's real
   * guarantee is SPF for her Gmail domain plus the exact `caf_` tag.
   */
  proofDomains: readonly string[];
  confirmationFrom: string;
  confirmationDomain: string;
};

export const GOOGLE: GooglePolicy = {
  mailboxDomains: ["gmail.com", "googlemail.com"],
  // Not gmail.com: any Gmail user's own messages carry it; only Google's relay signature says Google forwarded it.
  proofDomains: ["google.com"],
  confirmationFrom: "forwarding-noreply@google.com",
  confirmationDomain: "google.com",
};

export type SenderPolicy = {
  /** Rule 2 (INBOUND_AUTOFORWARD). Off until checked against real Gmail forwards on dev. */
  autoForward: boolean;
  google: GooglePolicy;
  /** Tests only: the clock for the « recent forward » check. */
  nowMs?: number;
};

const MAX_STORED_ADDRESS = 320;
/** DNS answers mailauth waits for (SPF may chain up to 10 lookups). */
const DNS_TIMEOUT_MS = 3_000;
const UNKNOWN = "(inconnu)";

const lower = (address: string) => address.trim().toLowerCase();
const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);
const localOf = (address: string) => address.slice(0, address.lastIndexOf("@"));

/** Same mailbox, case aside. */
export function sameMailbox(candidate: string, own: string): boolean {
  return lower(candidate) === lower(own);
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

/** Gmail's envelope sender for an automatic forward of `mailbox` to `rcptTo`. */
export function gmailForwardingSender(mailbox: string, rcptTo: string): string {
  const m = lower(mailbox);
  return `${localOf(m)}+caf_=${lower(rcptTo).replace("@", "=")}@${domainOf(m)}`;
}

/** Passing signatures over the whole body (an `l=` tag leaves room for added text). */
function passing(result: AuthenticateResult): DKIMResult[] {
  return result.dkim.results.filter((r) => r.status.result === "pass" && r.signingDomain && !r.status.underSized);
}

/** The header names a signature covers (its `h=` tag), lowercase. */
function signedHeaders(r: DKIMResult): string[] {
  return (r.signingHeaders?.keys ?? "").split(":").map((k) => k.trim().toLowerCase());
}

/** The From address when there is exactly one, well formed, not a group, plain ASCII. */
function singleFrom(result: AuthenticateResult, fields: { name: string; value: string }[]): string | undefined {
  const froms = fields.filter((f) => f.name === "from");
  if (result.dkim.fromFields !== 1 || froms.length !== 1 || result.dkim.fromSyntax !== "valid") return undefined;
  if (isGroup((froms[0] as { value: string }).value) || result.dkim.headerFrom.length !== 1) return undefined;
  const from = lower(result.dkim.headerFrom[0] as string);
  return isAsciiAddress(from) ? from : undefined;
}

/** Rule 1: an aligned signature that also signs the one To (or Cc) field naming this order address. */
/** « TR: », « Fwd: », « Fw: », « FW: » (any case, a non-breaking space allowed before the colon). */
const FORWARD_SUBJECT = /^\s*(?:tr|fwd?)[\s\u00a0]*:/i;
/** A forward older than this does not count as « just forwarded » (Microsoft rule, §10.1). */
const FORWARD_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const FORWARD_MAX_SKEW_MS = 24 * 3600 * 1000;

function signedForUs(
  result: AuthenticateResult,
  fields: { name: string; value: string }[],
  from: string,
  rcpt: string,
  nowMs: number,
) {
  const tos = fields.filter((f) => f.name === "to");
  const ccs = fields.filter((f) => f.name === "cc");
  // One field each at most: a second, added above, would not be the one the signature covers.
  if (tos.length > 1 || ccs.length > 1) return false;
  const inTo = tos.some((f) => addressesOf(f.value).includes(rcpt));
  const inCc = ccs.some((f) => addressesOf(f.value).includes(rcpt));
  // Microsoft (Hotmail, Outlook) never signs To/Cc. Its signature still counts when it covers a single Subject that
  // says « forwarded » and a single Date of the last 7 days: replaying one of her signed e-mails then needs one she
  // forwarded to that person this week (founder's ruling, 2026-11-15, spec §10.1).
  const subjects = fields.filter((f) => f.name === "subject");
  const dates = fields.filter((f) => f.name === "date");
  const sentAt = dates.length === 1 ? Date.parse((dates[0] as { value: string }).value) : Number.NaN;
  const recentForward =
    (inTo || inCc) &&
    subjects.length === 1 &&
    FORWARD_SUBJECT.test(decodeEncodedWords((subjects[0] as { value: string }).value)) &&
    Number.isFinite(sentAt) &&
    sentAt <= nowMs + FORWARD_MAX_SKEW_MS &&
    nowMs - sentAt <= FORWARD_MAX_AGE_MS;
  return passing(result).some((r) => {
    if (!aligned(r.signingDomain as string, domainOf(from))) return false;
    const covered = signedHeaders(r);
    if ((inTo && covered.includes("to")) || (inCc && covered.includes("cc"))) return true;
    return recentForward && covered.includes("subject") && covered.includes("date");
  });
}

/**
 * Why rule 1 refused, for the API log: never an address, only provider domains of the DKIM signatures (whose
 * selectors and results say why her provider's signature did not count).
 */
export function ignoredReason(
  result: AuthenticateResult,
  fields: { name: string; value: string }[],
  hersFrom: string | undefined,
  rcpt: string,
): string {
  if (!hersFrom) return "From is not one of her verified addresses";
  const signatures = result.dkim.results.map((r) => {
    const covered = signedHeaders(r);
    return `d=${r.signingDomain ?? "?"} ${r.status.result}${covered.includes("to") ? " to" : ""}${covered.includes("cc") ? " cc" : ""}`;
  });
  const tos = fields.filter((f) => f.name === "to");
  const ccs = fields.filter((f) => f.name === "cc");
  const where = [
    tos.some((f) => addressesOf(f.value).includes(rcpt)) ? "order address in To" : "",
    ccs.some((f) => addressesOf(f.value).includes(rcpt)) ? "in Cc" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `From is hers (domain ${domainOf(hersFrom)}); ${where || "order address not in To/Cc"}; DKIM: ${signatures.join("; ") || "none"}`;
}

/** Rule 2's second proof: Google relayed it (verified ARC set from Google, or a Google DKIM signature). */
function relayedByGoogle(result: AuthenticateResult, google: GooglePolicy): boolean {
  const proof = new Set(google.proofDomains);
  const arc = result.arc;
  // TODO(dev): check against a real Gmail automatic forward that Gmail seals it with ARC d=google.com (or signs it
  // with DKIM d=google.com) before turning INBOUND_AUTOFORWARD on.
  const arcOk =
    arc !== false &&
    arc.status.result === "pass" &&
    arc.signature !== false &&
    arc.signature !== undefined &&
    arc.signature.status.result === "pass" &&
    proof.has(lower(arc.signature.signingDomain ?? ""));
  return arcOk || passing(result).some((r) => proof.has(lower(r.signingDomain as string)));
}

/** The text of a message (its text part, or its HTML without tags). */
async function textOf(raw: Buffer): Promise<string> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  if (email.text) return email.text;
  return (email.html ?? "").replace(/<[^>]*>/g, " ");
}

/** Gmail's forwarding confirmation: the code, when the address that asked is one of hers. */
async function gmailConfirmationCode(
  raw: Buffer,
  result: AuthenticateResult,
  from: string,
  own: readonly string[],
  rcpt: string,
  google: GooglePolicy,
): Promise<string | null> {
  if (from !== lower(google.confirmationFrom)) return null;
  if (!passing(result).some((r) => lower(r.signingDomain as string) === lower(google.confirmationDomain))) return null;
  const text = await textOf(raw);
  // « marie@gmail.com a demandé … » / « marie@gmail.com has requested … »: the first address that is not ours.
  // Her confirmation for another destination, replayed here, is not for this address.
  const addresses = addressesOf(text.replace(/[()[\]]/g, " "));
  if (!addresses.includes(rcpt)) return null;
  const requester = addresses.find((a) => a !== rcpt);
  if (!requester || !own.includes(requester)) return null;
  const code =
    /(?:confirmation code|code de confirmation)\s*:\s*(\d{6,12})\b/i.exec(text)?.[1] ??
    /\(#(\d{6,12})\)/.exec(headerFields(raw).find((f) => f.name === "subject")?.value ?? "")?.[1];
  return code ?? null;
}

/**
 * The decision, from mailauth's results (the tests feed it real results computed against fixtures). `senders`: her
 * addresses (the account's, then her verified ones), compared without case; the verdict names the one that matched.
 */
export async function decideSender(
  raw: Buffer,
  result: AuthenticateResult,
  envelope: Envelope,
  senders: readonly string[],
  policy: SenderPolicy,
): Promise<SenderVerdict> {
  const own = [...new Set(senders.map(lower))];
  const rcpt = lower(envelope.rcptTo);
  const fields = headerFields(raw);
  const from = singleFrom(result, fields);
  const mailFrom = lower(envelope.mailFrom);
  // Rule 1 looks at the From address (one of hers, or not); rule 2 at her Gmail address its caf_ sender names.
  const hersFrom = from !== undefined && own.includes(from) ? from : undefined;
  const autoForwarder = own.find(
    (address) =>
      isAsciiAddress(address) &&
      policy.google.mailboxDomains.includes(domainOf(address)) &&
      mailFrom === gmailForwardingSender(address, rcpt),
  );

  // Gmail's code only serves its automatic forwarding: while that is not accepted, it is never kept.
  if (from && policy.autoForward) {
    const code = await gmailConfirmationCode(raw, result, from, own, rcpt, policy.google);
    if (code) return { kind: "gmail_confirmation", code };
  }
  if (hersFrom && signedForUs(result, fields, hersFrom, rcpt, policy.nowMs ?? Date.now())) {
    return { kind: "accepted", fromAddress: hersFrom };
  }
  if (
    policy.autoForward &&
    autoForwarder !== undefined &&
    isAsciiAddress(mailFrom) &&
    result.spf !== false &&
    result.spf.status.result === "pass" &&
    lower(result.spf.domain) === domainOf(autoForwarder) &&
    relayedByGoogle(result, policy.google)
  ) {
    return { kind: "accepted", fromAddress: autoForwarder };
  }
  // A DNS failure (temperror) asks for a retry only when it hid the check that would decide: a DKIM signature of her
  // domain on her own forward (rule 1), or SPF on her exact Gmail forwarding sender (rule 2, when on).
  const rule1Undecided =
    hersFrom !== undefined &&
    result.dkim.results.some(
      (r) => r.status.result === "temperror" && r.signingDomain && aligned(r.signingDomain, domainOf(hersFrom)),
    );
  const rule2Undecided =
    policy.autoForward &&
    autoForwarder !== undefined &&
    result.spf !== false &&
    result.spf.status.result === "temperror";
  if (rule1Undecided || rule2Undecided) return { kind: "retry" };
  console.info(`inbound e-mail: ignored (${ignoredReason(result, fields, hersFrom, rcpt)})`);
  const claimed = from ?? lower(result.dkim.headerFrom[0] ?? "");
  return { kind: "ignored", fromAddress: (claimed || mailFrom || UNKNOWN).slice(0, MAX_STORED_ADDRESS) };
}

/** The system resolver, with a timeout and one retry. */
function systemResolver(): DNSResolver {
  const resolver = new dns.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 2 });
  return (name, rrtype) => resolver.resolve(name, rrtype) as Promise<string[][] | string[]>;
}

/** The production check: mailauth with the system resolver (or the tests' own, serving the fixtures' keys). */
export function mailauthSenderCheck(options: {
  mta: string;
  resolver?: DNSResolver;
  autoForward?: boolean;
  google?: GooglePolicy;
  /** Tests only: the clock for the « recent forward » check. */
  now?: () => number;
}): SenderCheck {
  const resolver = options.resolver ?? systemResolver();
  const policy: SenderPolicy = { autoForward: options.autoForward ?? false, google: options.google ?? GOOGLE };
  return async ({ raw, envelope, accountEmail, verifiedSenders = [] }) => {
    try {
      const result = await authenticate(raw, {
        ip: envelope.clientIp,
        helo: envelope.helo,
        sender: envelope.mailFrom,
        mta: options.mta,
        resolver,
        disableBimi: true,
        rejectRsaSha1: true,
      });
      return await decideSender(raw, result, envelope, [accountEmail, ...verifiedSenders], {
        ...policy,
        nowMs: options.now?.() ?? Date.now(),
      });
    } catch (error) {
      // A message that cannot be read is nobody's: ignored. Only the error's name, never the message.
      console.error(`inbound e-mail: authentication check failed (${error instanceof Error ? error.name : "error"})`);
      return { kind: "ignored", fromAddress: lower(envelope.mailFrom).slice(0, MAX_STORED_ADDRESS) || UNKNOWN };
    }
  };
}
