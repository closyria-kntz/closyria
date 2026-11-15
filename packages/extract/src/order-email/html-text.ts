import { decodeEntities } from "../clean";

/** Named entities e-mails use beyond the basic ones `decodeEntities` knows. */
const MORE_ENTITIES: Record<string, string> = {
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  icirc: "î",
  ucirc: "û",
  ugrave: "ù",
  euml: "ë",
  iuml: "ï",
  Eacute: "É",
  euro: "€",
  pound: "£",
  times: "×",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  middot: "·",
};

const BLOCK =
  /<\/?(?:address|article|br|dd|del|div|dl|dt|h[1-6]|header|footer|hr|li|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi;

/** Non-empty lines, inner spaces squashed. */
export function cleanLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[\s ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * An HTML e-mail as lines of text: one line per block and per table cell, so a Shopify article row reads « Robe Lina
 * × 1 » / « M / Écru » / « 89,00 € ». Scripts, styles and comments go (structured data is read from the HTML itself);
 * links are kept as their text only and never followed.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(BLOCK, "\n")
    .replace(/<\/?[a-zA-Z!][^<>]*>/g, "")
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => MORE_ENTITIES[name] ?? match);
  return cleanLines(decodeEntities(text));
}
