"use client";

import type { ItemView, ProductView, WishlistView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/dialog";
import { buttonClass, inputClass, primaryButtonClass } from "@/components/ui";
import { requestAccountPrompt } from "@/lib/account-prompt-request";
import { pushUndo } from "@/lib/undo";
import {
  bulkItems,
  changeStage,
  createItem,
  createWishlist,
  fetchWishlists,
  patchItem,
  undoWith,
} from "@/lib/wardrobe-client";

type Props = {
  product: ProductView;
  profileId: string | null;
  /** Called with her item once kept (a new one, or the one she already had). */
  onKept: (item: ItemView) => void;
  /** Re-reads her item for this product (after an undo). */
  reload: () => Promise<void>;
};

const touch = "min-h-touch-target";

/** The one gesture that keeps a product: ♡ Favori, Ajouter à une liste, Je l’ai commandé. */
export function KeepActions({ product, profileId, onKept, reload }: Props) {
  const t = useTranslations("Item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [lists, setLists] = useState<WishlistView[] | null>(null);
  const [newList, setNewList] = useState("");

  useEffect(() => {
    if (!listsOpen) return;
    let alive = true;
    setLists(null);
    fetchWishlists().then(
      (found) => alive && setLists(found),
      () => alive && setLists([]),
    );
    return () => {
      alive = false;
    };
  }, [listsOpen]);

  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));
  const base = { productId: product.id, ...(profileId ? { profileId } : {}) };

  async function favorite() {
    setBusy(true);
    setError(null);
    const result = await createItem({ ...base, action: "favorite" });
    if (!result.ok) {
      fail(result.error);
      setBusy(false);
      return;
    }
    let item = result.item;
    let undo = result.undo;
    if (!result.created && !item.favorite) {
      // The API returned her existing item as it was: the favorite is ours to set.
      const patched = await patchItem(item.id, { favorite: true });
      if (!patched.ok) {
        fail(patched.error);
        setBusy(false);
        return;
      }
      item = patched.item;
      undo = patched.undo;
    }
    onKept(item);
    pushUndo(t("toast.favorite"), undoWith(undo, reload));
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
      // The API returned her existing item as it was: the stage is ours to set.
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

  async function addToList(list: WishlistView) {
    setBusy(true);
    setError(null);
    const result = await createItem({ ...base, action: "list", wishlistId: list.id });
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
    setListsOpen(false);
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
    <section aria-labelledby="keep-title" className="flex flex-col gap-space-3">
      <h2 id="keep-title" className="sr-only">
        {t("keep.title")}
      </h2>
      <div className="flex flex-wrap gap-space-2">
        <button type="button" disabled={busy} onClick={favorite} className={`${primaryButtonClass} ${touch}`}>
          <span aria-hidden="true">♡</span> {t("keep.favorite")}
        </button>
        <button type="button" disabled={busy} onClick={() => setListsOpen(true)} className={`${buttonClass} ${touch}`}>
          {t("keep.addToList")}
        </button>
        <button type="button" disabled={busy} onClick={ordered} className={`${buttonClass} ${touch}`}>
          {t("keep.ordered")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Dialog
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        title={t("keep.addToList")}
        closeLabel={t("stageDialog.cancel")}
      >
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
              <label htmlFor="new-list" className="text-sm font-strong">
                {t("panel.newList")}
              </label>
              <input
                id="new-list"
                value={newList}
                maxLength={80}
                onChange={(event) => setNewList(event.target.value)}
                className={`${inputClass} ${touch}`}
              />
              <button
                type="submit"
                disabled={busy || newList.trim() === ""}
                className={`${primaryButtonClass} ${touch}`}
              >
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
    </section>
  );
}
