"use client";

import { type OpinionView, opinionNameKey, type SharedWishlistView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { buttonClass, focusRing } from "@/components/ui";
import { type FriendDevice, friendDevice } from "@/lib/friend-device";
import { levelOf } from "@/lib/love-levels";
import { formatOptionalPrice, formatPrice } from "@/lib/price";
import { relativeDate } from "@/lib/relative-date";
import { deleteOpinion, fetchSharedView, putOpinion } from "@/lib/shared-list";
import { CoverPhoto } from "./cover-photo";
import { OpinionSheet, type SheetOutcome } from "./opinion-sheet";

type Item = SharedWishlistView["items"][number];
type Toast = { id: number; label: string; undo: (() => Promise<boolean>) | null };

/** How long « Avis envoyé · Annuler » stays (same as the app's undo toast). */
const TOAST_MS = 8_000;

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** The browser's local storage, or null when reading it throws (blocked site data). */
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The first letter of a name, for the round badge. */
function initialOf(name: string): string {
  const first = new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(name.trim())[Symbol.iterator]().next();
  return first.done ? "?" : first.value.segment.toLocaleUpperCase("fr");
}

const newestFirst = (opinions: OpinionView[]) =>
  [...opinions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));

/**
 * The shared list as a friend sees it (spec §3): the owner's opinion on each item, the friends' opinions, and
 * « Donner mon avis ». Read on the server for the first paint, read again here after each change.
 */
