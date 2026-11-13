import { adminReportListSchema } from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { fetchAdminJson } from "@/lib/admin-api";
import { adminCallOrThrow, requireAdminPage } from "../../../server";
import { ReportActions } from "./report-actions";

/** « Signalements »: the open reports, one line per article (reasons, count, latest date), never who reported. */
export default async function AdminReportsPage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.reports");
  const format = await getFormatter();
  const { reports } = await adminCallOrThrow("The report list", (api) =>
    fetchAdminJson(api, "/api/admin/catalogue/reports", adminReportListSchema),
  );

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <p>
        <Link href="/admin/fiches?catalogue=hidden" className="underline">
          {t("showHidden")}
        </Link>
      </p>
      {reports.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-space-3">
          {reports.map((report) => (
            <li
              key={report.productId}
              className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4 sm:flex-row"
            >
              <div className="aspect-3/4 w-space-8 shrink-0 overflow-hidden rounded-card bg-media-backdrop">
                {report.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images.
                  <img src={report.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                ) : (
                  <span className="sr-only">{t("noPhoto")}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-space-2">
                <h2 className="font-strong break-words">
                  <Link href={`/admin/fiches/${report.productId}`} className="underline">
                    {report.name ?? t("unnamed")}
                  </Link>
                </h2>
                <p className="text-sm text-ink-muted">{report.shopName}</p>
                <p className="text-sm">
                  <span className="font-strong">{t("count", { count: report.count })}</span>
                  {" · "}
                  {report.reasons
                    .map((r) => t("reasonLine", { reason: t(`reasons.${r.reason}`), count: r.count }))
                    .join(", ")}
                </p>
                <p className="text-sm text-ink-muted">
                  <time dateTime={report.latestAt}>
                    {t("latest", {
                      date: format.dateTime(new Date(report.latestAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "UTC",
                      }),
                    })}
                  </time>
                </p>
                <ReportActions productId={report.productId} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
