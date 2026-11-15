import { aiMonthlyCapCentsSchema } from "@closyria/shared";

/**
 * The AI's monthly cap typed in euros (« 10 », « 12,50 », « 0.99 ») in euro cents; null when it is not a number of
 * euros with at most 2 decimals from 0 to 1 000 €.
 */
export function parseEuroCap(input: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  const parsed = aiMonthlyCapCentsSchema.safeParse(cents);
  return parsed.success ? parsed.data : null;
}

/** Cents as the cap field shows them: whole euros bare, otherwise 2 decimals after a comma. */
export function capInputOf(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(euros) : `${euros},${String(rest).padStart(2, "0")}`;
}
