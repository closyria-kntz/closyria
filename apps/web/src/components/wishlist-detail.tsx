"use client";

import type { BudgetView, ItemView, OpinionView, WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/live-changes";
import { useLoveLevels } from "@/lib/profile-context";
import { moveId } from "@/lib/reorder";
import { pushUndo } from "@/lib/undo";
import {
  deleteOpinion,
  deleteWishlist,
  fetchBudget,
  fetchItemsPage,
  fetchWishlistOpinions,
  fetchWishlists,
  markOpinionsSeen,
  removeFromWishlist,
  renameWishlist,
  reorderWishlistItems,
  restoreOpinion,
} from "@/lib/wardrobe-client";
import { BudgetDialog } from "./budget-dialog";
import { Dialog } from "./dialog";
import { FriendOpinions } from "./friend-opinions";
import { GiftReminder } from "./gift-reminder";
import { ItemCard } from "./item-card";
import { GRID_CLASS } from "./item-grid";
import { focusMoved, MoveButtons, type MoveDirection } from "./move-buttons";
import { SharePanel } from "./share-panel";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | { status: "ready"; list: WishlistView; items: ItemView[]; partial: boolean };

/** One list: its items in order (move up / down, remove), rename, share, delete. */
export function WishlistDetail({ id }: { id: string }) {
  const t = useTranslations("Lists");
  const tBudget = useTranslations("OrderDraft.budget");
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  // The list's own budget (spec §3.7), set from here or from « Préparer une commande ».
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetFailed, setBudgetFailed] = useState(false);
  const loadBudget = useCallback(async () => {
    try {
      setBudget(await fetchBudget({ wishlistId: id }));
      setBudgetFailed(false);
    } catch {
      setBudgetFailed(true);
    }
  }, [id]);
  useEffect(() => {
    void loadBudget();
  }, [loadBudget]);

  // Friends' opinions by item (spec §4.2). Those new when she opened the page keep « nouveau » for this visit,
  // even once marked seen (the next visit has none).
  const levels = useLoveLevels();
  const [opinions, setOpinions] = useState<Map<string, OpinionView[]>>(new Map());
  const [opinionsFailed, setOpinionsFailed] = useState(false);
  const newThisVisit = useRef(new Set<string>());
  const seenSent = useRef(false);
  const loadOpinions = useCallback(async () => {
    const result = await fetchWishlistOpinions(id);
    if (!result.ok) return setOpinionsFailed(true);
    setOpinionsFailed(false);
    for (const entry of result.items) {
      for (const opinion of entry.opinions) if (opinion.isNew) newThisVisit.current.add(opinion.id);
    }
    setOpinions(
      new Map(
        result.items.map((entry) => [
          entry.itemId,
          entry.opinions.map((opinion) => ({ ...opinion, isNew: newThisVisit.current.has(opinion.id) })),
        ]),
      ),
    );
    // Opening the page is seeing them: once per visit, after they are shown.
    if (!seenSent.current) {
      seenSent.current = true;
      void markOpinionsSeen(id);
    }
  }, [id]);
  useEffect(() => {
    void loadOpinions();
  }, [loadOpinions]);

  /** `quiet`: back on the page, no loading state and the list kept when the read fails. */
  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ status: "loading" });
      try {
        const list = (await fetchWishlists()).find((candidate) => candidate.id === id);
        if (!list) return setState({ status: "missing" });
        // The list's items, in its order, page by page (the API filters and orders by the list).
        const items: ItemView[] = [];
        let cursor: string | null = null;
        let failed = false;
        do {
          try {
            const page = await fetchItemsPage({ wishlist: id }, cursor);
            items.push(...page.items);
            cursor = page.nextCursor;
          } catch {
            failed = true;
            cursor = null;
          }
        } while (cursor);
        setState({ status: "ready", list, items, partial: failed || items.length !== list.itemIds.length });
      } catch {
        if (!quiet) setState({ status: "error" });
      }
    },
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // Changed elsewhere (her phone, another tab): the list and its budget again, never while she renames it.
  useLiveRefresh(
    () => {
      void load(true);
      void loadBudget();
      void loadOpinions();
    },
    state.status === "ready" && !renaming,
  );

  /** Applies the list the API returned: the items follow its order and drop those it no longer holds. */
  const apply = useCallback((list: WishlistView) => {
    setState((previous) => {
      if (previous.status !== "ready") return previous;
      const byId = new Map(previous.items.map((item) => [item.id, item]));
      const items = list.itemIds.flatMap((itemId) => byId.get(itemId) ?? []);
      return { ...previous, list, items };
    });
  }, []);

  /** The item is no longer in this list (trashed, or taken out of it from the « … » menu). */
  const dropped = useCallback((itemId: string) => {
    setState((previous) =>
      previous.status === "ready"
        ? {
            ...previous,
            list: { ...previous.list, itemIds: previous.list.itemIds.filter((known) => known !== itemId) },
            items: previous.items.filter((known) => known.id !== itemId),
          }
        : previous,
    );
  }, []);
  // A card changed from its pill or its « … » menu: it stays while it is still in this list.
  const changed = useCallback(
    (item: ItemView) => {
      if (!item.wishlistIds.includes(id)) return dropped(item.id);
      setState((previous) =>
        previous.status === "ready"
          ? { ...previous, items: previous.items.map((known) => (known.id === item.id ? item : known)) }
          : previous,
      );
    },
    [id, dropped],
  );
  const trashed = dropped;
  const actions = useMemo(() => ({ onChanged: changed, onTrashed: trashed, reload: load }), [changed, trashed, load]);

  if (state.status === "loading") {
    return (
      <p role="status" className="text-ink-muted">
        {t("loading")}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-space-2">
        <p role="alert" className="text-sm text-danger">
          {t("loadError")}
        </p>
        <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load()}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <section className="flex max-w-measure flex-col items-start gap-space-3">
        <h1 className="font-display text-title font-strong">{t("detail.notFound.title")}</h1>
        <p className="text-ink-muted">{t("detail.notFound.body")}</p>
        <Link href="/listes" className={`${primaryButtonClass} ${touch}`}>
          {t("detail.notFound.back")}
        </Link>
      </section>
    );
  }

  const { list, items, partial } = state;
  const nameOf = (item: ItemView) => item.name?.trim() || item.product.name || "";

  async function rename(event: FormEvent) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const result = await renameWishlist(list.id, name);
    if (!result.ok) return setError(t("detail.rename.failed"));
    setError(null);
    apply(result);
    setRenaming(false);
    pushUndo(t("detail.rename.done", { name: result.name }), null);
  }

  async function move(itemId: string, direction: MoveDirection) {
    // The whole list as the API knows it, never only the items that were fetched.
    const ids = moveId(list.itemIds, itemId, direction);
    if (!ids || partial) return;
    const result = await reorderWishlistItems(list.id, ids);
    if (!result.ok) return setError(t("moveFailed"));
    setError(null);
    apply(result);
    const moved = items.find((item) => item.id === itemId);
    pushUndo(
      t("moved", { name: moved ? nameOf(moved) : "", position: ids.indexOf(itemId) + 1, count: ids.length }),
      null,
    );
    focusMoved(itemId, direction);
  }

  async function remove(item: ItemView) {
    const result = await removeFromWishlist(list.id, item.id);
    if (!result.ok) return setError(t("detail.removeFailed"));
    setError(null);
    apply(result);
    pushUndo(t("detail.removed", { name: nameOf(item) }), null);
  }

  async function eraseOpinion(opinion: OpinionView) {
    const result = await deleteOpinion(list.id, opinion.id);
    if (!result.ok) return setError(t("opinions.eraseFailed"));
    setError(null);
    const erased = result.opinion;
    setOpinions(
      (previous) =>
        new Map(
          [...previous].map(([itemId, known]) => [itemId, known.filter((candidate) => candidate.id !== opinion.id)]),
        ),
    );
    pushUndo(t("opinions.erased", { name: opinion.name }), async () => {
      // Refused (409) when the same name gave a new opinion meanwhile: the toast says it did not work.
      const restored = await restoreOpinion(list.id, erased);
      void loadOpinions();
      return restored.ok;
    });
  }

  async function destroy() {
    const result = await deleteWishlist(list.id);
    setConfirmDelete(false);
    if (!result.ok) return setError(t("detail.delete.failed"));
    pushUndo(t("detail.delete.done", { name: list.name }), null);
    router.push("/listes");
  }

  return (
    <div className="flex flex-col gap-space-5 pb-space-6">
      <Link
        href="/listes"
        className={`self-start rounded-button text-sm text-accent ${touch} inline-flex items-center ${focusRing}`}
      >
        {t("detail.back")}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-space-3">
        {renaming ? (
          <form onSubmit={rename} className="flex flex-1 flex-col gap-space-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-space-1">
              <label htmlFor={nameId} className="text-sm font-strong">
                {t("detail.rename.label")}
              </label>
              <input
                id={nameId}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={80}
                required
                className={`${inputClass} ${touch}`}
              />
            </div>
            <button type="submit" className={`${primaryButtonClass} ${touch}`}>
              {t("detail.rename.save")}
            </button>
            <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setRenaming(false)}>
              {t("detail.rename.cancel")}
            </button>
          </form>
        ) : (
          <>
            <h1 className="font-display text-title font-strong">{list.name}</h1>
            <div className="flex flex-wrap gap-space-2">
              <Link href={`/envies/commande?liste=${list.id}`} className={`${primaryButtonClass} ${touch}`}>
                {t("detail.prepareOrder")}
              </Link>
              <button
                type="button"
                className={`${buttonClass} ${touch}`}
                onClick={() => {
                  setDraft(list.name);
                  setRenaming(true);
                }}
              >
                {t("detail.rename.open")}
              </button>
              <button
                type="button"
                className={`${buttonClass} ${touch}`}
                disabled={budgetFailed}
                onClick={() => setBudgetOpen(true)}
              >
                {tBudget("open")}
              </button>
              <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setConfirmDelete(true)}>
                {t("detail.delete.open")}
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {list.giftReminderDue && <GiftReminder list={list} linked={false} onAnswered={apply} />}
      <SharePanel list={list} onChange={apply} />

      {partial && (
        <p role="alert" className="text-sm text-danger">
          {t("detail.itemsFailed")}
        </p>
      )}
      {opinionsFailed && (
        <p role="alert" className="text-sm text-danger">
          {t("opinions.loadError")}
        </p>
      )}
      {items.length === 0 ? (
        <section className="flex max-w-measure flex-col gap-space-2 rounded-card border border-line bg-surface-raised p-space-5">
          <h2 className="font-display text-lead font-strong">{t("detail.empty.title")}</h2>
          <p className="text-ink-muted">{t("detail.empty.body")}</p>
        </section>
      ) : (
        <ul aria-label={t("detail.itemsLabel")} data-testid="item-grid" className={GRID_CLASS}>
          {items.map((item, index) => (
            <ItemCard key={item.id} item={item} actions={actions} showStage={false}>
              <div className="mt-space-2 flex flex-wrap items-center gap-space-2">
                <MoveButtons
                  id={item.id}
                  index={index}
                  count={items.length}
                  disabled={partial}
                  upLabel={t("moveUp", { name: nameOf(item) })}
                  downLabel={t("moveDown", { name: nameOf(item) })}
                  onMove={move}
                />
                <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void remove(item)}>
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">{t("detail.remove", { name: nameOf(item) })}</span>
                </button>
              </div>
              <div className="mt-space-3 empty:hidden">
                <FriendOpinions
                  opinions={opinions.get(item.id) ?? []}
                  levels={levels}
                  onDelete={(opinion) => void eraseOpinion(opinion)}
                />
              </div>
            </ItemCard>
          ))}
        </ul>
      )}

      <BudgetDialog
        open={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        title={tBudget("listTitle")}
        scope={{ wishlistId: list.id }}
        budget={budget}
        onChanged={(view) => {
          setBudgetOpen(false);
          setBudget(view);
        }}
        reload={loadBudget}
      />
      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("detail.delete.title", { name: list.name })}
        closeLabel={t("detail.close")}
      >
        <p className="text-ink-muted">{t("detail.delete.body")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={() => void destroy()}>
            {t("detail.delete.confirm")}
          </button>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setConfirmDelete(false)}>
            {t("detail.delete.cancel")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
