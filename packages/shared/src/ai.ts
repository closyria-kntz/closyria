import { z } from "zod";
import { parisDay } from "./alerts";

/**
 * The AI that reads an order e-mail no known format could (`packages/ai`, spec « Après la commande » §5 « Coûts »):
 * a monthly cap set in the admin, 10 € by default; past it, nothing is sent to the model (manual entry).
 */

/** `app_settings` key of the monthly cap, in euro cents. */
export const AI_MONTHLY_CAP_SETTING = "ai_monthly_cap_cents";
export const DEFAULT_AI_MONTHLY_CAP_CENTS = 1000;
/** Highest cap the admin may set (1 000 €), a guard against a typo. */
export const MAX_AI_MONTHLY_CAP_CENTS = 100_000;
export const aiMonthlyCapCentsSchema = z.number().int().min(0).max(MAX_AI_MONTHLY_CAP_CENTS);

/** The month a cost counts in: `YYYY-MM`, Paris time (the cap starts again on the 1st at midnight in Paris). */
export const aiMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * The cap is in euros, the bill in dollars: a dollar is counted as a euro. The dollar is worth less than the euro, so
 * this over-counts (the cap is reached a little early, never late).
 */
export const NANO_USD_PER_EURO_CENT = 10_000_000;

/** The month a call counts in, `YYYY-MM` in Paris. */
export const aiMonth = (now: Date) => parisDay(now).slice(0, 7);

/** `PUT /api/admin/settings/ai-cap`: the monthly cap, in euro cents (0 turns the AI off). */
export const adminAiCapInputSchema = z.object({ capCents: aiMonthlyCapCentsSchema });
export type AdminAiCapInput = z.infer<typeof adminAiCapInputSchema>;
