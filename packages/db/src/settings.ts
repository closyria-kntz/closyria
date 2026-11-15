/** Settings the admin changes without a deploy (`app_settings`), read by the API (admin) and the AI (its cap). */
import { AI_MONTHLY_CAP_SETTING, aiMonthlyCapCentsSchema, DEFAULT_AI_MONTHLY_CAP_CENTS } from "@closyria/shared";
import { eq } from "drizzle-orm";
import type { Database } from "./index";
import * as schema from "./schema";

/** The AI's monthly cap in euro cents: the admin's setting, or 10 € without one (or with an unreadable one). */
export async function readAiMonthlyCapCents(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, AI_MONTHLY_CAP_SETTING));
  const parsed = aiMonthlyCapCentsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_AI_MONTHLY_CAP_CENTS;
}
