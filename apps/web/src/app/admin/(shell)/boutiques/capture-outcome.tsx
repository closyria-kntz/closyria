"use client";

import type { ExtractedProduct } from "@closyria/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { readCaptureResult } from "@/lib/admin-catalog";
import { formatPrice } from "@/lib/price";
import type { CaptureFollow } from "./use-capture-follow";

/** The product a finished capture extracted, or why there is none. Photo addresses are text, never loaded. */
export function CaptureOutcome({
  state,
  onProduct,
}: {
  state: CaptureFollow;
  /** Rendered under the details of a successful capture (the add-a-shop actions). */
  onProduct?: (product: ExtractedProduct, canonicalUrl: string) => React.ReactNode;
}) {
  const t = useTranslations("Admin.shops.tester");
  const common = useTranslations("Admin.common");
  const locale = useLocale();
  const format = useFormatter();

  if (state.phase === "idle") return null;
  if (state.phase === "running") {
    return (
      <p role="status" className="text-ink-muted">
        {t("running")}
      </p>
    );
  }
  if (state.phase === "timeout") return <p role="alert">{t("timeout")}</p>;

  const { capture } = state;
  if (capture.status === "skipped_manual") return <p role="status">{t("skipped")}</p>;
  if (capture.status === "failed") {
    return (
      <p role="alert">{t("failed", { code: capture.errorCode ? common(`errorCodes.${capture.errorCode}`) : "?" })}</p>
    );
  }
  const product = readCaptureResult(capture.result);
  if (!product) return <p role="alert">{t("badResult")}</p>;

  const rows: [string, React.ReactNode][] = [
    [t("method"), capture.method ? common(`methods.${capture.method}`) : common("none")],
    [
      t("duration"),
      capture.durationMs === null ? common("none") : t("durationValue", { ms: format.number(capture.durationMs) }),
    ],
    [t("name"), product.name],
    [t("siteName"), product.siteName ?? common("none")],
    [t("price"), formatPrice(locale, product.priceCents, product.currency)],
    [
      t("sizes"),
      product.sizes.length === 0
        ? common("none")
        : product.sizes.map((s) => `${s.label} (${s.available ? t("available") : t("unavailable")})`).join(", "),
    ],
    [
      t("photos"),
      product.images.length === 0 ? (
        t("noPhotos")
      ) : (
        <ul key="photos" className="flex flex-col gap-space-1 break-all">
          {product.images.map((src) => (
            <li key={src}>{src}</li>
          ))}
        </ul>
      ),
    ],
  ];
  return (
    <div className="flex flex-col gap-space-3">
      <dl className="flex flex-col gap-space-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-space-1">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
      {onProduct?.(product, capture.url)}
    </div>
  );
}