export function SharedListView({ token, initial }: { token: string; initial: SharedWishlistView }) {
  const t = useTranslations("SharedList");
  const tOpinions = useTranslations("SharedList.opinions");
  const locale = useLocale();
  const [view, setView] = useState(initial);
  // Made in the browser only (local storage): before that, no « Modifier mon avis ».
  const [device, setDevice] = useState<FriendDevice | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ itemId: string; session: number; open: boolean } | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastCounter = useRef(0);

  useEffect(() => {
    const made = friendDevice(localStorageOrNull());
    setDevice(made);
    setDeviceName(made.name);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const next = await fetchSharedView(token);
      if (next) setView(next);
    } catch {
      // The page keeps what it shows; the next change reads it again.
    }
  }, [token]);

  function show(label: string, undo: Toast["undo"]) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, label, undo });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  async function runUndo() {
    const undo = toast?.undo;
    if (!undo) return;
    setToast(null);
    const ok = await undo();
    await reload();
    if (!ok) show(tOpinions("toast.undoFailed"), null);
  }

  function done(itemId: string, outcome: SheetOutcome) {
    if (!device) return;
    setDeviceName(device.name);
    setSheet((current) => current && { ...current, open: false });
    const putBack = (previous: OpinionView) => async () =>
      (
        await putOpinion(token, itemId, {
          name: previous.name,
          level: previous.level,
          note: previous.note,
          deviceKey: device.key,
        })
      ).ok;
    if (outcome.kind === "sent") {
      const { previous, name } = outcome;
      show(
        tOpinions("toast.sent"),
        previous
          ? putBack(previous)
          : async () => (await deleteOpinion(token, itemId, { name, deviceKey: device.key })).ok,
      );
    } else {
      show(tOpinions("toast.erased"), putBack(outcome.previous));
    }
    void reload();
  }

  const sheetItem = sheet ? view.items.find((item) => item.itemId === sheet.itemId) : undefined;

  return (
    <>
      <header className="flex flex-col gap-space-2">
        <p className="font-display text-lead font-strong text-accent">
          {view.ownerName ? t("ownerList", { name: view.ownerName }) : t("metadata")}
        </p>
        <h1 className="font-display text-title font-strong">{view.name}</h1>
        <p className="text-ink-muted">{view.allowOpinions ? t("invite") : tOpinions("closed")}</p>
      </header>

      {view.budget && (
        <p className="flex items-center justify-between gap-space-3 self-start rounded-card border-2 border-selected-line bg-surface-raised px-space-4 py-space-3 font-strong tabular-nums">
          {t("budget", { amount: formatPrice(locale, view.budget.amountCents, view.budget.currency) })}
        </p>
      )}

      {view.items.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <ul
          aria-label={t("itemsLabel")}
          data-testid="shared-items"
          className="grid grid-cols-1 items-start gap-space-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {view.items.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              view={view}
              deviceName={device ? deviceName : null}
              onGive={() =>
                setSheet((current) => ({ itemId: item.itemId, session: (current?.session ?? 0) + 1, open: true }))
              }
            />
          ))}
        </ul>
      )}

      {device && sheet && sheetItem && (
        <OpinionSheet
          key={sheet.session}
          open={sheet.open}
          onClose={() => setSheet((current) => current && { ...current, open: false })}
          token={token}
          item={{
            itemId: sheetItem.itemId,
            name: sheetItem.name?.trim() || t("noName"),
            opinions: sheetItem.opinions,
          }}
          listOpinions={view.items.flatMap((item) => item.opinions)}
          levels={view.levels}
          device={device}
          onDone={(outcome) => done(sheetItem.itemId, outcome)}
        />
      )}

      <div
        role="status"
        aria-live="polite"
        aria-label={tOpinions("toast.label")}
        className="pointer-events-none fixed inset-x-space-4 bottom-space-5 z-40 flex justify-center"
      >
        {toast && (
          <p
            key={toast.id}
            className="pointer-events-auto flex items-center gap-space-3 rounded-card bg-ink px-space-4 py-space-2 text-sm text-surface-raised shadow-lifted"
          >
            <span>{toast.label}</span>
            {toast.undo && (
              <>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={() => void runUndo()} className={`${buttonClass} min-h-touch-target`}>
                  {tOpinions("toast.undo")}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </>
  );
}

function ItemCard({
  item,
  view,
  deviceName,
  onGive,
}: {
  item: Item;
  view: SharedWishlistView;
  deviceName: string | null;
  onGive: () => void;
}) {
  const t = useTranslations("SharedList");
  const tOpinions = useTranslations("SharedList.opinions");
  const locale = useLocale();
  const name = item.name?.trim() || t("noName");
  const opinions = newestFirst(item.opinions);
  const mine = deviceName !== null && item.opinions.some((o) => opinionNameKey(o.name) === opinionNameKey(deviceName));
  const owner = item.ownerOpinion;
  const ownerLevel = owner?.level ? levelOf(view.levels, owner.level) : null;
  const now = new Date();

  return (
    <li className="card flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-3">
      <div className="flex gap-space-3">
        <div className="relative aspect-3/4 w-1/3 shrink-0 overflow-hidden rounded-card bg-media-backdrop">
          {item.imageUrl && item.imageWidth && item.imageHeight ? (
            <CoverPhoto
              photos={[{ url: item.imageUrl, width: item.imageWidth, height: item.imageHeight }]}
              name={name}
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-full items-center justify-center p-space-2 text-center text-caption text-ink-muted"
            >
              {t("noPhoto")}
            </span>
          )}
        </div>
        <div className="flex min-w-space-0 flex-1 flex-col gap-space-1">
          <h2 className="font-strong break-words">{name}</h2>
          {item.brand && <p className="text-sm text-ink-muted">{item.brand}</p>}
          <p className="font-strong tabular-nums">
            {formatOptionalPrice(locale, item.priceCents, item.currency ?? "EUR", t("noPrice"))}
          </p>
          {isHttpUrl(item.url) && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`mt-auto inline-flex min-h-touch-target items-center self-start rounded-button text-sm text-ink-muted underline hover:text-ink ${focusRing}`}
            >
              {t("visit", { shop: item.shopName })}
              <span className="sr-only"> — {t("visitFor", { name })}</span>
            </a>
          )}
        </div>
      </div>

      {owner && (
        <div
          data-testid="owner-opinion"
          className="flex flex-col gap-space-1 rounded-md border border-selected-line bg-selected-surface px-space-3 py-space-2 text-sm"
        >
          <p className="flex flex-wrap items-center gap-x-space-1">
            <span className="font-strong">{view.ownerName ?? tOpinions("ownerFallback")}</span>
            {ownerLevel && (
              <span>
                <span aria-hidden="true">{ownerLevel.emoji}</span> {ownerLevel.label}
              </span>
            )}
            {owner.priority && (
              <span className="rounded-full border border-line bg-surface-raised px-space-2 text-caption">
                {tOpinions("priority")}
              </span>
            )}
          </p>
          {owner.why && <p className="break-words">« {owner.why} »</p>}
        </div>
      )}

      {opinions.length > 0 && (
        <ul aria-label={tOpinions("listLabel")} className="flex flex-col gap-space-2">
          {opinions.map((opinion) => {
            const level = levelOf(view.levels, opinion.level);
            return (
              <li key={opinion.id} className="flex items-start gap-space-2 text-sm">
                <span
                  aria-hidden="true"
                  className="flex size-space-6 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-caption font-strong"
                >
                  {initialOf(opinion.name)}
                </span>
                <div className="flex min-w-space-0 flex-col">
                  <p>
                    <span className="font-strong break-words">{opinion.name}</span>{" "}
                    <span aria-hidden="true">{level.emoji}</span> {level.label}
                  </p>
                  {opinion.note && <p className="break-words">{opinion.note}</p>}
                  <time dateTime={opinion.updatedAt} suppressHydrationWarning className="text-caption text-ink-muted">
                    {relativeDate(opinion.updatedAt, now, locale)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {view.allowOpinions && (
        <button
          type="button"
          onClick={onGive}
          className={`mt-auto inline-flex min-h-touch-target items-center justify-center rounded-button border border-selected-line bg-surface-raised px-space-3 text-sm font-strong text-ink hover:bg-selected-surface ${focusRing}`}
        >
          {mine ? tOpinions("edit") : tOpinions("give")}
          <span className="sr-only"> {tOpinions("forItem", { name })}</span>
        </button>
      )}
    </li>
  );
}
