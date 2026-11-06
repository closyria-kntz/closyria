import type { ProductView } from "@closyria/shared";
import { useTranslations } from "next-intl";

/** The shop's own attributes table (« Taille », « Composition », « Entretien »…), as the shop shows it. */
export function ProductDetails({ details }: { details: ProductView["details"] }) {
  const t = useTranslations("Capture.product.details");
  if (details.length === 0) return null;
  return (
    <section aria-labelledby="details-title" data-testid="product-details" className="flex flex-col gap-space-2">
      <h3 id="details-title" className="text-sm font-strong">
        {t("title")}
      </h3>
      <dl className="flex flex-col gap-space-1 text-sm">
        {details.map((row) => (
          <div key={`${row.label} · ${row.value}`} className="flex items-baseline gap-space-3">
            <dt className="w-1/3 max-w-40 shrink-0 text-ink-muted">{row.label}</dt>
            <dd className="whitespace-pre-line">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
