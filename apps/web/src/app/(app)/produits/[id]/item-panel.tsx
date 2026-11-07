"use client";

import {
  DEFAULT_LOVE_LEVEL,
  ITEM_STAGE_ORDER,
  type ItemStage,
  type ItemView,
  MAX_NOTES,
  MAX_SIZE_LABEL,
  MAX_SIZE_NOTE,
  MAX_TAG_NAME,
  type TagView,
  type WishlistView,
} from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { buttonClass, inputClass, primaryButtonClass } from "@/components/ui";
import { isBareWish } from "@/lib/bare-wish";
import { formatPrice } from "@/lib/price";
import { useProfiles } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import {
  bulkItems,
  createTag,
  createWishlist,
  fetchTags,
  fetchWishlists,
  moveItem,
  patchItem,
  trashItem,
  undoWith,
} from "@/lib/wardrobe-client";
import { StageDialog } from "./stage-dialog";

const STAGES = Object.keys(ITEM_STAGE_ORDER) as ItemStage[];
const touch = "min-h-touch-target";

type Props = {
  item: ItemView;
  onChange: (item: ItemView) => void;
  /** The item left her wardrobe (trash): the sheet shows the keep actions again. */
  onGone: () => void;
  /** Re-reads her item (after an undo). */
  reload: () => Promise<void>;
  /** The shop's sheet, shown between « Mon article » and « Autres actions ». */
  shop: React.ReactNode;
};

