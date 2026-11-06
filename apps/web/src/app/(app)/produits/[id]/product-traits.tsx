import type { ProductTraits as Traits } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { ColorSwatch } from "@/components/color-swatch";

/**
 * What the sheet says the product is: type, colour, material, pattern, season. Read-only; a missing trait is
 * left out, and the block disappears when nothing is known. The audience only shows when there is no type
 * (the type path already starts with « Femme », « Homme » or « Enfant »).
 */
export function ProductTraits({ traits }: { traits: Traits }) {
  const t = useTranslations("Capture.product.traits");
  const audience =
    traits.audience === null
      ? null
      : traits.audience === "child" && traits.childDetail
        ? `${t(`audiences.${traits.audience}`)} · ${t(`childDetails.${traits.childDetail}`)}`
        : t(`audiences.${traits.audience}`);
  const rows: { key: string; label: string; value: React.ReactNode }[] = [];
  if (traits.category.length > 0) rows.push({ key: "type", label: t("type"), value: traits.category.join(" › ") });
  else if (audience) rows.push({ key: "audience", label: t("audience"), value: audience });
  if (traits.color)
    rows.push({
      key: "color",
      label: t("color"),
      value: (
        <span className="inline-flex items-center gap-space-2">
          <ColorSwatch hex={traits.color.hex} />
          {traits.color.name}
        </span>
      ),
    });
  if (traits.material) rows.push({ key: "material", label: t("material"), value: traits.material });
  if (traits.pattern) rows.push({ key: "pattern", label: t("pattern"), value: traits.pattern });
  if (traits.season) rows.push({ key: "season", label: t("season"), value: t(`seasons.${traits.season}`) });
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="traits-title" data-testid="product-traits" className="flex flex-col gap-space-2">
      <h3 id="traits-title" className="text-sm font-strong">
        {t("title")}
      </h3>
      <dl className="flex flex-col gap-space-1 text-sm">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline gap-space-3">
            <dt className="w-1/3 max-w-40 shrink-0 text-ink-muted">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
