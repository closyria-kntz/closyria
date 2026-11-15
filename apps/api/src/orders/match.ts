import { type SQL, sql } from "@closyria/db";

/**
 * How an order line finds the article she already keeps (RF 3, « Après la commande »): conservative on purpose, a
 * wrong link would move one of her wishes to « Commandé » for nothing; a new article is the safe miss.
 */

/** An article name compared without case, accents, punctuation or spacing (« Robe « Léa » » → « robe lea »). */
export function normalizeArticleName(name: string): string {
  return name
    .replace(/[œŒ]/g, "oe")
    .replace(/[æÆ]/g, "ae")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The one article named like `lineName` (same normalised name); null when none, or when several are (no guess).
 */
export function pickSameArticle(
  lineName: string,
  items: readonly { id: string; name: string | null }[],
): string | null {
  const wanted = normalizeArticleName(lineName);
  if (!wanted) return null;
  const same = items.filter((item) => item.name !== null && normalizeArticleName(item.name) === wanted);
  return same.length === 1 ? (same[0]?.id ?? null) : null;
}

// A typed shop name is compared in SQL (no `unaccent` extension): lower case, these accents folded by `translate`,
// « œ »/« æ » spelled out, spaces collapsed. `foldShopName` does exactly the same on her side.
const ACCENTED = "àáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
const PLAIN = "aaaaaaceeeeiiiinooooouuuuyy";

export function foldShopName(name: string): string {
  let folded = name.toLowerCase().replaceAll("œ", "oe").replaceAll("æ", "ae");
  folded = [...folded].map((c) => PLAIN[ACCENTED.indexOf(c)] ?? c).join("");
  return folded.replace(/\s+/g, " ").trim();
}

/** `foldShopName` of a column, in SQL. */
export function foldShopNameSql(column: SQL | unknown): SQL {
  return sql`btrim(regexp_replace(translate(replace(replace(lower(${column}), 'œ', 'oe'), 'æ', 'ae'), ${ACCENTED}, ${PLAIN}), '\\s+', ' ', 'g'))`;
}
