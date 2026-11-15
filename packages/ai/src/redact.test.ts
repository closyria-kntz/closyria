import { describe, expect, it } from "vitest";
import { redactPersonalData } from "./redact";

// Invented people and places; card and IBAN numbers are the public test numbers.
const EMAIL = `---------- Forwarded message ---------
From: Maison Lune <bonjour@maison-lune.test>
Date: Mon, Nov 9, 2026 at 2:32 PM
Subject: Commande #10421 confirmée
To: Camille Martin <camille.martin@exemple.test>
Cc: lea.bernard@exemple.test

Commande #10421
Robe Lina × 1
M / Écru
89,00 €
Suivi Colissimo : 6A01234567890 — CB123456785FR — 1Z999AA10123456784

Adresse de livraison
Camille Martin
12 rue des Lilas
Bâtiment B
69003 Lyon
France

Adresse de facturation
Camille Martin
4bis, avenue Foch
75016 PARIS

Point relais : 221B Baker Street, London NW1 6XE
Shipping to: 350 Fifth Avenue, New York, NY 10118
Téléphone : 06 12 34 56 78 · +33 6 98 76 54 32 · 0033 1 23 45 67 89 · +44 20 7946 0958
Carte : 4970 1012 3456 7893 · 5555-5555-5555-4444
IBAN : FR76 3000 6000 0112 3456 7890 189 ou GB82WEST12345698765432
Total 10000 EUR
`;

