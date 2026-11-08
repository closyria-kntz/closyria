"use client";

import type { PriceHistory } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { formatAmount } from "@/lib/budget";
import { curveGeometry } from "@/lib/price-history";

/** Drawing width, in SVG units; the height is the caller's (`height`), the size on screen comes from the classes. */
const WIDTH = 170;

/**
 * The price over 3 months (spec §5, n° 13): a champagne line that draws itself once, its last point in green;
 * still in reduced motion. « Prix sur 3 mois : de 25 € à 23 € » for screen readers. Nothing under two points.
 */
export function PriceCurve({
  points,
  height = 60,
  currency = "EUR",
}: {
  points: PriceHistory["points"];
  height?: number;
  currency?: string;
}) {
  const t = useTranslations("Capture.product");
  const locale = useLocale();
  const geometry = curveGeometry(points, WIDTH, height);
  const first = points[0];
  const last = points.at(-1);
  if (!geometry || !first || !last) return null;
  return (
    <svg
      role="img"
      aria-label={t("curveLabel", {
        from: formatAmount(locale, first.priceCents, currency),
        to: formatAmount(locale, last.priceCents, currency),
      })}
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="h-space-8 w-auto shrink-0 overflow-visible"
    >
      <polyline
        points={geometry.points}
        pathLength={1}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="price-curve-line stroke-detail"
      />
      <circle cx={geometry.end.x} cy={geometry.end.y} r="5" className="price-curve-dot fill-success" />
    </svg>
  );
}
