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

  it("keeps a digits-only number that is not a valid card (a DPD-like parcel number)", () => {
    expect(redactPersonalData("Colis 0123456789012345")).toBe("Colis 0123456789012345");
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