/** HER item in three parts: « Mon article » (stage, size and amounts, notes, lists, tags), the shop sheet, « Autres actions » (profile, delete). Photos live in the gallery column. */
export function ItemPanel({ item, onChange, onGone, reload, shop }: Props) {
  const t = useTranslations("Item");
  const locale = useLocale();
  const profiles = useProfiles();
  const currency = item.product.currency ?? "EUR";
  const money = (cents: number) => formatPrice(locale, cents, currency);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<ItemStage | null>(null);
  const [sizeLabel, setSizeLabel] = useState(item.sizeLabel ?? "");
  const [sizeNote, setSizeNote] = useState(item.sizeNote ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [lists, setLists] = useState<WishlistView[] | null>(null);
  const [tags, setTags] = useState<TagView[] | null>(null);
  const [newList, setNewList] = useState("");
  const [newTag, setNewTag] = useState("");
  const [target, setTarget] = useState(profiles.find((p) => p.id !== item.profileId)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const fail = (code: string) => setError(t(`errors.${code}` as "errors.failed"));
  const itemId = item.id;

  const [extrasFailed, setExtrasFailed] = useState(false);
  const [extrasAttempt, setExtrasAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lists and tags are read once per item, and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    setExtrasFailed(false);
    fetchWishlists().then(
      (found) => alive && setLists(found),
      () => alive && setExtrasFailed(true),
    );
    fetchTags().then(
      (found) => alive && setTags(found),
      () => alive && setExtrasFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [itemId, extrasAttempt]);

  // The saved fields follow the item (an undo or another action changed them).
  useEffect(() => {
    setSizeLabel(item.sizeLabel ?? "");
    setSizeNote(item.sizeNote ?? "");
    setNotes(item.notes ?? "");
  }, [item.sizeLabel, item.sizeNote, item.notes]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  // Until the level picker (task 9): the heart sets « J'aime » or clears the level.
  const loved = item.loveLevel !== null;
  const toggleFavorite = () =>
    run(async () => {
      if (loved && isBareWish(item)) {
        const trashed = await trashItem(item.id);
        if (!trashed.ok) return fail(trashed.error);
        onGone();
        pushUndo(t("toast.wishRemoved"), undoWith(trashed.undo, reload));
        return;
      }
      const result = await patchItem(item.id, { loveLevel: loved ? null : DEFAULT_LOVE_LEVEL });
      if (!result.ok) return fail(result.error);
      onChange(result.item);
      pushUndo(t(loved ? "toast.favoriteOff" : "toast.favoriteOn"), undoWith(result.undo, reload));
    });

  const saveDetails = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const result = await patchItem(item.id, {
        sizeLabel: sizeLabel.trim() || null,
        sizeNote: sizeNote.trim() || null,
        notes: notes.trim() || null,
      });
      if (!result.ok) return fail(result.error);
      onChange(result.item);
      pushUndo(t("toast.saved"), undoWith(result.undo, reload));
    });
  };

  const toggleList = (list: WishlistView) =>
    run(async () => {
      const inside = item.wishlistIds.includes(list.id);
      const result = await bulkItems({
        op: inside ? "removeFromList" : "addToList",
        ids: [item.id],
        wishlistId: list.id,
      });
      if (!result.ok) return fail(result.error);
      onChange({
        ...item,
        wishlistIds: inside ? item.wishlistIds.filter((id) => id !== list.id) : [...item.wishlistIds, list.id],
      });
      pushUndo(t(inside ? "toast.listRemoved" : "toast.listAdded", { name: list.name }), undoWith(result.undo, reload));
    });

  const addNewList = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newList.trim();
    if (!name) return;
    return run(async () => {
      const created = await createWishlist(name);
      if (!created.ok) return fail(created.error);
      setLists((current) => [...(current ?? []), created]);
      setNewList("");
      await toggleListNow(created);
    });
  };
  // `run` is not re-entrant on purpose; the new list is added right after it was created.
  async function toggleListNow(list: WishlistView) {
    const result = await bulkItems({ op: "addToList", ids: [item.id], wishlistId: list.id });
    if (!result.ok) return fail(result.error);
    onChange({ ...item, wishlistIds: [...item.wishlistIds, list.id] });
    pushUndo(t("toast.listAdded", { name: list.name }), undoWith(result.undo, reload));
  }

  const toggleTag = (tag: TagView) =>
    run(async () => {
      const inside = item.tags.some((x) => x.id === tag.id);
      const result = await bulkItems({ op: inside ? "removeTag" : "addTag", ids: [item.id], tagId: tag.id });
      if (!result.ok) return fail(result.error);
      onChange({ ...item, tags: inside ? item.tags.filter((x) => x.id !== tag.id) : [...item.tags, tag] });
      pushUndo(t(inside ? "toast.tagRemoved" : "toast.tagAdded", { name: tag.name }), undoWith(result.undo, reload));
    });

  const addNewTag = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newTag.trim();
    if (!name) return;
    return run(async () => {
      const created = await createTag(name);
      if (!created.ok) return fail(created.error);
      setTags((current) => [...(current ?? []), created]);
      setNewTag("");
      const result = await bulkItems({ op: "addTag", ids: [item.id], tagId: created.id });
      if (!result.ok) return fail(result.error);
      onChange({ ...item, tags: [...item.tags, created] });
      pushUndo(t("toast.tagAdded", { name }), undoWith(result.undo, reload));
    });
  };

  const move = () =>
    run(async () => {
      const result = await moveItem(item.id, target);
      if (!result.ok) return fail(result.error);
      onChange(result.item);
      const name = profiles.find((p) => p.id === target)?.name ?? "";
      pushUndo(t("toast.moved", { name }), undoWith(result.undo, reload));
    });

  const remove = () =>
    run(async () => {
      const result = await trashItem(item.id);
      if (!result.ok) return fail(result.error);
      onGone();
      pushUndo(t("toast.deleted"), undoWith(result.undo, reload));
    });

  const amounts = [
    item.pricePaidCents !== null && t("panel.paid", { amount: money(item.pricePaidCents) }),
    item.salePriceCents !== null &&
      t(item.stage === "sold" ? "panel.soldFor" : "panel.salePrice", { amount: money(item.salePriceCents) }),
    item.saleChannel && t("panel.channel", { channel: item.saleChannel }),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-space-5" aria-busy={busy || undefined}>
      <section
        aria-labelledby="mine-title"
        className="flex flex-col gap-space-5 rounded-card border border-line bg-surface-raised p-space-4"
      >
        <div className="flex items-center justify-between gap-space-3">
          <h2 id="mine-title" className="font-display text-lead font-strong">
            {t("sections.mine")}
          </h2>
          <button
            type="button"
            disabled={busy}
            aria-pressed={loved}
            onClick={toggleFavorite}
            className={`${buttonClass} ${touch} aria-pressed:bg-surface-strong aria-pressed:font-strong`}
          >
            <span aria-hidden="true">{loved ? "♥" : "♡"}</span> {t("panel.favorite")}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <section aria-labelledby="stages-title" className="flex flex-col gap-space-2">
          <h3 id="stages-title" className="text-sm font-strong">
            {t("panel.stages")}
          </h3>
          <ol className="flex flex-wrap gap-space-2">
            {STAGES.map((value) => {
              const current = value === item.stage;
              return (
                <li key={value}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    disabled={current}
                    aria-label={
                      current
                        ? `${t(`stage.${value}`)} (${t("panel.currentStage")})`
                        : t("panel.changeStage", { stage: t(`stage.${value}`) })
                    }
                    onClick={() => setStage(value)}
                    className={`${current ? "rounded-button bg-button-bg px-space-3 text-sm font-strong text-button-ink" : buttonClass} ${touch} inline-flex items-center`}
                  >
                    {t(`stage.${value}`)}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
        <StageDialog item={item} stage={stage} onClose={() => setStage(null)} onDone={onChange} reload={reload} />

        <form onSubmit={saveDetails} className="flex flex-col gap-space-3 border-t border-line pt-space-4">
          <h3 className="text-sm font-strong">{t("panel.sizeAndAmounts")}</h3>
          {amounts.length > 0 && <p className="text-sm text-ink-muted tabular-nums">{amounts.join(" · ")}</p>}
          <label htmlFor="item-size" className="text-sm">
            {t("panel.size")}
          </label>
          <input
            id="item-size"
            value={sizeLabel}
            maxLength={MAX_SIZE_LABEL}
            onChange={(e) => setSizeLabel(e.target.value)}
            className={`${inputClass} ${touch}`}
          />
          <label htmlFor="item-size-note" className="text-sm">
            {t("panel.sizeNote")}
          </label>
          <input
            id="item-size-note"
            value={sizeNote}
            maxLength={MAX_SIZE_NOTE}
            onChange={(e) => setSizeNote(e.target.value)}
            className={`${inputClass} ${touch}`}
          />
          <label htmlFor="item-notes" className="text-sm">
            {t("panel.notes")}
          </label>
          <textarea
            id="item-notes"
            rows={4}
            value={notes}
            maxLength={MAX_NOTES}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch} self-start`}>
            {t("panel.save")}
          </button>
        </form>

        {extrasFailed && (
          <div className="flex flex-col items-start gap-space-2">
            <p role="alert" className="text-sm text-danger">
              {t("errors.extrasLoad")}
            </p>
            <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setExtrasAttempt((n) => n + 1)}>
              {t("panel.retry")}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-space-5 border-t border-line pt-space-4">
          <section aria-labelledby="lists-title" className="flex flex-col gap-space-2">
            <h3 id="lists-title" className="text-sm font-strong">
              {t("panel.lists")}
            </h3>
            {lists === null ? null : lists.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("panel.noLists")}</p>
            ) : (
              <ul className="flex flex-wrap gap-space-2">
                {lists.map((list) => (
                  <li key={list.id}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={item.wishlistIds.includes(list.id)}
                      onClick={() => toggleList(list)}
                      className={`${buttonClass} ${touch} aria-pressed:bg-surface-strong aria-pressed:font-strong`}
                    >
                      {list.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addNewList} className="flex flex-wrap items-end gap-space-2">
              <label htmlFor="item-new-list" className="sr-only">
                {t("panel.newList")}
              </label>
              <input
                id="item-new-list"
                placeholder={t("panel.newList")}
                value={newList}
                maxLength={80}
                onChange={(e) => setNewList(e.target.value)}
                className={`${inputClass} ${touch} w-auto flex-1`}
              />
              <button type="submit" disabled={busy || newList.trim() === ""} className={`${buttonClass} ${touch}`}>
                {t("panel.newListAdd")}
              </button>
            </form>
          </section>

          <section aria-labelledby="tags-title" className="flex flex-col gap-space-2">
            <h3 id="tags-title" className="text-sm font-strong">
              {t("panel.tags")}
            </h3>
            {tags === null ? null : tags.length === 0 ? (
              <p className="text-sm text-ink-muted">{t("panel.noTags")}</p>
            ) : (
              <ul className="flex flex-wrap gap-space-2">
                {tags.map((tag) => (
                  <li key={tag.id}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={item.tags.some((x) => x.id === tag.id)}
                      onClick={() => toggleTag(tag)}
                      className={`${buttonClass} ${touch} aria-pressed:bg-surface-strong aria-pressed:font-strong`}
                    >
                      {tag.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addNewTag} className="flex flex-wrap items-end gap-space-2">
              <label htmlFor="item-new-tag" className="sr-only">
                {t("panel.newTag")}
              </label>
              <input
                id="item-new-tag"
                placeholder={t("panel.newTag")}
                value={newTag}
                maxLength={MAX_TAG_NAME}
                onChange={(e) => setNewTag(e.target.value)}
                className={`${inputClass} ${touch} w-auto flex-1`}
              />
              <button type="submit" disabled={busy || newTag.trim() === ""} className={`${buttonClass} ${touch}`}>
                {t("panel.newTagAdd")}
              </button>
            </form>
          </section>
        </div>
      </section>

      {shop}

      <section aria-labelledby="more-title" className="flex flex-col gap-space-4 border-t border-line pt-space-5">
        <h2 id="more-title" className="text-sm font-strong">
          {t("sections.more")}
        </h2>
        {profiles.length > 1 && (
          <section aria-labelledby="profile-title" className="flex flex-col gap-space-2">
            <h3 id="profile-title" className="text-sm font-strong">
              {t("panel.profile")}
            </h3>
            <p className="text-sm">{profiles.find((p) => p.id === item.profileId)?.name}</p>
            <div className="flex flex-wrap items-center gap-space-2">
              <label htmlFor="item-move" className="text-sm">
                {t("panel.moveTo")}
              </label>
              <select
                id="item-move"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={`${inputClass} ${touch} w-auto`}
              >
                {profiles
                  .filter((p) => p.id !== item.profileId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={busy || target === ""}
                onClick={move}
                className={`${buttonClass} ${touch}`}
              >
                {t("panel.move")}
              </button>
            </div>
          </section>
        )}

        <div className="flex flex-col items-start gap-space-1">
          <button type="button" disabled={busy} onClick={remove} className={`${buttonClass} ${touch} text-danger`}>
            {t("panel.delete")}
          </button>
          <p className="text-sm text-ink-muted">{t("panel.deleteHint")}</p>
        </div>
      </section>
    </div>
  );
}
