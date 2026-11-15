import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { type DNSResolver, dkimSign } from "mailauth";
import type { Envelope } from "./signature";

/**
 * Synthetic e-mails for the reception tests, shaped like the forwards of Gmail, Outlook and iCloud (headers, the
 * quoted block each one writes, multipart bodies). Every address and domain is made up (`.example`, RFC 2606); the
 * DKIM keys are drawn for the test run and published by `fixtureResolver`, which plays the DNS.
 */

export const INBOX_DOMAIN = "commandes.dev.closyria.com";
export const HER = "marie.test@gmail.example";

type Provider = { domain: string; selector: string; network: string; ip: string; helo: string };

export const PROVIDERS = {
  gmail: {
    domain: "gmail.example",
    selector: "20230601",
    network: "198.51.100.0/24",
    ip: "198.51.100.17",
    helo: "mail-wr1-f41.gmail.example",
  },
  outlook: {
    domain: "outlook.example",
    selector: "selector1",
    network: "198.51.101.0/24",
    ip: "198.51.101.40",
    helo: "EUR05-AM6-obe.outbound.outlook.example",
  },
  icloud: {
    domain: "icloud.example",
    selector: "1a1hai",
    network: "198.51.102.0/24",
    ip: "198.51.102.9",
    helo: "st43p00im-ztfb10071701.me.icloud.example",
  },
  shop: {
    domain: "boutique.example",
    selector: "shop",
    network: "203.0.113.0/24",
    ip: "203.0.113.25",
    helo: "mta.boutique.example",
  },
  attacker: {
    domain: "attacker.example",
    selector: "evil",
    network: "192.0.2.0/24",
    ip: "192.0.2.66",
    helo: "smtp.attacker.example",
  },
} as const satisfies Record<string, Provider>;
export type ProviderName = keyof typeof PROVIDERS;

const keys = Object.fromEntries(
  Object.keys(PROVIDERS).map((name) => [name, generateKeyPairSync("rsa", { modulusLength: 2048 })]),
) as Record<ProviderName, { publicKey: KeyObject; privateKey: KeyObject }>;

