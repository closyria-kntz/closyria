import type { ShopifySlowdown } from "@closyria/shared";
import { getFormatter, getTranslations } from "next-intl/server";

/**
 * « Shopify nous demande de ralentir : imports espacés jusqu’au {date} » (heure de Paris), on the dashboard and the
 * shop pages while a 429/430 from a Shopify shop keeps the imports spaced out. Nothing otherwise.
 */
export async function ShopifySlowdownAlert({ slowdown }: { slowdown: ShopifySlowdown | null }) {
  if (!slowdown) return null;
  const t = await getTranslations("Admin.common");
  const format = await getFormatter();
  const date = format.dateTime(new Date(slowdown.until), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
  return (
    <p
      role="status"
      data-testid="shopify-slowdown"
      className="rounded-card border border-danger-edge bg-danger-soft px-space-4 py-space-3 font-strong text-danger"
    >
      {t("shopifySlowdown", { date })}
    </p>
  );
}
