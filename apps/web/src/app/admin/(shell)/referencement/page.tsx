import { adminListingRequestListSchema, type ListingRequestStatus, listingRequestStatusSchema } from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { fetchAdminJson } from "@/lib/admin-api";
import { adminCallOrThrow, requireAdminPage } from "../../server";
import { sheetLinkClass } from "../../ui";
import { RequestActions } from "./request-actions";

type Props = { searchParams: Promise<{ statut?: string }> };

/** « Demandes de référencement »: the requests of « Référencer ma boutique », pending first; accept or refuse. */
export default async function AdminListingRequestsPage({ searchParams }: Props) {
  await requireAdminPage();
  const t = await getTranslations("Admin.listingRequests");
  const format = await getFormatter();
  const status: ListingRequestStatus =
    listingRequestStatusSchema.safeParse((await searchParams).statut).data ?? "pending";
  const { requests } = await adminCallOrThrow("The listing requests", (api) =>
    fetchAdminJson(api, `/api/admin/listing-requests?status=${status}`, adminListingRequestListSchema),
  );
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="max-w-measure text-ink-muted">{t("intro")}</p>
      <nav aria-label={t("tabsLabel")} className="flex flex-wrap gap-space-3">
        {listingRequestStatusSchema.options.map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/admin/referencement" : `/admin/referencement?statut=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`${sheetLinkClass} aria-[current=page]:text-accent`}
          >
            {t(`tabs.${s}`)}
          </Link>
        ))}
      </nav>
      {requests.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-space-3" data-testid="listing-requests">
          {requests.map((r) => (
            <li
              key={r.id}
              data-testid="listing-request"
              className="flex flex-col gap-space-2 rounded-card border border-card-border bg-card-bg p-space-4"
            >
              <h2 className="font-strong break-words">{r.shopName}</h2>
              <p className="text-sm text-ink-muted">
                <time dateTime={r.createdAt}>{t("received", { date: when(r.createdAt) })}</time>
                {r.decidedAt && (
                  <>
                    {" · "}
                    <time dateTime={r.decidedAt}>{t("decided", { date: when(r.decidedAt) })}</time>
                  </>
                )}
              </p>
              <dl className="flex flex-col gap-space-1 text-sm">
                <div className="flex flex-wrap gap-x-space-2">
                  <dt className="text-ink-muted">{t("site")}</dt>
                  <dd className="break-all">{r.siteUrl}</dd>
                </div>
                {r.signerName && (
                  <div className="flex flex-wrap gap-x-space-2">
                    <dt className="text-ink-muted">{t("person")}</dt>
                    <dd className="break-words">
                      {r.signerName} · {r.signerEmail}
                    </dd>
                  </div>
                )}
                {r.message && (
                  <div className="flex flex-col">
                    <dt className="text-ink-muted">{t("message")}</dt>
                    <dd className="break-words whitespace-pre-line">{r.message}</dd>
                  </div>
                )}
              </dl>
              <p className="text-sm">{t("conditions", { version: r.conditionsVersion })}</p>
              {r.shop ? (
                <p className="text-sm">
                  {t("shopKnown", { name: r.shop.name })}{" "}
                  <Link href={`/admin/boutiques/${r.shop.id}`} className={sheetLinkClass}>
                    {t("openShop")}
                    <span className="sr-only"> {r.shop.name}</span>
                  </Link>
                </p>
              ) : (
                r.status === "pending" && <p className="text-sm text-ink-muted">{t("shopUnknown")}</p>
              )}
              {r.status === "refused" && <p className="text-sm text-ink-muted">{t("refusedNote")}</p>}
              {r.status === "pending" && (
                <RequestActions requestId={r.id} shopName={r.shopName} signerName={r.signerName ?? ""} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