const pem = (name: ProviderName) => keys[name].privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const publicKey = (name: ProviderName) =>
  (keys[name].publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");

/** The fake DNS: SPF and DKIM records of every provider; anything else does not exist. */
export function fixtureResolver(options: { fail?: boolean } = {}): DNSResolver {
  const records = new Map<string, string[][]>();
  for (const [name, p] of Object.entries(PROVIDERS) as [ProviderName, Provider][]) {
    records.set(`TXT ${p.domain}`, [[`v=spf1 ip4:${p.network} -all`]]);
    records.set(`TXT ${p.selector}._domainkey.${p.domain}`, [[`v=DKIM1; k=rsa; p=${publicKey(name)}`]]);
  }
  return async (domain, rrtype) => {
    if (options.fail) throw Object.assign(new Error("SERVFAIL"), { code: "ESERVFAIL" });
    const found = records.get(`${rrtype} ${domain.toLowerCase()}`);
    if (!found) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return found;
  };
}

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

/** Signs `message` as `signer`'s domain (`bodyLength`: an `l=` tag, only part of the body signed). */
export async function signed(message: string, signer: ProviderName, bodyLength?: number): Promise<Buffer> {
  const p = PROVIDERS[signer];
  const raw = crlf(message);
  const result = await dkimSign(raw, {
    signatureData: [
      {
        signingDomain: p.domain,
        selector: p.selector,
        privateKey: pem(signer),
        ...(bodyLength === undefined ? {} : { maxBodyLength: bodyLength }),
      },
    ],
  });
  if (result.errors.length > 0) throw new Error("fixture not signed");
  return Buffer.from(result.signatures + raw);
}

export const unsigned = (message: string) => Buffer.from(crlf(message));

export function envelopeFrom(provider: ProviderName, mailFrom: string, rcptTo: string): Envelope {
  const p = PROVIDERS[provider];
  return { v: 1, mailFrom, rcptTo, clientIp: p.ip, helo: p.helo };
}

const SHOP_ORDER_TEXT = `Bonjour Marie,

Merci pour votre commande #1042 !

Robe portefeuille Lina - Taille 38 - Terracotta x 1 : 89,00 EUR
Livraison Colissimo : offerte
Total : 89,00 EUR

Boutique Exemple`;

/** Gmail, « Transférer » by hand: her address in From, Gmail's quoted block, multipart/alternative. */
export function gmailForward(to: string, from = `Marie Test <${HER}>`): string {
  return `MIME-Version: 1.0
Date: Sat, 14 Nov 2026 10:12:31 +0100
Message-ID: <CAJx7fwd0001aGmailExample@mail.gmail.example>
Subject: Fwd: Confirmation de votre commande #1042
From: ${from}
To: ${to}
Content-Type: multipart/alternative; boundary="000000000000c1d2e3f40596a7b8"

--000000000000c1d2e3f40596a7b8
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

---------- Forwarded message ---------
De : Boutique Exemple <commandes@boutique.example>
Date: ven. 13 nov. 2026 =C3=A0 18:40
Subject: Confirmation de votre commande #1042
To: <${HER}>

${SHOP_ORDER_TEXT}

--000000000000c1d2e3f40596a7b8
Content-Type: text/html; charset="UTF-8"

<div dir="ltr"><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>De&nbsp;: <strong class="gmail_sendername">Boutique Exemple</strong> <span>&lt;commandes@boutique.example&gt;</span><br></div><p>Merci pour votre commande #1042 !</p><p>Robe portefeuille Lina - Taille 38 - Terracotta x 1 : 89,00 EUR</p></div></div>

--000000000000c1d2e3f40596a7b8--
`;
}

/** Outlook, « Transférer » by hand: « TR: », its De / Envoyé / À / Objet block, HTML only. */
export function outlookForward(to: string, from = "Marie Test <marie.test@outlook.example>"): string {
  return `From: ${from}
To: "${to}" <${to}>
Subject: TR: Confirmation de votre commande #1042
Thread-Topic: Confirmation de votre commande #1042
Thread-Index: AQHZxyzzk0001ExampleOnly==
Date: Sat, 14 Nov 2026 09:20:04 +0000
Message-ID: <AM6PR05MB0001EXAMPLE@AM6PR05MB0001.eurprd05.prod.outlook.example>
Accept-Language: fr-FR, en-US
Content-Language: fr-FR
X-MS-Has-Attach:
Content-Type: text/html; charset="iso-8859-1"
Content-Transfer-Encoding: quoted-printable
MIME-Version: 1.0

<html><body><div>&nbsp;</div><hr style=3D"display:inline-block;width:98%"><div id=3D"divRplyFwdMsg"><b>De =
:</b> Boutique Exemple &lt;commandes@boutique.example&gt;<br><b>Envoy=E9 :</b> vendredi 13 novembre 2026 18:40<br><b>=C0 :=
</b> marie.test@outlook.example<br><b>Objet :</b> Confirmation de votre commande #1042</div><p>Merci pour votre commande #1042 !</p></body></html>
`;
}

/** iCloud (Mail on iPhone or icloud.com), « Transférer »: « Début du message réexpédié », Apple-Mail boundary. */
export function icloudForward(to: string, from = "Marie Test <marie.test@icloud.example>"): string {
  return `From: ${from}
Content-Type: multipart/alternative; boundary="Apple-Mail=_5F0C2E41-0000-4C1D-9C3A-EXAMPLE00001"
Mime-Version: 1.0 (Mac OS X Mail 16.0 \\(3826.400.131.1.6\\))
Subject: Fwd: Confirmation de votre commande #1042
Message-Id: <4B5E7C1A-0001-4E7A-8F0E-EXAMPLE@icloud.example>
Date: Sat, 14 Nov 2026 10:31:12 +0100
To: ${to}

--Apple-Mail=_5F0C2E41-0000-4C1D-9C3A-EXAMPLE00001
Content-Transfer-Encoding: quoted-printable
Content-Type: text/plain; charset=utf-8

D=C3=A9but du message r=C3=A9exp=C3=A9di=C3=A9 :

De: Boutique Exemple <commandes@boutique.example>
Objet: Confirmation de votre commande #1042
Date: 13 novembre 2026 =C3=A0 18:40:00 UTC+1
=C3=80: marie.test@icloud.example

Merci pour votre commande #1042 !
--Apple-Mail=_5F0C2E41-0000-4C1D-9C3A-EXAMPLE00001--
`;
}

/** The shop's own message, as Gmail's automatic forwarding passes it on (shop's From and signature kept). */
export function gmailAutoForward(to: string): string {
  return `X-Forwarded-To: ${to}
X-Forwarded-For: ${HER} ${to}
Delivered-To: ${HER}
From: Boutique Exemple <commandes@boutique.example>
To: ${HER}
Subject: Votre colis est en route
Date: Sat, 14 Nov 2026 08:02:00 +0100
Message-ID: <shipping-1042@boutique.example>
MIME-Version: 1.0
Content-Type: text/plain; charset="UTF-8"

Bonjour Marie,

Votre commande #1042 est en route avec Colissimo : 6A18537412398.
`;
}

/** Gmail's envelope sender for an automatic forward: a `+caf_=` subaddress of her mailbox. */
export function gmailForwardingSender(to: string, mailbox = HER): string {
  const [local, domain] = mailbox.split("@");
  return `${local}+caf_=${to.replace("@", "=")}@${domain}`;
}
