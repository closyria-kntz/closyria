import { adminClassifiedFilterSchema, productCaptureStatusSchema } from "@closyria/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { fetchAdminProducts, fetchAdminShops, type ProductFilters } from "@/lib/admin-api";
import { adminCall, adminCallOrThrow, requireAdminPage } from "../../server";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";
import { CorrectedPill } from "./corrected-pill";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;

/** A filter value kept only when the shared enum knows it. */
const known = (options: readonly string[], value: unknown): string | undefined =>
  typeof value === "string" && options.includes(value) ? value : undefined;

/** The product sheets: search, filters and « Gardée par » (a count), 50 per page. */
export default async function AdminProductsPage({ searchParams }: Props) {
  await requireAdminPage();
  const query = await searchParams;
  const filters: ProductFilters = {
    q: clean(query.q, 200),
    shopId: typeof query.shopId === "string" && UUID.test(query.shopId) ? query.shopId : undefined,
    captureStatus: known(productCaptureStatusSchema.options, query.captureStatus),
    classified: known(adminClassifiedFilterSchema.options, query.classified),
  };
  const cursor = clean(query.cursor, 200);
  const withFilters = (nextCursor: string | null) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, cursor: nextCursor ?? undefined })) {
      if (value) params.set(key, value);
    }
    const suffix = params.toString();
    return suffix ? `/admin/fiches?${suffix}` : "/admin/fiches";
  };
  const t = await getTranslations("Admin.products");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const read = await adminCall((api) => fetchAdminProducts(api, { ...filters, cursor }));
  // A bad or stale cursor (400) goes back to the first page; any other refusal is an error, not an empty list.
  if (!read.ok && read.status === 400 && cursor) redirect(withFilters(null));
  if (!read.ok) throw new Error(`The admin product list answered ${read.status}`);
  const page = read.data;
  const shops = await adminCallOrThrow("The admin shop list", (api) => fetchAdminShops(api, {}));

  const nextHref = page.nextCursor ? withFilters(page.nextCursor) : null;

  const cell = "px-space-3 py-space-2 text-left align-top";
  const select = (name: string, label: string, current: string | undefined, values: [string, string][]) => (
    <label className="flex flex-col gap-space-1 text-sm">
      {label}
      <select name={name} defaultValue={current ?? ""} className={inputClass}>
        <option value="">{common("all")}</option>
        {values.map(([value, optionLabel]) => (
          <option key={value} value={value}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <form method="get" aria-label={t("search")} className="flex flex-wrap items-end gap-space-3">
        <label className="flex flex-col gap-space-1 text-sm">
          {t("search")}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("searchHint")}
            className={inputClass}
          />
        </label>
        {select(
          "shopId",
          t("filterShop"),
          filters.shopId,
          shops.shops.map((shop) => [shop.id, shop.name]),
        )}
        {select(
          "captureStatus",
          t("filterCapture"),
          filters.captureStatus,
          productCaptureStatusSchema.options.map((value) => [value, t(`captureStatuses.${value}`)]),
        )}
        {select(
          "classified",
          t("filterClassified"),
          filters.classified,
          adminClassifiedFilterSchema.options.map((value) => [value, t(`classifiedFilter.${value}`)]),
        )}
        <button type="submit" className={primaryButtonClass}>
          {t("apply")}
        </button>
        <Link href="/admin/fiches" className={buttonClass}>
          {t("reset")}
        </Link>
      </form>
      {page.products.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                {(["name", "shop", "price", "capture", "keptBy", "created"] as const).map((key) => (
                  <th key={key} scope="col" className={cell}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.products.map((product) => (
                <tr key={product.id} className="border-t border-line">
                  <td className={cell}>
                    <div className="flex items-start gap-space-3">
                      <div className="aspect-3/4 w-space-7 shrink-0 overflow-hidden rounded-card bg-media-backdrop">
                        {product.imageUrl ? (
                          // biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images.
                          <img src={product.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-space-1">
                        <Link href={`/admin/fiches/${product.id}`} className="underline">
                          {product.name ?? t("unnamed")}
                        </Link>
                        {product.brand ? <span className="text-ink-muted">{product.brand}</span> : null}
                        {product.classifiedBy === "admin" ? <CorrectedPill label={t("corrected")} /> : null}
                      </div>
                    </div>
                  </td>
                  <td className={cell}>{product.shopName}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    {product.priceCents === null
                      ? t("noPrice")
                      : format.number(product.priceCents / 100, {
                          style: "currency",
                          currency: product.currency ?? "EUR",
                        })}
                  </td>
                  <td className={cell}>{t(`captureStatuses.${product.captureStatus}`)}</td>
                  <td className={`${cell} tabular-nums`}>{product.keptBy}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    <time dateTime={product.createdAt}>
                      {format.dateTime(new Date(product.createdAt), {
                        dateStyle: "short",
                        timeStyle: "short",
                        timeZone: "UTC",
                      })}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label={t("pagination")} className="flex flex-wrap gap-space-3">
        {cursor ? (
          <Link href={withFilters(null)} className={buttonClass}>
            {t("first")}
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className={buttonClass}>
            {t("next")}
          </Link>
        ) : null}
      </nav>
    </>
  );
}
