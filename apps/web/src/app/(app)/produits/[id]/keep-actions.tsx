"use client";

import { DEFAULT_LOVE_LEVEL, type ItemView, type LoveLevel, MAX_WHY, type ProductView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AddToListDialog } from "@/components/add-to-list-dialog";
import { LoveLevelPicker } from "@/components/love-level-picker";
import { buttonClass, inputClass, primaryButtonClass, toggleButtonClass } from "@/components/ui";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { confirmUnlessReserved, isPurchaseMove } from "@/lib/gift-check";
import { pushUndo } from "@/lib/undo";
import { changeStage, createItem, patchItem, undoWith, whyOrNull, wishCreate } from "@/lib/wardrobe-client";

type Props = {
  product: ProductView;
  profileId: string | null;
  /** Called with her item once kept (a new one, or the one she already had). */
  onKept: (item: ItemView) => void;
  /** Re-reads her item for this product (after an undo). */
  reload: () => Promise<void>;
};

const touch = "min-h-touch-target";

/**
 * The one gesture that keeps a product (spec §3.1): « Tu l’aimes comment ? » (J’aime preselected), « Prioritaire »,
 * « Pourquoi ? », then « Ajouter à mes envies »; or « Ajouter à une liste », « Déjà commandé ».
 */
export function KeepActions({ product, profileId, onKept, reload }: Props) {
  const t = useTranslations("Item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [loveLevel, setLoveLevel] = useState<LoveLevel>(DEFAULT_LOVE_LEVEL);
  const [priority, setPriority] = useState(false);
  const [why, setWhy] = useState("");

  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));
  const base = { productId: product.id, ...(profileId ? { profileId } : {}) };

  async function wish() {
    setBusy(true);
    setError(null);
    const result = await createItem(wishCreate(base, { loveLevel, priority, why }));
    if (!result.ok) {
      fail(result.error);
      setBusy(false);
      return;
    }
    let item = result.item;
    let undo = result.undo;
    if (!result.created) {
      // The API returned her existing item as it was: what she just chose is ours to set.
      const opinion = whyOrNull(why);
      const patched = await patchItem(item.id, { loveLevel, priority, ...(opinion ? { why: opinion } : {}) });
      if (!patched.ok) {
        fail(patched.error);
        setBusy(false);
        return;
      }
      item = patched.item;
      undo = patched.undo;
    }
    onKept(item);
    pushUndo(t("toast.wish"), undoWith(undo, reload));
    void requestAccountPrompt("save");
    setBusy(false);
  }

  async function ordered() {
    setBusy(true);
    setError(null);
    const result = await createItem({ ...base, action: "ordered" });
    if (!result.ok) {
      fail(result.error);
      setBusy(false);
      return;
    }
    let item = result.item;
    let undo = result.undo;
    if (!result.created && item.stage !== "ordered") {
      // The API returned her existing item as it was: the stage is ours to set (asked first, as any purchase).
      if (isPurchaseMove(item.stage, "ordered") && !(await confirmUnlessReserved([item.id], "stage"))) {
        onKept(item);
        setBusy(false);
        return;
      }
      const moved = await changeStage(item.id, { stage: "ordered", at: new Date().toISOString() });
      if (!moved.ok) {
        fail(moved.error);
        setBusy(false);
        return;
      }
      item = moved.item;
      undo = moved.undo;
    }
    onKept(item);
    pushUndo(t("toast.ordered"), undoWith(undo, reload));
    void requestAccountPrompt("save");
    setBusy(false);
  }

  return (
    <section aria-labelledby="keep-title" className="flex flex-col gap-space-3">
      <h2 id="keep-title" className="sr-only">
        {t("keep.title")}
      </h2>
      <LoveLevelPicker value={loveLevel} onChange={setLoveLevel} disabled={busy} />
      <div className="flex flex-wrap items-center gap-space-2">
        <button
          type="button"
          disabled={busy}
          aria-pressed={priority}
          onClick={() => setPriority((on) => !on)}
          className={toggleButtonClass}
        >
          {t("keep.priority")}
        </button>
        <label htmlFor="keep-why" className="sr-only">
          {t("keep.why")}
        </label>
        <input
          id="keep-why"
          value={why}
          maxLength={MAX_WHY}
          placeholder={t("keep.why")}
          onChange={(event) => setWhy(event.target.value)}
          className={`${inputClass} ${touch} w-auto min-w-space-0 flex-1 basis-1/2`}
        />
      </div>
      <button type="button" disabled={busy} onClick={wish} className={`${primaryButtonClass} ${touch} w-full`}>
        {t("keep.wish")}
      </button>
      <div className="grid grid-cols-2 gap-space-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setListsOpen(true)}
          className={`${buttonClass} ${touch} justify-center text-center`}
        >
          {t("keep.addToList")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={ordered}
          className={`${buttonClass} ${touch} justify-center text-center`}
        >
          {t("keep.ordered")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <AddToListDialog
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        productId={product.id}
        profileId={profileId}
        onKept={onKept}
        reload={reload}
      />
    </section>
  );
}
