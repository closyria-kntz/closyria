import {
  adminShopListSchema,
  captureModeSchema,
  platformSchema,
  shopHealthSchema,
  shopStatusSchema,
} from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminShopsPath, type ShopFilters } from "@/lib/admin-api";
import { adminRead, requireAdminPage } from "../../server";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";
import { HealthBadge } from "./health-badge";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** A filter value from the query string, kept only when the shared schema knows it. */
function known(schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, value: unknown) {
  const parsed = schema.safeParse(typeof value === "string" ? value : undefined);
  return parsed.success && typeof parsed.data === "string" ? parsed.data : undefined;
}

/** Shops with their health, filtered by GET parameters; pending shops first (the API orders them). */
export default async function AdminShopsPage({ searchParams }: Props) {
  await requireAdminPage();
  const query = await searchParams;
  const filters: ShopFilters = {
    status: known(shopStatusSchema, query.status),
    mode: known(captureModeSchema, query.mode),
    health: known(shopHealthSchema, query.health),
    platform: known(platformSchema, query.platform),
  };
  const t = await getTranslations("Admin.shops");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const list = await adminRead(adminShopsPath(filters), adminShopListSchema);
  if (!list) throw new Error("The admin shop list could not be read");

  const cell = "px-space-3 py-space-2 text-left align-top";
  const select = (name: string, label: string, current: string | undefined, values: [string, string][]) => (
    <label className="flex flex-col gap-space-1 text-sm">
      {label}
      <select name={name} defaultValue={current ?? ""} className={inputClass}>
        <option value="">{common("all")}</option>
        {values.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong">{t("title")}</h1>
        <Link href="/admin/boutiques/nouvelle" className={primaryButtonClass}>
          {t("add")}
        </Link>
      </div>
      <p className="text-ink-muted">{t("intro")}</p>
      <form method="get" aria-label={t("filters")} className="flex flex-wrap items-end gap-space-3">
        {select(
          "status",
          t("filterStatus"),
          filters.status,
          shopStatusSchema.options.map((v) => [v, t(`statuses.${v}`)]),
        )}
        {select(
          "mode",
          t("filterMode"),
          filters.mode,
          captureModeSchema.options.map((v) => [v, t(`modes.${v}`)]),
        )}
        {select(
          "health",
          t("filterHealth"),
          filters.health,
          shopHealthSchema.options.map((v) => [v, common(`health.${v}`)]),
        )}
        {select(
          "platform",
          t("filterPlatform"),
          filters.platform,
          platformSchema.options.map((v) => [v, t(`platforms.${v}`)]),
        )}
        <button type="submit" className={primaryButtonClass}>
          {t("apply")}
        </button>
        <Link href="/admin/boutiques" className={buttonClass}>
          {t("reset")}
        </Link>
      </form>
      {list.shops.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                {(
                  [
                    "name",
                    "domains",
                    "status",
                    "platform",
                    "mode",
                    "kind",
                    "health",
                    "recentProducts",
                    "lastCapture",
                  ] as const
                ).map((key) => (
                  <th key={key} scope="col" className={cell}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.shops.map((shop) => (
                <tr key={shop.id} className="border-t border-line">
                  <td className={`${cell} font-strong`}>
                    <span className="flex flex-wrap items-center gap-space-2">
                      <Link href={`/admin/boutiques/${shop.id}`} className="underline">
                        {shop.name}
                      </Link>
                      {shop.isMajorBrand && (
                        <span
                          data-testid="major-brand-tag"
                          className="inline-flex items-center rounded-button bg-surface-sunken px-space-2 py-space-0-5 text-caption font-strong whitespace-nowrap text-ink-muted"
                        >
                          {t("majorBrand")}
                        </span>
                      )}
                      {shop.importState !== null && (
                        <span
                          data-testid="importing-tag"
                          className="inline-flex items-center rounded-button bg-premium-surface px-space-2 py-space-0-5 text-caption font-strong whitespace-nowrap text-premium"
                        >
                          {t("importing")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={`${cell} break-all`}>{shop.domains.join(", ")}</td>
                  <td className={cell}>{t(`statuses.${shop.status}`)}</td>
                  <td className={`${cell} whitespace-nowrap`}>{t(`platforms.${shop.platform}`)}</td>
                  <td className={cell}>{t(`modes.${shop.captureMode}`)}</td>
                  <td className={cell}>{t(`kinds.${shop.listingKind}`)}</td>
                  <td className={cell}>
                    <HealthBadge health={shop.health} label={common(`health.${shop.health}`)} />
                  </td>
                  <td className={`${cell} tabular-nums`}>{format.number(shop.recentProducts)}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    {shop.lastCapture ? (
                      <time dateTime={shop.lastCapture.createdAt}>
                        {format.dateTime(new Date(shop.lastCapture.createdAt), {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "UTC",
                        })}
                      </time>
                    ) : (
                      common("none")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
