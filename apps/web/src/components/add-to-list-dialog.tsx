"use client";

import type { ItemView, WishlistView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { pushUndo } from "@/lib/undo";
import { bulkItems, createItem, createWishlist, fetchWishlists, undoWith } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/**
 * « Ajouter à une liste » for a product (the sheet she has not kept yet, a catalogue article): her lists, or a new one;
 * the product is kept as a wish in the chosen list (or, already kept, her item joins it), with « Annuler ».
 */
export function AddToListDialog({
  open,
  onClose,
  productId,
  profileId,
  onKept,
  reload,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  profileId: string | null;
  /** Her item once in the list (a new one, or the one she already had). */
  onKept: (item: ItemView) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lists, setLists] = useState<WishlistView[] | null>(null);
  const [newList, setNewList] = useState("");
  const fieldId = useId();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLists(null);
    setError(null);
    fetchWishlists().then(
      (found) => alive && setLists(found),
      () => alive && setLists([]),
    );
    return () => {
      alive = false;
    };
  }, [open]);

  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));

  async function addToList(list: WishlistView) {
    setBusy(true);
    setError(null);
    const result = await createItem({
      productId,
      ...(profileId ? { profileId } : {}),
      action: "list",
      wishlistId: list.id,
    });
    if (!result.ok) {
      fail(result.error);
      setBusy(false);
      return;
    }
    let item = result.item;
    let undo = result.undo;
    if (!result.created && !item.wishlistIds.includes(list.id)) {
      const added = await bulkItems({ op: "addToList", ids: [item.id], wishlistId: list.id });
      if (!added.ok) {
        fail(added.error);
        setBusy(false);
        return;
      }
      item = { ...item, wishlistIds: [...item.wishlistIds, list.id] };
      undo = added.undo;
    }
    onClose();
    onKept(item);
    pushUndo(t("toast.list", { name: list.name }), undoWith(undo, reload));
    void requestAccountPrompt("save");
    setBusy(false);
  }

  async function createAndAdd(event: React.FormEvent) {
    event.preventDefault();
    const name = newList.trim();
    if (!name) return;
    setBusy(true);
    const created = await createWishlist(name);
    if (!created.ok) {
      fail(created.error);
      setBusy(false);
      return;
    }
    setNewList("");
    await addToList(created);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("keep.addToList")} closeLabel={t("stageDialog.cancel")}>
      {lists === null ? (
        <p role="status">{t("keep.working")}</p>
      ) : (
        <>
          {lists.length === 0 ? (
            <p className="text-ink-muted">{t("panel.noLists")}</p>
          ) : (
            <ul className="flex flex-col gap-space-2">
              {lists.map((list) => (
                <li key={list.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addToList(list)}
                    className={`${buttonClass} ${touch} w-full justify-start`}
                  >
                    {list.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createAndAdd} className="flex flex-col gap-space-2">
            <label htmlFor={fieldId} className="text-sm font-strong">
              {t("panel.newList")}
            </label>
            <input
              id={fieldId}
              value={newList}
              maxLength={80}
              onChange={(event) => setNewList(event.target.value)}
              className={`${inputClass} ${touch}`}
            />
            <button type="submit" disabled={busy || newList.trim() === ""} className={`${primaryButtonClass} ${touch}`}>
              {t("panel.newListAdd")}
            </button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
