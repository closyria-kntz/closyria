"use client";

import { type GiftIntent, type OpinionView, opinionNameKey, type SharedWishlistView } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { FriendOpinions } from "@/components/friend-opinions";
import { buttonClass, focusRing } from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { type FriendDevice, friendDevice } from "@/lib/friend-device";
import { levelOf } from "@/lib/love-levels";
import { formatOptionalPrice } from "@/lib/price";
import { deleteOpinion, fetchSharedView, type GiftError, giveGift, leaveGift, putOpinion } from "@/lib/shared-list";
import { CoverPhoto } from "./cover-photo";
import { GiftActions, GiftBanner, GiftSheet } from "./gifts";
import { GivenItems } from "./given";
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

/**
 * The shared list as a friend sees it (spec §3): the owner's opinion on each item, the friends' opinions, and
 * « Donner mon avis ». Read on the server for the first paint, read again here after each change.
 */
export function SharedListView({ token, initial }: { token: string; initial: SharedWishlistView }) {
  const t = useTranslations("SharedList");
  const tOpinions = useTranslations("SharedList.opinions");
  const tGone = useTranslations("SharedList.notFound");
  const tGifts = useTranslations("SharedList.gifts");
  const locale = useLocale();
  const [view, setView] = useState(initial);
  // Made in the browser only (local storage): before that, no « Modifier mon avis ».
  const [device, setDevice] = useState<FriendDevice | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ itemId: string; session: number; open: boolean } | null>(null);
  const [giftSheet, setGiftSheet] = useState<{
    itemId: string;
    intent: GiftIntent;
    session: number;
    open: boolean;
  } | null>(null);
  // The item whose « Me retirer » is on its way (one tap only).
  const [leaving, setLeaving] = useState<string | null>(null);
  const deviceKey = useRef<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastCounter = useRef(0);
  // The link stopped working while she was on the page.
  const [gone, setGone] = useState(false);
  const goneTitle = useRef<HTMLHeadingElement>(null);

  /** Reads the list again: the view, null once the link stopped working, undefined when it could not be read. */
  const reload = useCallback(async (): Promise<SharedWishlistView | null | undefined> => {
    try {
      // With her device key: her own gifts show as hers (the server's first paint cannot know them).
      const next = await fetchSharedView(token, deviceKey.current);
      if (next) setView(next);
      else {
        setGone(true);
        setSheet(null);
        setGiftSheet(null);
        setToast(null);
      }
      return next;
    } catch {
      // The page keeps what it shows; the next change reads it again.
      return undefined;
    }
  }, [token]);

  useEffect(() => {
    const made = friendDevice(localStorageOrNull());
    deviceKey.current = made.key;
    setDevice(made);
    setDeviceName(made.name);
    if (initial.gifts.open) void reload();
  }, [initial.gifts.open, reload]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (gone) goneTitle.current?.focus();
  }, [gone]);

  const closeSheet = () => setSheet((current) => current && { ...current, open: false });

  /** A write was refused: what the page shows may be out of date (link stopped, opinions closed, item gone). */
  async function failed(itemId: string) {
    const next = await reload();
    if (!next) return;
    if (!next.allowOpinions) {
      closeSheet();
      show(tOpinions("closed"), null);
    } else if (!next.items.some((item) => item.itemId === itemId)) {
      closeSheet();
      show(tOpinions("errors.gone"), null);
    }
  }

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
    closeSheet();
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

  const closeGiftSheet = () => setGiftSheet((current) => current && { ...current, open: false });

  /** A gift was refused: read the list again; when the list closed or the item went, say so. */
  async function giftFailed(itemId: string, error: GiftError | "already_reserved") {
    const next = await reload();
    if (!next || error === "already_reserved") return;
    if (!next.gifts.open) {
      closeGiftSheet();
      show(tGifts("errors.closed"), null);
    } else if (!next.items.some((item) => item.itemId === itemId)) {
      closeGiftSheet();
      show(tGifts("errors.gone"), null);
    }
  }

  function giftDone(name: string) {
    setDeviceName(name);
    closeGiftSheet();
    void reload();
  }

  /** « Me retirer », then « Tu t'es retirée · Annuler » (Annuler: she gives again, alongside the others). */
  async function leave(item: Item) {
    if (!device?.name || !item.gift || leaving) return;
    const name = device.name;
    const key = device.key;
    setLeaving(item.itemId);
    const result = await leaveGift(token, item.itemId, { name, deviceKey: key });
    setLeaving(null);
    if (!result.ok) {
      show(tGifts(result.error === "rate_limited" ? "errors.rateLimited" : "errors.failed"), null);
      void reload();
      return;
    }
    // Back in a reserved gift only: taken off the list or taken by her, there is nothing to join again.
    const undo =
      item.gift.state === "reserved"
        ? async () => (await giveGift(token, item.itemId, { name, deviceKey: key, intent: "join" })).ok
        : null;
    show(tGifts("toast.left"), undo);
    void reload();
  }

  const giftItem = giftSheet ? view.items.find((item) => item.itemId === giftSheet.itemId) : undefined;
  const sheetItem = sheet ? view.items.find((item) => item.itemId === sheet.itemId) : undefined;

  if (gone) {
    return (
      <section className="flex flex-col gap-space-4 py-space-6">
        <h1 ref={goneTitle} tabIndex={-1} className="font-display text-title font-strong focus:outline-none">
          {tGone("title")}
        </h1>
        <p className="text-ink-muted">{tGone("body")}</p>
      </section>
    );
  }

  return (
    <>
      <header className="flex flex-col gap-space-2">
        <p className="font-display text-lead font-strong text-accent">
          {view.ownerName ? t("ownerList", { name: view.ownerName }) : t("metadata")}
        </p>
        <h1 className="font-display text-title font-strong">{view.name}</h1>
        <p className="text-ink-muted">{view.allowOpinions ? t("invite") : tOpinions("closed")}</p>
      </header>

      <GiftBanner gifts={view.gifts} ownerName={view.ownerName} />

      {view.budget && (
        <p className="flex items-center justify-between gap-space-3 self-start rounded-card border-2 border-selected-line bg-surface-raised px-space-4 py-space-3 font-strong tabular-nums">
          {t("budget", { amount: formatAmount(locale, view.budget.amountCents, view.budget.currency) })}
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
              giftsReady={device !== null}
              leaving={leaving === item.itemId}
              onGift={(intent) =>
                setGiftSheet((current) => ({
                  itemId: item.itemId,
                  intent,
                  session: (current?.session ?? 0) + 1,
                  open: true,
                }))
              }
              onLeave={() => void leave(item)}
            />
          ))}
        </ul>
      )}

      {view.gifts.open && <GivenItems items={view.givenItems} />}

      {device && giftSheet && giftItem && (
        <GiftSheet
          key={giftSheet.session}
          open={giftSheet.open}
          onClose={closeGiftSheet}
          token={token}
          item={{ itemId: giftItem.itemId, name: giftItem.name?.trim() || t("noName") }}
          intent={giftSheet.intent}
          ownerName={view.ownerName}
          knownNames={knownNames(view)}
          device={device}
          onDone={({ name }) => giftDone(name)}
          onFailed={(error) => void giftFailed(giftItem.itemId, error)}
        />
      )}

      {device && sheet && sheetItem && (
        <OpinionSheet
          key={sheet.session}
          open={sheet.open}
          onClose={closeSheet}
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
          onFailed={() => void failed(sheetItem.itemId)}
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
  giftsReady,
  leaving,
  onGift,
  onLeave,
}: {
  item: Item;
  view: SharedWishlistView;
  deviceName: string | null;
  onGive: () => void;
  /** Her device is known (browser only): before that, the gift buttons wait. */
  giftsReady: boolean;
  leaving: boolean;
  onGift: (intent: GiftIntent) => void;
  onLeave: () => void;
}) {
  const t = useTranslations("SharedList");
  const tOpinions = useTranslations("SharedList.opinions");
  const locale = useLocale();
  const name = item.name?.trim() || t("noName");
  const mine = deviceName !== null && item.opinions.some((o) => opinionNameKey(o.name) === opinionNameKey(deviceName));
  const owner = item.ownerOpinion;
  const ownerLevel = owner?.level ? levelOf(view.levels, owner.level) : null;
  const gift = view.gifts.open ? item.gift : null;
  // Taken off her list while this device gives it: shown to her only, struck through.
  const removed = gift?.state === "removed";

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
          <h2 className={`font-strong break-words ${removed ? "text-ink-muted line-through" : ""}`}>{name}</h2>
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

      <FriendOpinions opinions={item.opinions} levels={view.levels} />

      <GiftActions
        itemName={name}
        gift={gift}
        size={item.size}
        ownerName={view.ownerName}
        busy={!giftsReady || leaving}
        onGive={onGift}
        onLeave={onLeave}
      />

      {view.allowOpinions && !removed && (
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

/** Every name on the list (opinions and gifts), as written there: how « Une Léa… » spells a name already used. */
function knownNames(view: SharedWishlistView): string[] {
  return view.items.flatMap((item) => {
    const gift = item.gift;
    const givers =
      gift?.state === "reserved"
        ? [gift.reserver, ...gift.contributors]
        : gift?.state === "owner_took"
          ? gift.givers
          : [];
    return [...item.opinions.map((o) => o.name), ...givers];
  });
}
