import { isOneSize, sizeTokens } from "./catalogue";

// Catalogue conforme au droit (docs/specs/2026-11-14-catalogue-conforme.md): what « Découvrir » shows of an article
// whose shop gave no listing agreement — a Closyria illustration instead of the shop's photos, and a sentence made of
// facts only instead of the shop's text.

// --- The factual sentence. ---

type Noun = { word: string; feminine: boolean; plural: boolean };
const noun = (word: string, feminine = false, plural = false): Noun => ({ word, feminine, plural });

/** How the sentence names an article of each reference category (singular unless the shops sell it as a pair). */
const NOUN_BY_SLUG: Readonly<Record<string, Noun>> = {
  vetements: noun("Vêtement"),
  robes: noun("Robe", true),
  "robe-courte": noun("Robe courte", true),
  "robe-longue": noun("Robe longue", true),
  hauts: noun("Haut"),
  "t-shirts": noun("T-shirt"),
  "chemises-blouses": noun("Chemise ou blouse", true),
  "pulls-gilets": noun("Pull ou gilet"),
  bas: noun("Bas"),
  pantalons: noun("Pantalon"),
  jeans: noun("Jean"),
  jupes: noun("Jupe", true),
  shorts: noun("Short"),
  "vestes-manteaux": noun("Veste ou manteau"),
  combinaisons: noun("Combinaison", true),
  "maillots-de-bain": noun("Maillot de bain"),
  "lingerie-nuit": noun("Lingerie", true),
  chaussures: noun("Chaussures", true, true),
  baskets: noun("Baskets", true, true),
  "bottines-bottes": noun("Bottines ou bottes", true, true),
  escarpins: noun("Escarpins", false, true),
  sandales: noun("Sandales", true, true),
  ballerines: noun("Ballerines", true, true),
  sacs: noun("Sac"),
  accessoires: noun("Accessoire"),
  bijoux: noun("Bijou"),
  ceintures: noun("Ceinture", true),
  "echarpes-foulards": noun("Écharpe ou foulard"),
  "chapeaux-bonnets": noun("Chapeau ou bonnet"),
};
const ARTICLE = noun("Article");

/** Colour adjectives by slug: [masculine, feminine, masculine plural, feminine plural]. Others are invariable. */
const COLOR_FORMS: Readonly<Record<string, readonly [string, string, string, string]>> = {
  noir: ["noir", "noire", "noirs", "noires"],
  blanc: ["blanc", "blanche", "blancs", "blanches"],
  ecru: ["écru", "écrue", "écrus", "écrues"],
  gris: ["gris", "grise", "gris", "grises"],
  beige: ["beige", "beige", "beiges", "beiges"],
  rouge: ["rouge", "rouge", "rouges", "rouges"],
  rose: ["rose", "rose", "roses", "roses"],
  jaune: ["jaune", "jaune", "jaunes", "jaunes"],
  vert: ["vert", "verte", "verts", "vertes"],
  bleu: ["bleu", "bleue", "bleus", "bleues"],
  violet: ["violet", "violette", "violets", "violettes"],
};

/** A reference entry: its slug and name; a category also gives its ancestors' slugs, nearest first. */
export type FactRef = { slug: string; name: string; parents?: readonly string[] };

/** A size of the article as the shop lists it, in stock or sold out (a sold-out size breaks a range). */
export type FactSize = { label: string; available: boolean };

/** The facts Closyria knows of an article, never the shop's own text. `sizes`: all its sizes, in the shop's order. */
export type CatalogueFacts = {
  category: FactRef | null;
  color: FactRef | null;
  material: FactRef | null;
  sizes: readonly FactSize[];
};

function nounOf(category: FactRef | null): Noun {
  if (!category) return ARTICLE;
  for (const slug of [category.slug, ...(category.parents ?? [])]) {
    const found = NOUN_BY_SLUG[slug];
    if (found) return found;
  }
  return ARTICLE;
}

function colorOf(color: FactRef, of: Noun): string {
  const forms = COLOR_FORMS[color.slug];
  if (!forms) return color.name.toLocaleLowerCase("fr");
  return forms[(of.plural ? 2 : 0) + (of.feminine ? 1 : 0)] as string;
}

const LETTER_ORDER = ["xxs", "xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl"];
const LETTER_LABEL: Record<string, string> = { "2xl": "XXL" };
/** Sizes listed one by one at most (beyond, their number). */
const MAX_LISTED = 4;

