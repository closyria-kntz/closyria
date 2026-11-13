import { adminOverviewSchema } from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminRead, requireAdminPage } from "../server";
import { ShopifySlowdownAlert } from "./shopify-slowdown";

/** Dashboard: aggregate figures only (spec D13), never a user's content. */
export default async function AdminDashboardPage() {
  await requireAdminPage();
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

  const { captures, shops } = overview;
  const percent = (value: number | null) => (value === null ? t("none") : format.number(value, { style: "percent" }));
  const methods = (["shopify", "jsonld", "opengraph"] as const)
    .map((method) => `${t(`methods.${method}`)} ${format.number(captures.byMethod[method])}`)
    .join(" · ");
  const captureFigures = [
    { label: t("captures24h"), value: format.number(captures.last24h) },
    { label: t("captures7d"), value: format.number(captures.last7d) },
    { label: t("successRate"), value: percent(captures.successRate7d) },
    {
      label: t("medianDuration"),
      value:
        captures.medianDurationMs === null
          ? t("none")
          : t("durationMs", { ms: format.number(captures.medianDurationMs) }),
    },
    { label: t("shopsPending"), value: format.number(shops.pending), href: "/admin/boutiques?status=pending" },
    { label: t("shopsDown"), value: format.number(shops.down), href: "/admin/boutiques?health=down" },
  ];

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <ShopifySlowdownAlert slowdown={overview.shopifySlowdown} />
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
      <h2 className="font-display text-lead font-strong">{t("capturesTitle")}</h2>
      <dl className="grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-3">
        {captureFigures.map((figure) => (
          <div
            key={figure.label}
            className="flex flex-col-reverse gap-space-1 rounded-card border border-card-border bg-card-bg p-space-4 shadow-soft"
          >
            <dt className="text-sm text-ink-muted">
              {figure.href ? (
                <Link href={figure.href} className="underline">
                  {figure.label}
                </Link>
              ) : (
                figure.label
              )}
            </dt>
            <dd className="font-display text-display font-strong tabular-nums">{figure.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">
        {t("byMethod")} : {methods}
      </p>
    </>
  );
}
