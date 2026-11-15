import { z } from "zod";

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
