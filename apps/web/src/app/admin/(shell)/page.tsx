import { adminOverviewSchema } from "@closyria/shared";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminRead } from "../server";

/** Dashboard: aggregate figures only (spec D13), never a user's content. */
export default async function AdminDashboardPage() {
  const t = await getTranslations("Admin.dashboard");
  const format = await getFormatter();
  const overview = await adminRead("/api/admin/overview", adminOverviewSchema);
  if (!overview) throw new Error("The admin overview could not be read");

  const figures = [
    { label: t("usersTotal"), value: overview.users.total },
    { label: t("usersRegistered"), value: overview.users.registered },
    { label: t("usersAnonymous"), value: overview.users.anonymous },
    { label: t("signupsToday"), value: overview.signupsToday },
    { label: t("eventsToday"), value: overview.eventsToday },
  ];

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <dl className="grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-3">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex flex-col-reverse gap-space-1 rounded-card border border-card-border bg-card-bg p-space-4 shadow-soft"
          >
            <dt className="text-sm text-ink-muted">{figure.label}</dt>
            <dd className="font-display text-display font-strong tabular-nums">{format.number(figure.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">{t("todayNote")}</p>
    </>
  );
}