describe("redactPersonalData", () => {
  const out = redactPersonalData(EMAIL);

  it("leaves no e-mail address, phone, card, IBAN nor postal address", () => {
    for (const secret of [
      "@",
      "camille.martin",
      "lea.bernard",
      "rue des Lilas",
      "Bâtiment B",
      "69003",
      "Lyon",
      "avenue Foch",
      "75016",
      "Baker Street",
      "NW1 6XE",
      "Fifth Avenue",
      "10118",
      "06 12 34 56 78",
      "98 76 54 32",
      "23 45 67 89",
      "7946 0958",
      "4970 1012",
      "5555-5555",
      "FR76",
      "GB82WEST",
    ]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it("keeps what the order is about: shop, number, articles, prices, tracking numbers", () => {
    for (const kept of [
      "Maison Lune",
      "Commande #10421",
      "Robe Lina × 1",
      "M / Écru",
      "89,00 €",
      "6A01234567890",
      "CB123456785FR",
      "1Z999AA10123456784",
      "Total 10000 EUR",
    ]) {
      expect(out, kept).toContain(kept);
    }
  });

  it("marks what was taken out", () => {
    expect(out).toContain("[e-mail]");
    expect(out).toContain("[adresse]");
    expect(out).toContain("[téléphone]");
    expect(out).toContain("[carte]");
    expect(out).toContain("[IBAN]");
    expect(out).toContain("[destinataire]");
  });

  it("takes out any card-shaped number, even one that fails the Luhn check (it might be a card)", () => {
    expect(redactPersonalData("Colis 0123456789012345")).toBe("Colis [carte]");
  });
});

describe("redactPersonalData on huge lines", () => {
  it("stays fast, cuts long lines at a space and drops a run without one", () => {
    const started = Date.now();
    const out = redactPersonalData(`${"camille@exemple.test ".repeat(5000)}\n${"x".repeat(200_000)}`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out).not.toContain("@");
    expect(out).not.toContain("xxxx");
    expect(out).toContain("[…]");
  });
});

describe("redactPersonalData on hostile shapes (relecture n°1)", () => {
  const cases: [string, string][] = [
    ["IBAN followed by its BIC", "IBAN : FR76 3000 6000 0112 3456 7890 189 BIC AGRIFRPP"],
    ["IBAN in lowercase", "iban fr76 3000 6000 0112 3456 7890 189"],
    ["IBAN with a wrong checksum", "IBAN FR00 1234 5678 9012 3456 7890 123"],
    ["IBAN written in one piece", "virement sur CH9300762011623852957."],
    ["card followed by more digits", "Carte 4970 1012 3456 7893 12"],
    ["card with dots", "Carte 4970.1012.3456.7893"],
    ["card with a wrong checksum", "Carte 4970 1012 3456 7890"],
    ["Swiss phone", "Appelle-nous au 079 123 45 67 !"],
    ["UK phone", "Call 020 7946 0958 today"],
    ["US phone", "Questions? (212) 555-0199"],
    ["phone glued to its label", "Tél06 12 34 56 78"],
    ["phone after a label", "Mobile : 6 12 34 56 78"],
    ["encoded e-mail in a link", "https://maison-lune.example/a?email=camille.martin%40exemple.test&t=9f"],
    ["encoded e-mail in text", "camille.martin%40exemple.test"],
    ["street: passage", "12 passage des Lilas"],
    ["street: faubourg", "3 faubourg Saint-Antoine"],
    ["street: cité, villa, ruelle", "5 cité Riverin · 8 villa Médicis · 2 ruelle des Chats"],
    ["street: esplanade, promenade", "1 esplanade du Lac / 4 promenade des Anglais"],
    [
      "street: lotissement, voie, sentier, montée",
      "9 lotissement Les Pins, 3 voie Romaine, 7 sentier Vert, 1 montée du Gourguillon",
    ],
    ["city in lowercase", "69003 lyon"],
    ["city before the postcode", "Lyon 69003"],
  ];
  const secrets: Record<string, string[]> = {
    "IBAN followed by its BIC": ["3000 6000", "FR76"],
    "IBAN in lowercase": ["fr76", "3000 6000"],
    "IBAN with a wrong checksum": ["FR00", "1234 5678"],
    "IBAN written in one piece": ["CH9300762011623852957"],
    "card followed by more digits": ["4970", "7893"],
    "card with dots": ["4970.1012"],
    "card with a wrong checksum": ["4970 1012"],
    "Swiss phone": ["079 123", "45 67"],
    "UK phone": ["7946", "0958"],
    "US phone": ["555-0199", "(212)"],
    "phone glued to its label": ["06 12 34", "56 78"],
    "phone after a label": ["12 34 56 78"],
    "encoded e-mail in a link": ["camille", "%40", "9f"],
    "encoded e-mail in text": ["camille", "%40"],
    "street: passage": ["passage des Lilas"],
    "street: faubourg": ["Saint-Antoine"],
    "street: cité, villa, ruelle": ["Riverin", "Médicis", "Chats"],
    "street: esplanade, promenade": ["du Lac", "Anglais"],
    "street: lotissement, voie, sentier, montée": ["Les Pins", "Romaine", "Vert", "Gourguillon"],
    "city in lowercase": ["69003", "lyon"],
    "city before the postcode": ["69003", "Lyon"],
  };
  for (const [label, text] of cases) {
    it(`takes out the ${label}`, () => {
      const out = redactPersonalData(text);
      for (const secret of secrets[label] ?? []) expect(out, `${label}: ${out}`).not.toContain(secret);
    });
  }

  it("keeps a link's host only", () => {
    expect(redactPersonalData("Suivre : https://www.maison-lune.example/orders/abc?key=1")).toBe(
      "Suivre : [lien www.maison-lune.example]",
    );
  });

  it("still keeps order numbers, prices and compact tracking numbers", () => {
    const text = [
      "Commande 10421 confirmée",
      "Ta commande n° CMD-88213 passée le 9 novembre 2026",
      "Order #20931",
      "Total 1 299,00 € · 89.90 EUR · 10000 EUR",
      "Suivi : 6A12345678901 · CB123456785FR · 1Z999AA10123456784 · JJD000390007781234567",
      "Le 09/11/2026 à 14:32",
    ].join("\n");
    expect(redactPersonalData(text)).toBe(text);
  });
});

describe("redactPersonalData: Belgian and Swiss addresses, written-out e-mails (Task 8)", () => {
  const cases: [string, string, string[]][] = [
    [
      "Belgian street before its number, then postcode and city",
      "Rue de la Loi 16, 1000 Bruxelles",
      ["Loi", "1000", "Bruxelles"],
    ],
    [
      "Swiss street before its number, postcode on the next line",
      "Bahnhofstrasse 5\n8001 Zürich",
      ["Bahnhofstrasse", "8001", "Zürich"],
    ],
    ["Belgian postcode and city after its street", "Rue Haute 12\n4000 Liège", ["Haute", "4000", "Liège"]],
    ["Swiss city before its postcode, after its street", "Rue du Rhône 12\nGenève 1201", ["Rhône", "Genève", "1201"]],
    ["Swiss postcode with its country prefix", "CH-8001 Zürich", ["8001", "Zürich"]],
    ["Belgian postcode with its country prefix", "B-1000 Bruxelles", ["1000", "Bruxelles"]],
    ["Luxembourg postcode with its country prefix", "L-1234 Luxembourg", ["1234"]],
    ["Grand-Rue and its number", "Grand-Rue 12", ["Grand-Rue 12"]],
    ["German-style street word glued to its name", "Hauptstrasse 12", ["Hauptstrasse"]],
    ["English close", "4 Ashdown Close", ["Ashdown"]],
    ["English flat, street and postcode", "Flat 4, 12 Baker St, London NW1 6XE", ["Baker", "NW1"]],
    ["English close followed by its town", "12 Lilas Close, Leeds", ["Lilas", "Leeds"]],
    ["e-mail with &#64;", "écris à camille.martin&#64;exemple.test", ["camille", "exemple.test", "&#64;"]],
    ["e-mail with (at)", "camille.martin (at) exemple.test", ["camille", "exemple.test"]],
    ["e-mail with [at] and [dot]", "camille [at] exemple [dot] test", ["camille", "exemple"]],
    ["double-encoded e-mail", "?to=camille.martin%2540exemple.test", ["camille", "%2540", "exemple.test"]],
    ["e-mail with &#x40;", "camille&#x40;exemple.test", ["camille", "exemple.test"]],
  ];
  for (const [label, text, secrets] of cases) {
    it(`takes out the ${label}`, () => {
      const out = redactPersonalData(text);
      for (const secret of secrets) expect(out, `${label}: ${out}`).not.toContain(secret);
    });
  }

  it("still keeps 4-digit amounts, years, quantities and order lines", () => {
    const text = [
      "Commande 1042 confirmée",
      "Order #2093 du 9 novembre 2026",
      "Total 1299 EUR",
      "Robe Lina 2026 × 1",
      "Quantité 2 · Taille 38",
      "Livraison offerte dès 1000 €",
      "Collection Été 2026",
      "Commande passée via Shopify 2 articles",
      "Expédiée le 9 novembre 2026 à 14 h",
      // English order lines whose product name holds a street word (relecture n°1 of Task 8).
      "1 Petite Square Bag 45,00 €",
      "2 Classic Court Shoes",
      "Qty 2 Classic Court Shoes",
      "1 Oversized Row Jacket",
      "3 Summer Gardens Tee",
      "1 Leather Way Bag",
      "2 Robe Midi Close-Fit",
      "2 Robe Close",
      "1 Robe Place",
      // Four digits and a word that are no Belgian or Swiss town.
      "1234 Noir",
      "1250 points",
      "Gagnez 1250 points",
      "Points fidélité 1250 points",
      "Économisez 1000 points fidélité",
      "Chèque cadeau 1000 Merci",
      "Montant 2500 Livraison",
      "1500 Robes vendues",
      // Product names holding a French street word.
      "Robe Rue de Paris 38",
      "Top Avenue Montaigne 3",
      "Robe longue Place des Vosges 2",
      "Quai Ouest 2 coloris",
      "Rue de Paris 38 € la robe",
    ].join("\n");
    expect(redactPersonalData(text)).toBe(text);
  });
});
