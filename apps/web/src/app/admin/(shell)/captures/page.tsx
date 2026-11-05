import { adminCaptureFailuresSchema, adminShopListSchema, captureErrorCodeSchema } from "@closyria/shared";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { adminFailuresPath } from "@/lib/admin-api";
import { adminRead, requireAdminPage } from "../../server";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";
import { RetryButton } from "./retry-button";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The latest failed captures, filtered by shop and cause with GET parameters. */
export default async function AdminCapturesPage({ searchParams }: Props) {
  await requireAdminPage();
  const query = await searchParams;
  const shopId = typeof query.shopId === "string" && UUID.test(query.shopId) ? query.shopId : undefined;
  const code = captureErrorCodeSchema.safeParse(query.errorCode);
  const errorCode = code.success ? code.data : undefined;
  const t = await getTranslations("Admin.captures");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const failures = await adminRead(
    adminFailuresPath({ ...(shopId ? { shopId } : {}), ...(errorCode ? { errorCode } : {}) }),
    adminCaptureFailuresSchema,
  );
  if (!failures) throw new Error("The failed captures could not be read");
  const shops = await adminRead("/api/admin/shops", adminShopListSchema);

  const cell = "px-space-3 py-space-2 text-left align-top";
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <form method="get" className="flex flex-wrap items-end gap-space-3">
        <label className="flex flex-col gap-space-1 text-sm">
          {t("filterShop")}
          <select name="shopId" defaultValue={shopId ?? ""} className={inputClass}>
            <option value="">{common("all")}</option>
            {(shops?.shops ?? []).map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-space-1 text-sm">
          {t("filterCause")}
          <select name="errorCode" defaultValue={errorCode ?? ""} className={inputClass}>
            <option value="">{common("all")}</option>
            {captureErrorCodeSchema.options.map((value) => (
              <option key={value} value={value}>
                {common(`errorCodes.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButtonClass}>
          {t("apply")}
        </button>
        <Link href="/admin/captures" className={buttonClass}>
          {t("reset")}
        </Link>
      </form>
      {failures.failures.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                {(["date", "shop", "address", "trigger", "cause", "httpStatus"] as const).map((key) => (
                  <th key={key} scope="col" className={cell}>
                    {t(key)}
                  </th>
                ))}
                <td className={cell} />
              </tr>
            </thead>
            <tbody>
              {failures.failures.map((failure) => (
                <tr key={failure.id} className="border-t border-line">
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    <time dateTime={failure.createdAt}>
                      {format.dateTime(new Date(failure.createdAt), {
                        dateStyle: "short",
                        timeStyle: "medium",
                        timeZone: "UTC",
                      })}
                    </time>
                  </td>
                  <td className={cell}>
                    <Link href={`/admin/boutiques/${failure.shopId}`} className="underline">
                      {failure.shopName}
                    </Link>
                  </td>
                  <td className={`${cell} break-all`}>{failure.url}</td>
                  <td className={cell}>{common(`triggers.${failure.trigger}`)}</td>
                  <td className={cell}>
                    {failure.errorCode ? common(`errorCodes.${failure.errorCode}`) : common("none")}
                  </td>
                  <td className={`${cell} tabular-nums`}>{failure.httpStatus ?? common("none")}</td>
                  <td className={cell}>
                    <RetryButton captureId={failure.id} />
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
