import { adminAuditPageSchema } from "@closyria/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminRead } from "../../server";
import { buttonClass } from "../../ui";

type Props = { searchParams: Promise<{ cursor?: string | string[] }> };

/** The admin audit log, newest first, 50 entries per page (keyset pagination of the API). */
export default async function AdminAuditPage({ searchParams }: Props) {
  const { cursor } = await searchParams;
  const current = typeof cursor === "string" ? cursor : undefined;
  const t = await getTranslations("Admin.audit");
  const format = await getFormatter();
  const page = await adminRead(
    `/api/admin/audit${current ? `?cursor=${encodeURIComponent(current)}` : ""}`,
    adminAuditPageSchema,
  );
  // A stale or hand-edited cursor: back to the first page.
  if (!page) redirect("/admin/audit");

  const cell = "px-space-3 py-space-2 text-left align-top";
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      {page.entries.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                <th scope="col" className={cell}>
                  {t("date")}
                </th>
                <th scope="col" className={cell}>
                  {t("admin")}
                </th>
                <th scope="col" className={cell}>
                  {t("action")}
                </th>
                <th scope="col" className={cell}>
                  {t("target")}
                </th>
                <th scope="col" className={cell}>
                  {t("status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {page.entries.map((entry) => (
                <tr key={entry.id} className="border-t border-outline">
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    <time dateTime={entry.createdAt}>
                      {format.dateTime(new Date(entry.createdAt), {
                        dateStyle: "short",
                        timeStyle: "medium",
                        timeZone: "UTC",
                      })}
                    </time>
                  </td>
                  <td className={cell}>{entry.adminEmail ?? t("deletedAdmin")}</td>
                  <td className={`${cell} font-strong`}>{entry.action}</td>
                  <td className={cell}>{entry.target ?? t("none")}</td>
                  <td className={`${cell} tabular-nums`}>{entry.details.status ?? t("none")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current || page.nextCursor ? (
        <nav aria-label={t("pagination")} className="flex flex-wrap gap-space-2">
          {current ? (
            <Link href="/admin/audit" className={buttonClass}>
              {t("first")}
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link href={`/admin/audit?cursor=${encodeURIComponent(page.nextCursor)}`} className={buttonClass}>
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
