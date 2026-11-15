import type { DecodedEmail } from "./decode";
import { originalHeader } from "./forwarded";

/**
 * Domains that are never the shop's own site: mailboxes, carriers, e-commerce platforms and their mailers,
 * payment, reviews and social networks. A host under one of them (`www.laposte.fr`) is skipped too. A shop's own
 * `*.myshopify.com` stays.
 */
const NOT_A_SHOP = [
  // Mailboxes
  "gmail.com",
  "googlemail.com",
  "google.com",
  "outlook.com",
  "outlook.fr",
  "hotmail.com",
  "hotmail.fr",
  "live.com",
  "live.fr",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "apple.com",
  "yahoo.com",
  "yahoo.fr",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "proton.me",
  "protonmail.com",
  // Carriers and tracking
  "laposte.fr",
  "colissimo.fr",
  "chronopost.fr",
  "mondialrelay.fr",
  "mondialrelay.com",
  "gls-france.com",
  "gls-group.eu",
  "gls-group.com",
  "dpd.fr",
  "dpd.com",
  "colisprive.com",
  "colisprive.fr",
  "ups.com",
  "dhl.com",
  "dhl.fr",
  "dhl.de",
  "aftership.com",
  "17track.net",
  "parcelsapp.com",
  "parcelpanel.com",
  // Platforms, mailers, payment, reviews
  "shopify.com",
  "shopifyemail.com",
  "shopifycdn.com",
  "shop.app",
  "klaviyo.com",
  "klaviyomail.com",
  "list-manage.com",
  "mailchimp.com",
  "sendgrid.net",
  "sendinblue.com",
  "brevo.com",
  "paypal.com",
  "paypal.fr",
  "stripe.com",
  "klarna.com",
  "getalma.eu",
  "trustpilot.com",
  "avis-verifies.com",
  "judge.me",
  // Mailers, click trackers, shorteners and hosting of their images
  "mjt.lu",
  "mailjet.com",
  "mailgun.net",
  "mailgun.org",
  "mandrillapp.com",
  "mcsv.net",
  "mcdlv.net",
  "mailchi.mp",
  "sparkpostmail.com",
  "hubspot.com",
  "hubspotemail.net",
  "hubspotlinks.com",
  "hs-sites.com",
  "customeriomail.com",
  "customer.io",
  "omnisend.com",
  "exacttarget.com",
  "rs6.net",
  "amazonses.com",
  "awstrack.me",
  "amazonaws.com",
  "cloudfront.net",
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "ow.ly",
  "goo.gl",
  "lnkd.in",
  "rebrand.ly",
  "cutt.ly",
  "urldefense.com",
  // Social networks
  "facebook.com",
  "instagram.com",
  "pinterest.com",
  "pinterest.fr",
  "tiktok.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "linkedin.com",
  "whatsapp.com",
  "closyria.com",
];

/** Mailers whose many tracking domains are numbered (`klclick1.com`, `sendibt3.com`, `omnisnippet1.com`…). */
const NUMBERED_MAILERS = /(?:^|\.)(?:klclick|sendib[a-z]{1,2}|omnisnippet|list-manage)\d*\.[a-z]+$/;

export const isShopHost = (host: string) =>
  !NOT_A_SHOP.some((domain) => host === domain || host.endsWith(`.${domain}`)) &&
  !NUMBERED_MAILERS.test(host) &&
  // The shop's own Shopify address stays; Shopify's other hosts (cdn.shopify.com…) are skipped above.
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);

const bare = (host: string) =>
  host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");

/** The hosts of the e-mail's web links, in order (only `http:` and `https:`; never fetched). */
export function linkHosts(html: string): string[] {
  const hosts: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
    try {
      hosts.push(bare(new URL(match[1] ?? "").hostname));
    } catch {
      // not an address
    }
  }
  return hosts;
}

/** A site linked to this often at least counts as the shop's when nothing better names it. */
const MIN_LINKS = 2;

/**
 * The shop's own site as the e-mail shows it, or null when nothing plausibly names one (no shop rather than a wrong
 * one: a mailer's click-tracking host must never become a shop):
 * 1. the original sender's domain (« bonjour@maison-lune.example »);
 * 2. else a DKIM signer of the message (a shop sending through a mailer signs with its own domain);
 * 3. else the site the e-mail links to most, at least twice.
 * Never a mailbox, carrier, platform, mailer, tracker, shortener or network, never the domain of `ownAddress` (hers:
 * a forward whose quoted header was not found shows her as the sender).
 */
export function shopHostOf(email: DecodedEmail, ownAddress?: string | null): string | null {
  const domainOf = (address: string) => bare(address.slice(address.lastIndexOf("@") + 1));
  const own = ownAddress ? domainOf(ownAddress.toLowerCase()) : null;
  const usable = (host: string | null): host is string => !!host && host !== own && isShopHost(host);

  const sender = originalHeader(email).fromAddress;
  const senderDomain = sender ? domainOf(sender) : null;
  if (usable(senderDomain)) return senderDomain;
  const signer = email.signers.map(bare).find(usable);
  if (signer) return signer;

  const counts = new Map<string, number>();
  for (const host of email.html ? linkHosts(email.html) : []) {
    if (usable(host)) counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [host, n] of counts) if (n >= MIN_LINKS && n > (best ? (counts.get(best) ?? 0) : 0)) best = host;
  return best;
}