/** One readable size of a label: a number (36, 38.5) or a letter size; null when no rule reads it alone. */
function readSize(label: string): { kind: "number" | "letter"; rank: number; text: string } | null {
  const tokens = sizeTokens(label);
  const numbers = tokens.filter((t) => /^\d{1,3}(\.5)?$/.test(t));
  const letters = tokens.filter((t) => LETTER_ORDER.includes(t));
  if (numbers.length === 1 && letters.length === 0) {
    const n = numbers[0] as string;
    return { kind: "number", rank: Number(n), text: n.replace(".", ",") };
  }
  if (letters.length === 1 && numbers.length === 0) {
    const l = letters[0] as string;
    return { kind: "letter", rank: LETTER_ORDER.indexOf(l), text: LETTER_LABEL[l] ?? l.toUpperCase() };
  }
  return null;
}

/** « taille 38 », « tailles 36, 40 et 42 ». */
const listed = (texts: readonly string[]) =>
  texts.length === 1 ? `taille ${texts[0]}` : `tailles ${texts.slice(0, -1).join(", ")} et ${texts.at(-1)}`;

type ReadSize = NonNullable<ReturnType<typeof readSize>>;

/**
 * Whether the sizes in stock (sorted, one kind) follow each other: letters one step apart, numbers at most 2 apart
 * (36, 38, 40 or 37, 37,5, 38), and no sold-out size of the article between the first and the last.
 */
function contiguous(inStock: readonly ReadSize[], soldOut: readonly ReadSize[]): boolean {
  const first = inStock[0];
  const last = inStock.at(-1);
  if (!first || !last) return false;
  const stepOk = inStock.every((size, i) => {
    const previous = inStock[i - 1];
    if (!previous) return true;
    const step = size.rank - previous.rank;
    return size.kind === "letter" ? step === 1 : step <= 2;
  });
  const holes = soldOut.some((s) => s.kind === first.kind && s.rank > first.rank && s.rank < last.rank);
  return stepOk && !holes;
}

/**
 * The sizes in stock: « taille unique », « taille 38 », a range when they follow each other (« du 36 au 42 »), else
 * the sizes themselves up to 4 (« tailles 36, 40 et 42 »), else their number (« 6 tailles »).
 */
function sizesPhrase(sizes: readonly FactSize[]): string | null {
  const given = [...new Set(sizes.filter((s) => s.available).map((s) => s.label.trim()))].filter(Boolean);
  if (given.length === 0) return null;
  if (given.every(isOneSize)) return "taille unique";
  const read = given.map(readSize);
  if (read.every((r) => r !== null) && new Set(read.map((r) => r.kind)).size === 1) {
    const unique = [...new Map(read.map((r) => [r.text, r])).values()].sort((a, b) => a.rank - b.rank);
    const soldOut = sizes
      .filter((s) => !s.available)
      .map((s) => readSize(s.label))
      .filter((r): r is ReadSize => r !== null);
    if (unique.length === 1) return listed([(unique[0] as ReadSize).text]);
    if (contiguous(unique, soldOut)) {
      return `du ${(unique[0] as ReadSize).text} au ${(unique.at(-1) as ReadSize).text}`;
    }
    return unique.length <= MAX_LISTED ? listed(unique.map((r) => r.text)) : `${unique.length} tailles`;
  }
  // Letters and numbers mixed, or labels no rule reads: as given (in the shop's order), never invented.
  const texts = [...new Set(read.every((r) => r !== null) ? read.map((r) => r.text) : given)];
  return texts.length <= MAX_LISTED ? listed(texts) : `${texts.length} tailles`;
}

/**
 * « Robe longue rouge en lin, du 36 au 42. »: one sentence made only of facts (category, colour, material, sizes in
 * stock), never a word of the shop's description. Null when no fact is known.
 */
export function factualDescription(facts: CatalogueFacts): string | null {
  const sizes = sizesPhrase(facts.sizes);
  if (!facts.category && !facts.color && !facts.material && !sizes) return null;
  const of = nounOf(facts.category);
  let text = of.word;
  if (facts.color) text += ` ${colorOf(facts.color, of)}`;
  if (facts.material) text += ` en ${facts.material.name.toLocaleLowerCase("fr")}`;
  if (sizes) text += `, ${sizes}`;
  return `${text}.`;
}
