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

/** The facts Closyria knows of an article, never the shop's own text. `sizes`: the labels in stock, in order. */
export type CatalogueFacts = {
  category: FactRef | null;
  color: FactRef | null;
  material: FactRef | null;
  sizes: readonly string[];
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
const MAX_LISTED = 6;

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

function sizesPhrase(labels: readonly string[]): string | null {
  const given = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (given.length === 0) return null;
  if (given.every(isOneSize)) return "taille unique";
  const read = given.map(readSize);
  if (read.every((r) => r !== null)) {
    const kinds = new Set(read.map((r) => r.kind));
    const unique = [...new Map(read.map((r) => [r.text, r])).values()].sort((a, b) => a.rank - b.rank);
    if (unique.length === 1) return `taille ${(unique[0] as { text: string }).text}`;
    if (kinds.size === 1) {
      return `du ${(unique[0] as { text: string }).text} au ${(unique.at(-1) as { text: string }).text}`;
    }
  }
  if (given.length > MAX_LISTED) return `${given.length} tailles`;
  const shown = read.every((r) => r !== null) ? read.map((r) => r.text) : given;
  const list = [...new Set(shown)];
  if (list.length === 1) return `taille ${list[0]}`;
  return `tailles ${list.slice(0, -1).join(", ")} et ${list.at(-1)}`;
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
