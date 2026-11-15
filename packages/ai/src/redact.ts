/**
 * What is taken out of an e-mail before it reaches the AI (spec « Après la commande » §5): postal addresses, phone
 * numbers, card numbers and IBANs, e-mail addresses, and the forwarding header lines that name people (`To:`, `Cc:`).
 * Each is replaced by a marker so the model knows something was there. Conservative: a number that might be a card
 * (13 to 19 digits passing the Luhn check) or an IBAN (passing its mod-97 check) goes, a tracking number stays.
 */

const EMAIL = /(?<![\p{L}\p{N}._%+'-])[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** 13 to 19 digits, spaces or dashes between them (« 4970 1012 3456 7890 »). */
const CARD_CANDIDATE = /(?<![\dA-Z])\d(?:[ -]?\d){12,18}(?![\dA-Z])/g;
/** Two letters, two digits, then 8 to 30 letters or digits, by groups of four or not. */
const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){8,30}\b/g;
/** French numbers (« 06 12 34 56 78 », « +33 6 12 34 56 78 », « 0033612345678 »). */
const FRENCH_PHONE = /(?:(?:\+|00)33[ \t.-]*(?:\(0\)[ \t.-]*)?|(?<![\p{L}\p{N}])0)[1-9](?:[ \t.-]*\d{2}){4}(?!\d)/gu;
/** Other international numbers: « + », a country code, then 6 to 14 more digits with separators. */
const INTERNATIONAL_PHONE = /\+\d{1,3}(?:[ \t.-]*\(?\d+\)?){2,6}/g;
/** A line with a street (« 12 rue des Lilas », « 4bis, avenue Foch », « 221B Baker Street »). */
const STREET_LINE =
  /^.*\b\d{1,4}[ \t]*(?:bis|ter|[a-z])?[ \t]*,?[ \t]+(?:rue|avenue|av\.?|boulevard|bd|place|pl\.?|chemin|all[ée]e|impasse|quai|route|rte|cours|square|sq\.?|r[ée]sidence|lieu[- ]dit|hameau|street|st\.?|road|rd\.?|lane|ln\.?|drive|dr\.?|way|court|ct\.?)\b.*$/gim;
/** A line with a postcode and a city: French (« 69003 Lyon », never « #10421 » nor « 10000 EUR »), British (« SW1A 1AA »), American (« NY 10001 »). */
const POSTCODE_LINE =
  /^.*(?:(?<![#\p{L}\p{N}])\d{5}[ \t]+(?!(?:EUR|USD|GBP|CHF)\b)\p{Lu}[\p{L}' -]+|\b[A-Z]{1,2}\d[A-Z\d]?[ \t]*\d[A-Z]{2}\b|\b[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?\b|\bCEDEX\b|\bBP[ \t]*\d+).*$/gmu;
/** Headings of an address block: the lines after them, up to an empty line (at most 6), are an address. */
const ADDRESS_HEADING =
  /^\s*(?:adresse\s+de\s+(?:livraison|facturation)|adresse|livr[ée]e?\s+à|factur[ée]e?\s+à|point\s+relais|shipping\s+address|billing\s+address|delivery\s+address|ship\s+to|bill\s+to|deliver\s+to)\s*:?\s*$/i;
/** Forwarding header lines that name the people it was sent to. */
const RECIPIENT_HEADER = /^\s*(?:to|cc|bcc|à|a|cci)\s*:.*$/gim;

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
};

const ibanValid = (raw: string) => {
  const iban = raw.replace(/\s/g, "");
  if (iban.length < 15 || iban.length > 34) return false;
  const moved = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let rest = 0;
  for (const ch of moved) {
    const value = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
};

function dropAddressBlocks(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!ADDRESS_HEADING.test(lines[i] ?? "")) continue;
    for (let j = i + 1; j < lines.length && j <= i + 6 && (lines[j] ?? "").trim() !== ""; j++) {
      lines[j] = "[adresse]";
    }
  }
  return lines.join("\n");
}

/** Lines are cut to this length (at a space), so no pattern ever scans a huge line. */
const MAX_LINE = 1000;

/** Over-long lines cut at a space; a run of MAX_LINE characters without one is no text worth reading: dropped. */
function shortLines(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      const parts: string[] = [];
      let rest = line;
      while (rest.length > MAX_LINE) {
        const cut = rest.lastIndexOf(" ", MAX_LINE);
        if (cut <= 0) {
          parts.push("[…]");
          const next = rest.indexOf(" ", MAX_LINE);
          rest = next === -1 ? "" : rest.slice(next + 1);
        } else {
          parts.push(rest.slice(0, cut));
          rest = rest.slice(cut + 1);
        }
      }
      parts.push(rest);
      return parts;
    })
    .join("\n");
}

export function redactPersonalData(text: string): string {
  let out = shortLines(text.replace(/\r\n?/g, "\n"));
  out = out.replace(RECIPIENT_HEADER, "[destinataire]");
  out = out.replace(EMAIL, "[e-mail]");
  out = out.replace(IBAN_CANDIDATE, (m) => (ibanValid(m) ? "[IBAN]" : m));
  out = out.replace(CARD_CANDIDATE, (m) => (luhn(m.replace(/\D/g, "")) ? "[carte]" : m));
  out = out.replace(FRENCH_PHONE, "[téléphone]");
  out = out.replace(INTERNATIONAL_PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[téléphone]" : m));
  out = dropAddressBlocks(out);
  out = out.replace(STREET_LINE, "[adresse]");
  out = out.replace(POSTCODE_LINE, "[adresse]");
  return out;
}
