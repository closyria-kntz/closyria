import { isHttpUrl, type ReferenceKind, shopDataSchema } from "@closyria/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ColorSwatch } from "@/components/color-swatch";
import { fetchAdminProduct, fetchAdminReference } from "@/lib/admin-api";
import { categoryChoices } from "@/lib/admin-reference";
import { adminCall, adminCallOrThrow, requireAdminPage } from "../../../server";
import { buttonClass, sheetLinkClass } from "../../../ui";
import { CorrectedPill } from "../corrected-pill";
import { CorrectForm } from "./correct-form";
import { DeleteButton } from "./delete-button";
import { PublishedAtForm } from "./published-at-form";
import { RecaptureButton } from "./recapture-button";
import { UnhideButton } from "./unhide-button";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

/** One product sheet: photos, dates, filing by name, raw shop data, correction and re-capture. */
export default async function AdminProductPage({ params }: Props) {
  await requireAdminPage();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("Admin.products");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const read = await adminCall((api) => fetchAdminProduct(api, id));
  // Only an unknown sheet is a 404; any other refusal is an error page, never a missing sheet.
  if (!read.ok && read.status === 404) notFound();
  if (!read.ok) throw new Error(`The admin product answered ${read.status}`);
  const product = read.data;
  // The reference lists are loaded once (the sheet only stores ids); a failed read throws instead of showing empty lists.
  const reference = (kind: ReferenceKind) =>
    adminCallOrThrow(`The ${kind} list`, (api) => fetchAdminReference(api, kind));
  const [categories, colors, materials, patterns] = await Promise.all([
    reference("categories"),
    reference("colors"),
    reference("materials"),
    reference("patterns"),
  ]);
  const nameOf = (list: typeof colors, itemId: string | null) =>
    itemId ? (list.entries.find((e) => e.id === itemId)?.name ?? common("none")) : t("notSet");
  const color = colors.entries.find((e) => e.id === product.colorId);
  const categoryLabels = categoryChoices(categories.entries, " › ");
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }) : common("none");
  const details = shopDataSchema.shape.details.safeParse(product.shopData.details);
  const shopDetails = details.success ? (details.data ?? []) : [];
  const plain = (list: typeof colors) => list.entries.map((e) => ({ id: e.id, label: e.name }));

  const section = "flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4";
  const rows = (items: [string, React.ReactNode][]) => (
    <dl className="flex flex-col gap-space-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col sm:flex-row sm:gap-space-4">
          <dt className="text-ink-muted sm:w-space-8 sm:shrink-0">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong">{product.name ?? t("unnamed")}</h1>
        <Link href="/admin/fiches" className={buttonClass}>
          {t("back")}
        </Link>
      </div>
      <p className="flex flex-wrap items-center gap-space-3">
        {product.classifiedBy === "admin" ? <CorrectedPill label={t("corrected")} /> : null}
        <span>{t("keptByLine", { count: product.keptBy })}</span>
        <span className="text-ink-muted">{product.shopName}</span>
      </p>
      <UnhideButton
        productId={product.id}
        hiddenLine={product.hiddenAt ? t("hiddenLine", { date: when(product.hiddenAt) }) : null}
      />

      <section aria-labelledby="photos-title" className={section}>
        <h2 id="photos-title" className="font-display text-lead font-strong">
          {t("photos")}
        </h2>
        {product.images.length === 0 ? (
          <p>{t("noPhotos")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-space-3 md:grid-cols-4 lg:grid-cols-6">
            {product.images.map((image) => (
              <li key={image.id} className="aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
                {/* biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images. */}
                <img
                  src={image.url}
                  width={image.width}
                  height={image.height}
                  alt={product.name ?? ""}
                  loading="lazy"
                  className="size-full object-contain"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sheet-title" className={section}>
        <h2 id="sheet-title" className="font-display text-lead font-strong">
          {t("title")}
        </h2>
        {rows([
          [
            t("address"),
            <span key="a" className="flex flex-col items-start">
              {isHttpUrl(product.canonicalUrl) ? (
                <a href={product.canonicalUrl} target="_blank" rel="noopener noreferrer" className={sheetLinkClass}>
                  {t("openAtShop", { shop: product.shopName })}
                  <span className="sr-only"> {t("newTab")}</span>
                </a>
              ) : null}
              <span className="break-all text-ink-muted">{product.canonicalUrl}</span>
            </span>,
          ],
          [t("brand"), product.brand ?? t("notSet")],
          [
            t("price"),
            product.priceCents === null
              ? t("noPrice")
              : format.number(product.priceCents / 100, { style: "currency", currency: product.currency ?? "EUR" }),
          ],
          [t("capture"), t(`captureStatuses.${product.captureStatus}`)],
          [t("source"), product.source],
          [t("gtin"), product.gtin ?? t("notSet")],
          [t("sku"), product.sku ?? t("notSet")],
          [
            t("description"),
            <span key="d" className="whitespace-pre-line">
              {product.description ?? t("notSet")}
            </span>,
          ],
        ])}
        {shopDetails.length > 0 && (
          <>
            <h3 className="font-strong">{t("shopDetails")}</h3>
            <dl className="flex flex-col gap-space-2 text-sm">
              {shopDetails.map((row) => (
                <div key={`${row.label} · ${row.value}`} className="flex flex-col sm:flex-row sm:gap-space-4">
                  <dt className="text-ink-muted sm:w-space-8 sm:shrink-0">{row.label}</dt>
                  <dd className="whitespace-pre-line break-words">{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <h3 className="font-strong">{t("sizes")}</h3>
        {product.sizes.length === 0 ? (
          <p>{t("noSizes")}</p>
        ) : (
          <ul className="flex flex-wrap gap-space-2 text-sm">
            {product.sizes.map((size) => (
              <li key={size.label} className="rounded-button border border-line px-space-2 py-space-1">
                {size.label} · {size.available ? t("available") : t("unavailable")}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="dates-title" className={section}>
        <h2 id="dates-title" className="font-display text-lead font-strong">
          {t("dates")}
        </h2>
        {rows([
          [t("published"), product.publishedAt ? when(product.publishedAt) : t("publishedUnknown")],
          [t("publishedSource"), t(`publishedSources.${product.publishedSource}`)],
          [t("createdAt"), when(product.createdAt)],
          [t("lastCaptured"), when(product.lastCapturedAt)],
          [t("updatedAt"), when(product.updatedAt)],
        ])}
        <PublishedAtForm product={product} />
      </section>

      <section aria-labelledby="filing-title" className={section}>
        <h2 id="filing-title" className="font-display text-lead font-strong">
          {t("filing")}
        </h2>
        {rows([
          [t("classifiedBy"), product.classifiedBy === "admin" ? t("corrected") : t("byRule")],
          [t("audience"), product.audience ? t(`audiences.${product.audience}`) : t("notSet")],
          ...(product.audience === "child" && product.childDetail
            ? ([[t("childDetail"), t(`childDetails.${product.childDetail}`)]] as [string, string][])
            : []),
          [
            t("categoryField"),
            product.categoryId
              ? (categoryLabels.find((c) => c.id === product.categoryId)?.label ?? common("none"))
              : t("notSet"),
          ],
          [
            t("color"),
            <span key="c" className="inline-flex items-center gap-space-2">
              <ColorSwatch hex={color?.hex} />
              {nameOf(colors, product.colorId)}
            </span>,
          ],
          [t("material"), nameOf(materials, product.materialId)],
          [t("pattern"), nameOf(patterns, product.patternId)],
          [t("season"), product.season ? t(`seasons.${product.season}`) : t("notSet")],
        ])}
        <div className="flex flex-wrap items-start gap-space-4">
          <CorrectForm
            product={product}
            options={{
              categories: categoryLabels,
              colors: plain(colors),
              materials: plain(materials),
              patterns: plain(patterns),
            }}
          />
          <RecaptureButton productId={product.id} />
          <DeleteButton productId={product.id} keptBy={product.keptBy} />
        </div>
      </section>

      <details className={section}>
        <summary className="cursor-pointer font-strong">{t("rawData")}</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm">
          {JSON.stringify(product.shopData, null, 2)}
        </pre>
      </details>
    </>
  );
}
