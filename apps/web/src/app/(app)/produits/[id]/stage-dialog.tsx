"use client";

import type { ItemStage, ItemView } from "@closyria/shared";
import { MAX_SALE_CHANNEL } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { parsePriceCents } from "@/lib/price";
import { pushUndo } from "@/lib/undo";
import { changeStage, undoWith } from "@/lib/wardrobe-client";

const AMOUNT_LABEL = {
  ordered: "amountPaid",
  owned: "amountPaid",
  for_sale: "amountSale",
  sold: "amountSold",
  returned: "amountReturned",
} as const;

/** `YYYY-MM-DD` of today in her time zone. */
export function todayInput(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** The instant sent to the API: now for today (keeps the order of the day), else noon that day. */
export function stageInstant(date: string, now = new Date()): string {
  return date === todayInput(now) ? now.toISOString() : new Date(`${date}T12:00:00`).toISOString();
}

function StageForm({
  item,
  stage,
  onClose,
  onDone,
  reload,
}: {
  item: ItemView;
  stage: ItemStage;
  onClose: () => void;
  onDone: (item: ItemView) => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Item");
  const [date, setDate] = useState(todayInput());
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState(stage === "for_sale" || stage === "sold" ? (item.saleChannel ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sale = stage === "for_sale" || stage === "sold";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePriceCents(amount);
    if (!parsed.ok) return setError(t("stageDialog.invalidAmount"));
    setBusy(true);
    const trimmed = channel.trim();
    const result = await changeStage(item.id, {
      stage,
      at: stageInstant(date),
      ...(parsed.cents !== undefined && stage !== "spotted" ? { amountCents: parsed.cents } : {}),
      ...(sale && trimmed !== "" ? { channel: trimmed } : {}),
    });
    setBusy(false);
    if (!result.ok) return setError(t(`errors.${result.error}` as "errors.failed"));
    onDone(result.item);
    onClose();
    pushUndo(t("toast.stage", { stage: t(`stage.${stage}`) }), undoWith(result.undo, reload));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-space-3">
      <label htmlFor="stage-date" className="text-sm font-strong">
        {t("stageDialog.date")}
      </label>
      <input
        id="stage-date"
        type="date"
        required
        max={todayInput()}
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className={`${inputClass} min-h-touch-target`}
      />
      {stage !== "spotted" && (
        <>
          <label htmlFor="stage-amount" className="text-sm font-strong">
            {t(`stageDialog.${AMOUNT_LABEL[stage]}`)}
          </label>
          <input
            id="stage-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${inputClass} min-h-touch-target`}
          />
        </>
      )}
      {sale && (
        <>
          <label htmlFor="stage-channel" className="text-sm font-strong">
            {t(stage === "sold" ? "stageDialog.channelSold" : "stageDialog.channel")}
          </label>
          <input
            id="stage-channel"
            maxLength={MAX_SALE_CHANNEL}
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            className={`${inputClass} min-h-touch-target`}
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
        {t("stageDialog.confirm")}
      </button>
    </form>
  );
}

/** Moving an article to a stage: its date (today by default), an optional amount, and for sales the place. */
export function StageDialog(props: {
  item: ItemView;
  stage: ItemStage | null;
  onClose: () => void;
  onDone: (item: ItemView) => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Item");
  const { stage, onClose } = props;
  return (
    <Dialog
      open={stage !== null}
      onClose={onClose}
      title={stage ? t("stageDialog.title", { stage: t(`stage.${stage}`) }) : ""}
      closeLabel={t("stageDialog.cancel")}
    >
      {stage && <StageForm {...props} stage={stage} />}
    </Dialog>
  );
}
