"use client";

import type { ItemView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { pushUndo } from "@/lib/undo";
import { fetchItemsPage, purgeItem, restoreItem, undoWith } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { ItemCard } from "./item-card";
import { GRID_CLASS } from "./item-grid";
import { buttonClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** « Réglages › Corbeille »: items deleted less than 30 days ago, to restore or to delete for good. */
export function TrashSettings() {
  const t = useTranslations("Settings");
  const locale = useLocale();
  const [items, setItems] = useState<ItemView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<ItemView | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const page = await fetchItemsPage({ deleted: "true" }, null);
      setItems(page.items);
      setCursor(page.nextCursor);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    try {
      const page = await fetchItemsPage({ deleted: "true" }, cursor);
      setItems((previous) => {
        const known = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setError(t("loadError"));
    }
  }

  const nameOf = (item: ItemView) => item.name?.trim() || t("trash.noName");

  async function restore(item: ItemView) {
    const result = await restoreItem(item.id);
    if (!result.ok) {
      if (result.error === "item_not_deleted" || result.error === "not_found") {
        setError(t("trash.alreadyGone"));
        return void load();
      }
      return setError(t("trash.restoreFailed"));
    }
    setError(null);
    setItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
    // Another id back: both items were merged into the one she already had.
    const merged = result.item.id !== item.id;
    pushUndo(t(merged ? "trash.merged" : "trash.restored", { name: nameOf(item) }), undoWith(result.undo, load));
  }

  async function purge() {
    const item = purging;
    if (!item) return;
    setPurging(null);
    const result = await purgeItem(item.id);
    if (!result.ok) {
      if (result.error === "item_not_deleted" || result.error === "not_found") {
        setError(t("trash.alreadyGone"));
        return void load();
      }
      return setError(t("trash.purgeFailed"));
    }
    setError(null);
    setItems((previous) => previous.filter((candidate) => candidate.id !== item.id));
    pushUndo(t("trash.purged", { name: nameOf(item) }), null);
  }

  const dateOf = (item: ItemView) =>
    item.deletedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(item.deletedAt)) : "";

  return (
    <section className="flex flex-col gap-space-4">
      <div className="flex max-w-measure flex-col gap-space-2">
        <h2 className="font-display text-lead font-strong">{t("trash.title")}</h2>
        <p className="text-ink-muted">{t("trash.notice")}</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {status === "loading" && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {status === "ready" && items.length === 0 && <p className="text-ink-muted">{t("trash.empty")}</p>}
      {items.length > 0 && (
        <ul aria-label={t("trash.listLabel")} data-testid="trash-grid" className={GRID_CLASS}>
          {items.map((item) => (
            <ItemCard key={item.id} item={item} showStage={false} linked={false}>
              <p className="px-space-1 pt-space-1 text-sm text-ink-muted">
                {t("trash.deletedOn", { date: dateOf(item) })}
              </p>
              <div className="mt-space-2 flex flex-col gap-space-2">
                <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={() => void restore(item)}>
                  {t("trash.restore")}
                  <span className="sr-only"> {nameOf(item)}</span>
                </button>
                <button
                  type="button"
                  className={`${buttonClass} ${touch} justify-center`}
                  onClick={() => setPurging(item)}
                >
                  {t("trash.purge")}
                  <span className="sr-only"> {nameOf(item)}</span>
                </button>
              </div>
            </ItemCard>
          ))}
        </ul>
      )}
      {cursor && (
        <button type="button" className={`${buttonClass} ${touch} self-center`} onClick={() => void loadMore()}>
          {t("trash.loadMore")}
        </button>
      )}

      <Dialog
        open={purging !== null}
        onClose={() => setPurging(null)}
        title={t("trash.purgeTitle")}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("trash.purgeBody", { name: purging ? nameOf(purging) : "" })}</p>
        <div className="flex flex-wrap gap-space-2">
          <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={() => void purge()}>
            {t("trash.purge")}
          </button>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setPurging(null)}>
            {t("trash.purgeCancel")}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
