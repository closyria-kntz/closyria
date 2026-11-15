/**
 * What is taken out of an e-mail before it reaches the AI (spec « Après la commande » §5): postal addresses, phone
 * numbers, card numbers and IBANs, e-mail addresses, the forwarding header lines that name people (`To:`, `Cc:`), and
 * links (only their host stays: their paths and queries carry tokens and e-mail addresses). Each is replaced by a
 * marker so the model knows something was there.
 *
 * It errs toward taking out: anything shaped like a card (13 digits or more) or an IBAN goes whatever its checksum,
 * any run of 9 digits or more written with separators goes as a phone number. A tracking number written in one piece
 * (« 6A12345678901 », « CB123456785FR ») stays; one written with spaces may go, which costs little: the AI only reads
 * e-mails no known format could, and a parcel can be added by hand.
 */

/** A web link: replaced by its host. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'()[\]]+/giu;
/**
 * E-mail addresses written so that a robot misses them, turned back into plain ones first: HTML entities (« &#64; »,
 * « &#x40; », « &commat; »), percent-encoding nested any number of times (« %2540 »), « (at) » / « [at] » / « {at} »
 * and the same for « dot ».
 */
const WRITTEN_AT = /&#0*64;|&#x0*40;|&commat;|%(?:25)*40|[ \t]*[([{][ \t]*at[ \t]*[)\]}][ \t]*/giu;
const WRITTEN_DOT = /[ \t]*[([{][ \t]*dot[ \t]*[)\]}][ \t]*/giu;
const EMAIL = /(?<![\p{L}\p{N}._%+'-])[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** 13 digits or more, spaces, dots or dashes between them (« 4970 1012 3456 7890 », « 4970.1012… »): a card. */
const CARD_SHAPE = /(?<![\p{L}\p{N}])\d(?:[ .-]?\d){12,}(?![\p{L}\p{N}])/gu;
/**
 * IBAN shapes, any case: two letters, two digits, then groups of four (« FR76 3000 6000 0112 … 189 ») or 11 to 30
 * letters and digits in one piece (« CH9300762011623852957 »).
 */
const IBAN_SHAPE =
  /(?<![\p{L}\p{N}])[a-z]{2}\d{2}(?:(?:[ .-]?[a-z0-9]{4}){2,7}(?:[ .-]?[a-z0-9]{1,4})?|[a-z0-9]{11,30})(?![\p{L}\p{N}])/giu;
/** A number after a phone label, even glued to it (« Tél06 12 34 56 78 », « Mobile : 6 12 34 56 78 »). */
const LABELLED_PHONE =
  /(?<=(?<![\p{L}])(?:t[ée]l[ée]?(?:phone)?|tel|phone|mobile|portable|gsm|fax|whatsapp)\.?[ \t]*:?[ \t]*)[+(]?\d[\d \t().-]{6,}\d/giu;
/** French numbers (« 06 12 34 56 78 », « +33 6 12 34 56 78 », « 0033612345678 »). */
const FRENCH_PHONE = /(?:(?:\+|00)33[ \t.-]*(?:\(0\)[ \t.-]*)?|(?<![\p{L}\p{N}])0)[1-9](?:[ \t.-]*\d{2}){4}(?!\d)/gu;
/** Other international numbers: « + », a country code, then 6 to 14 more digits with separators. */
const INTERNATIONAL_PHONE = /\+\d{1,3}(?:[ \t.-]*\(?\d+\)?){2,6}/g;
/**
 * National numbers of any country (« 079 123 45 67 », « 020 7946 0958 », « (212) 555-0199 »): 9 digits or more with at
 * least two separators. Dates (« 09/11/2026 », « 14:32 ») and prices (« 1 299,00 ») have fewer digits or other marks.
 */
const SEPARATED_DIGITS = /(?<![\p{L}\p{N}])\(?\d[\d().-]*(?:[ \t]+\(?[\d().-]+)*\d(?![\p{L}\p{N}])/gu;
/** Street words (« 12 rue des Lilas », « 4bis, avenue Foch », « 3 faubourg Saint-Antoine », « 221B Baker Street »). */
const STREET_WORDS = [
  "rue",
  "avenue",
  "av\\.?",
  "boulevard",
  "bd",
  "place",
  "pl\\.?",
  "chemin",
  "all[ée]e",
  "impasse",
  "quai",
  "route",
  "rte",
  "cours",
  "square",
  "sq\\.?",
  "r[ée]sidence",
  "lieu[- ]dit",
  "hameau",
  "passage",
  "faubourg",
  "fbg",
  "cit[ée]",
  "villa",
  "ruelle",
  "venelle",
  "esplanade",
  "promenade",
  "lotissement",
  "voie",
  "sentier",
  "mont[ée]e",
  "parvis",
  "rond[- ]point",
  "traverse",
  "clos",
  "street",
  "st\\.?",
  "road",
  "rd\\.?",
  "lane",
  "ln\\.?",
  "drive",
  "dr\\.?",
  "way",
  "court",
  "ct\\.?",
].join("|");
const STREET_LINE = new RegExp(
  `^.*(?<![\\p{L}\\p{N}])\\d{1,4}[ \\t]*(?:bis|ter|[a-z])?[ \\t]*,?[ \\t]+(?:${STREET_WORDS})(?![\\p{L}\\p{N}]).*$`,
  "gimu",
);
/**
 * The street-first, English and 4-digit postcode shapes below are written by shops in product names too (« Robe Rue
 * de Paris 38 », « 1 Petite Square Bag », « 1234 Noir »). So they only take a line that is nothing but an address
 * line: the street at the start, its number (or kind of street) ending it or followed by a comma; and never a line
 * with a price on it.
 */
const PRICE = /\d[\d .,]*[ \t]*(?:€|EUR|£|GBP|\$|USD|CHF)(?![\p{L}])|(?:€|£|\$)[ \t]*\d/iu;
/** What may follow an address part on its line: nothing, or a comma and the rest of the address. */
const ADDRESS_END = "[ \\t]*(?:,.*)?$";
/**
 * Street first, number after (Belgium, Switzerland, Luxembourg: « Rue de la Loi 16, 1000 Bruxelles », « Chaussée de
 * Wavre 12 », « Grand-Rue 12 »): a street word starting the line, its name, the number ending it (or a comma).
 */
const STREET_FIRST_WORDS =
  "rue|avenue|boulevard|chemin|place|route|quai|all[ée]e|impasse|square|passage|chauss[ée]e|dr[èe]ve|rempart|ruelle|sentier";
const STREET_FIRST_LINE = new RegExp(
  `^[ \\t]*(?:grande?-rue|(?:${STREET_FIRST_WORDS})[ \\t]+\\p{L}[\\p{L}' .-]*?)[ \\t]+\\d{1,4}[ \\t]*(?:bis|ter|[a-z])?${ADDRESS_END}`,
  "gimu",
);
/** German and Dutch street names, the kind of street glued to the name (« Bahnhofstrasse 5 », « Kerkstraat 12 »). */
const COMPOUND_STREET_LINE = new RegExp(
  `^[ \\t]*\\p{L}[\\p{L}-]*(?:strasse|straße|str\\.|gasse|weg|platz|allee|ring|straat|laan|steenweg|dreef|plein|gracht|kade)[ \\t]+\\d{1,4}[ \\t]*[a-z]?${ADDRESS_END}`,
  "gimu",
);
const capitalised = (words: string[]) => words.flatMap((word) => [word, word.toLowerCase()]).join("|");
/** English addresses, the kind of street last (« 4 Ashdown Close », « 12 Baker St, London »). */
const ENGLISH_STREET_TYPES = capitalised([
  "Street",
  "St",
  "Road",
  "Rd",
  "Avenue",
  "Ave",
  "Lane",
  "Drive",
  "Close",
  "Way",
  "Court",
  "Place",
  "Crescent",
  "Terrace",
  "Gardens",
  "Grove",
  "Mews",
  "Row",
  "Square",
  "Boulevard",
]);
/** Words of an article's name, never of a street (« 2 Robe Close », « 1 Robe Place »). */
const GARMENT_WORDS = capitalised([
  "Robe",
  "Dress",
  "Top",
  "Bag",
  "Shoes",
  "Jacket",
  "Coat",
  "Tee",
  "Shirt",
  "Skirt",
  "Jeans",
  "Jean",
  "Trousers",
  "Pants",
  "Boots",
  "Scarf",
  "Hat",
  "Sweater",
  "Jumper",
  "Cardigan",
  "Blouse",
  "Jupe",
  "Pull",
  "Sac",
  "Veste",
  "Manteau",
  "Chemise",
  "Pantalon",
  "Short",
  "Shorts",
  "Sandales",
  "Sneakers",
  "Belt",
  "Ceinture",
  "Collier",
  "Necklace",
  "Bague",
]);
/** An address line: « Flat 4, » perhaps, the house number, one to three capitalised words, the kind of street. */
const ENGLISH_STREET_LINE = new RegExp(
  `^[ \\t]*(?:(?:Flat|Apt\\.?|Apartment|Unit|Suite)[ \\t]*\\d+[A-Za-z]?,?[ \\t]*)?\\d{1,4}[A-Za-z]?,?[ \\t]+(?:(?!(?:${GARMENT_WORDS})(?![\\p{L}]))\\p{Lu}[\\p{L}'-]*[ \\t]+){1,3}(?:${ENGLISH_STREET_TYPES})\\.?${ADDRESS_END}`,
  "gmu",
);
/** Words a 5-digit number follows when it is no postcode (« Commande 10421 », « Total 10000 »). */
const NOT_A_CITY =
  "commande|order|n°|no\\.?|#|r[ée]f(?:[ée]rence)?|ref|facture|invoice|total|colis|suivi|num[ée]ro|number|article|code|qt[ée]";
/** A line with a French postcode and its city, either order, any case (« 69003 Lyon », « 69003 lyon », « Lyon 69003 »). */
const POSTCODE_CITY_LINE = new RegExp(
  [
    `^.*(?<!(?:${NOT_A_CITY})[ \\t]*:?[ \\t]*)(?<![#/_.\\p{L}\\p{N}-])\\d{5}[ \\t]+(?!(?:EUR|USD|GBP|CHF)(?![\\p{L}]))\\p{L}[\\p{L}' -]+.*$`,
    `^.*(?<![\\p{L}])(?!(?:${NOT_A_CITY})(?![\\p{L}]))\\p{L}[\\p{L}'-]+[ \\t]+\\d{5}(?![\\p{L}\\p{N}]).*$`,
  ].join("|"),
  "gimu",
);
/** A town's name: one to four capitalised words (« Bruxelles », « La Chaux-de-Fonds »), nothing after it. */
const TOWN = "\\p{Lu}[\\p{L}'.-]*(?:[ \\t]+[\\p{L}'.-]+){0,3}";
/**
 * A Belgian, Swiss, Luxembourgish or Austrian postcode written with its country (« CH-8001 Zürich », « B-1000
 * Bruxelles », « L-1234 Luxembourg »), then the town ending the line (or a comma and the country).
 */
const PREFIXED_POSTCODE4_LINE = new RegExp(`^[ \\t]*(?:CH|B|L|A)-\\d{4}[ \\t]+${TOWN}${ADDRESS_END}`, "gmu");
/**
 * A bare 4-digit postcode and its town (« 8001 Zürich », « Genève 1201 »): only on the line right after an address
 * line already taken out — alone, « 1234 Noir » or « 1500 Robes vendues » look just the same.
 */
const POSTCODE4_TOWN = new RegExp(`^[ \\t]*(?:\\d{4}[ \\t]+${TOWN}|${TOWN}[ \\t]+\\d{4})${ADDRESS_END}`, "u");

/** Address lines with no price on them become `[adresse]`. */
const dropAddressLines = (text: string, pattern: RegExp) =>
  text.replace(pattern, (line) => (PRICE.test(line) ? line : "[adresse]"));

/** The postcode-and-town line that follows an address line taken out. */
function dropTownAfterAddress(text: string): string {
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (lines[i - 1] === "[adresse]" && POSTCODE4_TOWN.test(line) && !PRICE.test(line)) lines[i] = "[adresse]";
  }
  return lines.join("\n");
}

/** A line with a British (« SW1A 1AA ») or American (« NY 10001 ») postcode, CEDEX or a post-office box. */
const POSTCODE_LINE =
  /^.*(?:\b[A-Z]{1,2}\d[A-Z\d]?[ \t]*\d[A-Z]{2}\b|\b[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?\b|\bCEDEX\b|\bBP[ \t]*\d+).*$/gmu;
/** Headings of an address block: the lines after them, up to an empty line (at most 6), are an address. */
const ADDRESS_HEADING =
  /^\s*(?:adresse\s+de\s+(?:livraison|facturation)|adresse|livr[ée]e?\s+à|factur[ée]e?\s+à|point\s+relais|shipping\s+address|billing\s+address|delivery\s+address|ship\s+to|bill\s+to|deliver\s+to)\s*:?\s*$/i;
/** Forwarding header lines that name the people it was sent to. */
const RECIPIENT_HEADER = /^\s*(?:to|cc|bcc|à|a|cci)\s*:.*$/gim;

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

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** A run of digits with separators is a phone number when it has 9 digits or more and two separators at least. */
const phoneShaped = (run: string) => run.replace(/\D/g, "").length >= 9 && (run.match(/[^\d]+/g) ?? []).length >= 2;

export function redactPersonalData(text: string): string {
  let out = shortLines(text.replace(/\r\n?/g, "\n"));
  out = out.replace(URL_PATTERN, (url) => {
    const host = hostOf(url);
    return host ? `[lien ${host}]` : "[lien]";
  });
  out = out.replace(WRITTEN_AT, "@").replace(WRITTEN_DOT, ".");
  out = out.replace(RECIPIENT_HEADER, "[destinataire]");
  out = out.replace(EMAIL, "[e-mail]");
  out = out.replace(IBAN_SHAPE, (m) => (m.replace(/[^a-z0-9]/gi, "").length >= 15 ? "[IBAN]" : m));
  out = out.replace(CARD_SHAPE, "[carte]");
  out = out.replace(LABELLED_PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[téléphone]" : m));
  out = out.replace(FRENCH_PHONE, "[téléphone]");
  out = out.replace(INTERNATIONAL_PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[téléphone]" : m));
  out = out.replace(SEPARATED_DIGITS, (m) => (phoneShaped(m) ? "[téléphone]" : m));
  out = dropAddressBlocks(out);
  out = out.replace(STREET_LINE, "[adresse]");
  out = dropAddressLines(out, STREET_FIRST_LINE);
  out = dropAddressLines(out, COMPOUND_STREET_LINE);
  out = dropAddressLines(out, ENGLISH_STREET_LINE);
  out = out.replace(POSTCODE_CITY_LINE, "[adresse]");
  out = dropAddressLines(out, PREFIXED_POSTCODE4_LINE);
  out = out.replace(POSTCODE_LINE, "[adresse]");
  out = dropTownAfterAddress(out);
  return out;
}
