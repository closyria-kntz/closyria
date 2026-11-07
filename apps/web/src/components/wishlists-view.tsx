"use client";

import type { WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { useLiveRefresh } from "@/lib/live-changes";
import { moveId } from "@/lib/reorder";
import { pushUndo } from "@/lib/undo";
import { createWishlist, fetchWishlists, reorderWishlists } from "@/lib/wardrobe-client";
import { focusMoved, MoveButtons, type MoveDirection } from "./move-buttons";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** « Listes »: create, open and reorder her lists. */
export function WishlistsView() {
  const t = useTranslations("Lists");
  const [lists, setLists] = useState<WishlistView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  /** `quiet`: back on the page, no loading state and the lists kept when the read fails. */
  const load = useCallback(async (quiet = false) => {
    if (!quiet) setStatus("loading");
    try {
      setLists(await fetchWishlists());
      setStatus("ready");
    } catch {
      if (!quiet) setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load(true), status === "ready");

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const result = await createWishlist(trimmed);
    setBusy(false);
    if (!result.ok) return setError(t("create.failed"));
    setName("");
    setLists((previous) => [...previous, result]);
    pushUndo(t("create.created", { name: result.name }), null);
  }

  async function move(id: string, direction: MoveDirection) {
    const ids = moveId(
      lists.map((list) => list.id),
      id,
      direction,
    );
    if (!ids) return;
    const result = await reorderWishlists(ids);
    if (!result.ok) return setError(t("moveFailed"));
    setError(null);
    setLists(result.wishlists);
    const moved = result.wishlists.find((list) => list.id === id);
    pushUndo(t("moved", { name: moved?.name ?? "", position: ids.indexOf(id) + 1, count: ids.length }), null);
    focusMoved(id, direction);
  }

  return (
    <div className="flex max-w-measure flex-col gap-space-5 pb-space-6">
      <h1 className="font-display text-title font-strong">{t("title")}</h1>

      <form onSubmit={create} className="flex flex-col gap-space-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-space-1">
          <label htmlFor={fieldId} className="text-sm font-strong">
            {t("create.label")}
          </label>
          <input
            id={fieldId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            className={`${inputClass} ${touch}`}
          />
        </div>
        <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
          {t("create.submit")}
        </button>
      </form>
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
      {status === "ready" && lists.length === 0 && (
        <section className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-raised p-space-5">
          <h2 className="font-display text-lead font-strong">{t("empty.title")}</h2>
          <p className="text-ink-muted">{t("empty.body")}</p>
        </section>
      )}
      {lists.length > 0 && (
        <ul aria-label={t("listsLabel")} className="flex flex-col gap-space-3">
          {lists.map((list, index) => (
            <li
              key={list.id}
              data-testid="wishlist-row"
              className="flex flex-wrap items-center justify-between gap-space-3 rounded-card border border-line bg-surface-raised p-space-3"
            >
              <Link
                href={`/listes/${list.id}`}
                className={`flex min-w-space-0 flex-1 flex-col rounded-button ${touch} justify-center ${focusRing}`}
              >
                <span className="truncate font-strong">{list.name}</span>
                <span className="text-sm text-ink-muted">
                  {t("count", { count: list.itemIds.length })}
                  {list.shared && ` · ${t("shared")}`}
                </span>
              </Link>
              <MoveButtons
                id={list.id}
                index={index}
                count={lists.length}
                upLabel={t("moveUp", { name: list.name })}
                downLabel={t("moveDown", { name: list.name })}
                onMove={move}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
