/** `Intl.NumberFormat` currency formatting from cents. */
export function formatPrice(locale: string, cents: number, currency: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** "29,99" or "29.99" (spaces and a € sign tolerated) to cents; an empty field means no price. */
export function parsePriceCents(input: string): { ok: true; cents: number | undefined } | { ok: false } {
  const text = input.replace(/[\s€]/g, "");
  if (text === "") return { ok: true, cents: undefined };
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text);
  if (!match) return { ok: false };
  const euros = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) ? { ok: true, cents: total } : { ok: false };
}

/** Comma-separated text to trimmed, non-empty size labels. */
export function parseSizes(input: string): string[] {
  return input
    .split(",")
    .map((label) => label.trim())
    .filter((label) => label !== "");
}
