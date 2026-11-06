import { ITEM_STAGE_ORDER, type ItemStage } from "@closyria/shared";
import { useTranslations } from "next-intl";

/** The usual path, side by side; « Vendu » and « Renvoyé » are smaller, below (Passe design §3). */
const MAIN: readonly ItemStage[] = ["spotted", "ordered", "owned", "for_sale"];
const ENDS: readonly ItemStage[] = ["sold", "returned"];

/**
 * The stages as a strip: the current one filled, the ones already passed in pale green, the next ones muted.
 * Each other stage is a button (« Passer à … »); the current one is disabled and says so.
 */
export function StageStrip({ current, onPick }: { current: ItemStage; onPick: (stage: ItemStage) => void }) {
  const t = useTranslations("Item");
  const rank = ITEM_STAGE_ORDER[current];
  const button = (value: ItemStage, shape: string) => {
    const isCurrent = value === current;
    const passed = !isCurrent && ITEM_STAGE_ORDER[value] < rank && MAIN.includes(value);
    const tone = isCurrent
      ? "bg-button-bg font-strong text-button-ink"
      : passed
        ? "bg-success-surface text-success hover:bg-surface-strong"
        : "bg-surface-sunken text-ink-muted hover:bg-surface-strong hover:text-ink";
    return (
      <button
        type="button"
        aria-current={isCurrent ? "step" : undefined}
        disabled={isCurrent}
        aria-label={
          isCurrent
            ? `${t(`stage.${value}`)} (${t("panel.currentStage")})`
            : t("panel.changeStage", { stage: t(`stage.${value}`) })
        }
        onClick={() => onPick(value)}
        className={`${shape} ${tone} w-full rounded-button px-space-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid`}
      >
        {t(`stage.${value}`)}
      </button>
    );
  };
  return (
    <div className="flex flex-col gap-space-2">
      <ol className="grid grid-cols-2 gap-space-1 sm:grid-cols-4">
        {MAIN.map((value) => (
          <li key={value} className="flex">
            {button(value, "min-h-touch-target")}
          </li>
        ))}
      </ol>
      <ul className="flex gap-space-2">
        {ENDS.map((value) => (
          <li key={value}>{button(value, "min-h-touch-target px-space-3")}</li>
        ))}
      </ul>
    </div>
  );
}
