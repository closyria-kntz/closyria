import { adminShopDetailSchema, adminShopListSchema, shippingOptionListSchema } from "@closyria/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminRead, requireAdminPage } from "../../../server";
import { buttonClass } from "../../../ui";
import { HealthBadge } from "../health-badge";
import { LinkTester } from "../link-tester";
import { MergeDialog } from "../merge-dialog";
import { ShopSettingsForm } from "../shop-settings-form";
import { ShippingOptions } from "./shipping-options";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

/** One shop: settings, health, link tester and merge. */
export default async function AdminShopPage({ params }: Props) {
  await requireAdminPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("Admin.shops");
  const shippingT = await getTranslations("Admin.shipping");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const shop = await adminRead(`/api/admin/shops/${id}`, adminShopDetailSchema);
  if (!shop) notFound();
  const shipping = await adminRead(`/api/admin/shops/${id}/shipping-options`, shippingOptionListSchema);
  const all = await adminRead("/api/admin/shops", adminShopListSchema);
  const options = (all?.shops ?? []).filter((s) => s.id !== shop.id).map((s) => ({ id: s.id, name: s.name }));
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong">{shop.name}</h1>
        <Link href="/admin/boutiques" className={buttonClass}>
          {t("back")}
        </Link>
      </div>

      <section
        aria-labelledby="settings-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="settings-title" className="font-display text-lead font-strong">
          {t("settings")}
        </h2>
        <ShopSettingsForm shop={shop} />
      </section>

      <section
        aria-labelledby="shipping-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="shipping-title" className="font-display text-lead font-strong">
          {shippingT("title")}
        </h2>
        <ShippingOptions shopId={shop.id} options={shipping?.options ?? []} />
      </section>

      <section
        aria-labelledby="health-title"
        className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
      >
        <h2 id="health-title" className="font-display text-lead font-strong">
          {t("healthTitle")}
        </h2>
        <p>
          <HealthBadge health={shop.health} label={common(`health.${shop.health}`)} />
        </p>
        <dl className="flex flex-col gap-space-2 text-sm">
          <div className="flex flex-col gap-space-1">
            <dt className="text-ink-muted">{t("successRate")}</dt>
            <dd className="tabular-nums">
              {shop.successRate7d === null ? common("none") : format.number(shop.successRate7d, { style: "percent" })}
            </dd>
          </div>
          <div className="flex flex-col gap-space-1">
            <dt className="text-ink-muted">{t("lastMonitor")}</dt>
            <dd>
              {shop.lastMonitor ? `${when(shop.lastMonitor.createdAt)} · ${shop.lastMonitor.status}` : t("noMonitor")}
            </dd>
          </div>
        </dl>
        <h3 className="font-strong">{t("recentErrors")}</h3>
        {shop.recentErrors.length === 0 ? (
          <p className="text-ink-muted">{t("noErrors")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2 text-sm">
            {shop.recentErrors.map((error) => (
              <li key={`${error.createdAt}-${error.url}`} className="break-all">
                <time dateTime={error.createdAt} className="tabular-nums">
                  {when(error.createdAt)}
                </time>
                {" · "}
                {t("errorLine", {
                  code: error.errorCode ? common(`errorCodes.${error.errorCode}`) : common("none"),
                  status: error.httpStatus ?? common("none"),
                })}
                {" · "}
                {error.url}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="rounded-card border border-card-border bg-card-bg p-space-4">
        <LinkTester initialUrl={shop.testUrl} />
      </div>
      <div className="rounded-card border border-card-border bg-card-bg p-space-4">
        <MergeDialog source={{ id: shop.id, name: shop.name }} options={options} />
      </div>
    </>
  );
}
