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

const isShopHost = (host: string) =>
  !NOT_A_SHOP.some((domain) => host === domain || host.endsWith(`.${domain}`)) &&
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

/**
 * The shop's own site as the e-mail shows it: the first link to a site that is no mailbox, carrier, platform or
 * network (a Shopify notification's header links to the shop), else the domain of the original sender — never
 * the domain of `ownAddress` (hers: a forward whose quoted header was not found shows her as the sender).
 */
export function shopHostOf(email: DecodedEmail, ownAddress?: string | null): string | null {
  const linked = email.html ? linkHosts(email.html).find(isShopHost) : undefined;
  if (linked) return linked;
  const domainOf = (address: string) => bare(address.slice(address.lastIndexOf("@") + 1));
  const address = originalHeader(email).fromAddress;
  const domain = address ? domainOf(address) : null;
  if (!domain || (ownAddress && domainOf(ownAddress.toLowerCase()) === domain)) return null;
  return isShopHost(domain) ? domain : null;
}
