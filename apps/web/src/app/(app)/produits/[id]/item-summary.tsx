import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";

/** Her item at a glance, under the price (Passe design §3): the stage, and her size when she gave one. */
export function ItemSummary({ item }: { item: ItemView }) {
  const t = useTranslations("Item");
  return (
    <p data-testid="item-summary" className="flex flex-wrap gap-space-2 text-sm">
      <span className="rounded-button bg-button-bg px-space-3 py-space-1 font-strong text-button-ink">
        {t(`stage.${item.stage}`)}
      </span>
      {item.sizeLabel && (
        <span className="rounded-button border border-line px-space-3 py-space-1">
          {t("summary.size", { size: item.sizeLabel })}
        </span>
      )}
    </p>
  );
}
