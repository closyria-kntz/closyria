import { parisDay, salePeriodListSchema } from "@closyria/shared";
import { getTranslations } from "next-intl/server";
import { fetchAdminJson } from "@/lib/admin-api";
import { adminCallOrThrow, requireAdminPage } from "../../server";
import { SalePeriods } from "./sale-periods";

/**
 * « Soldes » (alerts spec §6): the sales periods the daily notice reads. A list that cannot be read throws to the
 * admin error page: the form is never offered on a list that failed to load.
 */
export default async function AdminSalesPage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.sales");
  const { periods } = await adminCallOrThrow("The sales periods", (api) =>
    fetchAdminJson(api, "/api/admin/sale-periods", salePeriodListSchema),
  );
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="max-w-prose text-ink-muted">{t("intro")}</p>
      <SalePeriods periods={periods} today={parisDay(new Date())} />
    </>
  );
}
