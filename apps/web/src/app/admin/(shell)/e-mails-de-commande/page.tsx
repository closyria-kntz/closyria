import { adminOrderEmailsSchema } from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { fetchAdminJson } from "@/lib/admin-api";
import { adminCallOrThrow, requireAdminPage } from "../../server";
import { AiCapForm } from "./ai-cap-form";

/**
 * « E-mails de commande » (« Après la commande » §4): what the forwarded e-mails became over 30 days, the read rate
 * per shop, and the AI's month against its cap. Figures only: no e-mail, sender or article is ever shown here.
 */
export default async function AdminOrderEmailsPage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.orderEmails");
  const format = await getFormatter();
  const data = await adminCallOrThrow("The order e-mails", (api) =>
    fetchAdminJson(api, "/api/admin/order-emails", adminOrderEmailsSchema),
  );
  const { counts, byMethod, shops, ai } = data;
  const euros = (cents: number) => format.number(cents / 100, { style: "currency", currency: "EUR" });
  const percent = (value: number | null) => (value === null ? t("none") : format.number(value, { style: "percent" }));
  const figures = [
    { key: "received", label: t("received"), value: counts.received },
    { key: "parsed", label: t("parsed"), value: counts.parsed },
    { key: "failed", label: t("failed"), value: counts.failed },
    { key: "ignored", label: t("ignored"), value: counts.ignored },
    { key: "queued", label: t("queued"), value: counts.queued },
  ];
  const used = ai.capCents > 0 ? Math.min(1, ai.costCents / ai.capCents) : 1;
  const cell = "px-space-3 py-space-2 text-left align-top";

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="max-w-prose text-ink-muted">{t("intro", { days: data.days })}</p>

      <dl data-testid="order-email-counts" className="grid grid-cols-1 gap-space-3 sm:grid-cols-2 lg:grid-cols-5">
        {figures.map((figure) => (
          <div
            key={figure.key}
            className="flex flex-col-reverse gap-space-1 rounded-card border border-card-border bg-card-bg p-space-4 shadow-soft"
          >
            <dt className="text-sm text-ink-muted">{figure.label}</dt>
            <dd className="font-display text-display font-strong tabular-nums">{format.number(figure.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">
        {t("byMethod", { known: byMethod.known, ai: byMethod.ai })} {t("ignoredNote")}
      </p>

      <section
        aria-labelledby="ai-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="ai-title" className="font-display text-lead font-strong">
          {t("aiTitle")}
        </h2>
        <p data-testid="ai-month" className="tabular-nums">
          {t("aiLine", { cost: euros(ai.costCents), cap: euros(ai.capCents), calls: ai.calls, month: ai.month })}
        </p>
        <p className={used >= 1 ? "font-strong text-danger" : "text-ink-muted"}>
          {used >= 1 ? t("aiCapReached") : t("aiUsed", { percent: percent(used) })}
        </p>
        <AiCapForm capCents={ai.capCents} />
      </section>

      <section aria-labelledby="shops-title" className="flex flex-col gap-space-3">
        <h2 id="shops-title" className="font-display text-lead font-strong">
          {t("shopsTitle")}
        </h2>
        {shops.length === 0 ? (
          <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("noShops")}</p>
        ) : (
          <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
            <table data-testid="order-email-shops" className="w-full border-collapse text-sm">
              <caption className="sr-only">{t("shopsTitle")}</caption>
              <thead className="bg-surface-sunken text-ink-muted">
                <tr>
                  <th scope="col" className={cell}>
                    {t("shop")}
                  </th>
                  <th scope="col" className={cell}>
                    {t("readRate")}
                  </th>
                  <th scope="col" className={cell}>
                    {t("shopParsed")}
                  </th>
                  <th scope="col" className={cell}>
                    {t("shopFailed")}
                  </th>
                  <th scope="col" className={cell}>
                    {t("shopDismissed")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shops.map((shop) => (
                  <tr key={shop.shopId ?? "none"} className="border-t border-line">
                    <th scope="row" className={`${cell} font-strong`}>
                      {shop.shopId ? (
                        <Link
                          href={`/admin/boutiques/${shop.shopId}`}
                          className="inline-flex min-h-touch-target items-center underline underline-offset-4"
                        >
                          {shop.name ?? t("none")}
                        </Link>
                      ) : (
                        <span className="text-ink-muted">{t("noShop")}</span>
                      )}
                    </th>
                    <td className={`${cell} tabular-nums`}>{percent(shop.readRate)}</td>
                    <td className={`${cell} tabular-nums`}>{format.number(shop.parsed)}</td>
                    <td className={`${cell} tabular-nums`}>{format.number(shop.failed)}</td>
                    <td className={`${cell} tabular-nums`}>{format.number(shop.dismissed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="max-w-prose text-sm text-ink-muted">{t("shopsNote")}</p>
      </section>
    </>
  );
}
