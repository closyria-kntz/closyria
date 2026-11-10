"use client";

import {
  type GiftIntent,
  type GiftRole,
  type OpinionView,
  opinionNameKey,
  type SharedGroupOrder,
  type SharedWishlistView,
} from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackToTop } from "@/components/back-to-top";
import { FriendOpinions } from "@/components/friend-opinions";
import { buttonClass, focusRing, toggleButtonClass } from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { type FriendDevice, friendDevice } from "@/lib/friend-device";
import { levelOf } from "@/lib/love-levels";
import { formatOptionalPrice } from "@/lib/price";
import {
  addGroupLine,
  deleteGroupLine,
  deleteOpinion,
  fetchSharedView,
  type GiftError,
  type GroupLineError,
  giveGift,
  leaveGift,
  putOpinion,
} from "@/lib/shared-list";
import { CoverPhoto } from "./cover-photo";
import { GiftActions, GiftBanner, GiftSheet } from "./gifts";
import { GivenItems } from "./given";
import { GroupLineSheet, type GroupLineTarget, groupErrorKey } from "./group-line-sheet";
import { GroupItemActions, GroupOrderBlock, groupOrderWritable, mineLines } from "./group-order";
import { OpinionSheet, type SheetOutcome } from "./opinion-sheet";

type Item = SharedWishlistView["items"][number];
type GroupLine = SharedGroupOrder["people"][number]["lines"][number];
type Toast = {
  id: number;
  label: string;
  undo: (() => Promise<boolean>) | null;
  /** The block that takes the focus after « Annuler » (the toast and its button go away). */
  focusId?: string;
};

/** How long « Avis envoyé · Annuler » stays (same as the app's undo toast). */
const TOAST_MS = 8_000;

/** How often a running group order is read again while the page shows (others add lines, the owner closes it). */
const GROUP_POLL_MS = 10_000;
/** …and while one of her links is being read. */
const GROUP_READING_POLL_MS = 3_000;

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
  const tFriend = useTranslations("SharedList.friend");
  const tGroup = useTranslations("SharedList.groupOrder");
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
  const [groupSheet, setGroupSheet] = useState<{ target: GroupLineTarget; session: number; open: boolean } | null>(
    null,
  );
  // A group order line being taken out (one at a time).
  const [groupBusy, setGroupBusy] = useState(false);
  // The item whose « Me retirer » is on its way (one tap only).
  const [leaving, setLeaving] = useState<string | null>(null);
  const deviceKey = useRef<string | null>(null);
  // Read with her device key yet? Until then her own gifts look like anyone's: the gift buttons wait.
  const [checked, setChecked] = useState<"pending" | "ok" | "failed">("pending");
  // The block (an item's gift or group order part, or the group order) that takes the focus once a read started
  // after the change shows (`from`: the first such read's number; an older one still on its way does not count).
  const focusAfterRead = useRef<{ id: string; from: number } | null>(null);
  // The reads of the list, numbered in the order they start: the latest started, and the one the page shows.
  const readsStarted = useRef(0);
  const readShown = useRef(0);
  const latestView = useRef<SharedWishlistView | null>(initial);
  // Everyone's lines of the group order, folded at first.
  const [groupDetail, setGroupDetail] = useState(false);
  // « Seulement {boutique} » while the group order is open.
  const [shopOnly, setShopOnly] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastCounter = useRef(0);
  // The link stopped working while she was on the page.
  const [gone, setGone] = useState(false);
  const goneTitle = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  /**
   * Reads the list again: the view, null once the link stopped working, undefined when it could not be read. Reads
   * may answer out of order (a poll started before her change, answered after it): an answer older than the one
   * shown is dropped, and the view shown is returned instead.
   */
  const reload = useCallback(async (): Promise<SharedWishlistView | null | undefined> => {
    readsStarted.current += 1;
    const read = readsStarted.current;
    try {
      // With her device key: her own gifts show as hers (the server's first paint cannot know them).
      const next = await fetchSharedView(token, deviceKey.current);
      if (read < readShown.current) return latestView.current;
      readShown.current = read;
      latestView.current = next;
      if (next) {
        setView(next);
        if (deviceKey.current) setChecked("ok");
      } else {
        setGone(true);
        setSheet(null);
        setGiftSheet(null);
        setGroupSheet(null);
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
    // Her gifts and her group order lines show as hers only after a read with her device key.
    if (!initial.gifts.open && !initial.groupOrder) return;
    void (async () => {
      // Once more on a failure; then the buttons stay off, with a word, rather than show a state that may be wrong.
      if ((await reload()) !== undefined) return;
      if ((await reload()) === undefined) setChecked((current) => (current === "ok" ? current : "failed"));
    })();
  }, [initial.gifts.open, initial.groupOrder, reload]);

  // A running group order is read again now and then while the page shows: others add lines, the owner closes it.
  const order = view.groupOrder;
  const pollMs =
    !order || order.status === "cancelled"
      ? null
      : mineLines(order).some((line) => line.status === "reading")
        ? GROUP_READING_POLL_MS
        : GROUP_POLL_MS;
  useEffect(() => {
    if (pollMs === null || gone) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, gone, reload]);

  // Back on the tab (another app, another tab): read again at once rather than at the next poll.
  useEffect(() => {
    if (gone) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [gone, reload]);

  /** Her next step after a change takes the focus once a read started from now on shows. */
  const focusAfterNextRead = (id: string) => {
    focusAfterRead.current = { id, from: readsStarted.current + 1 };
  };

  // After a change: her next step (« Me retirer », « Je lui offre »…) once the new state shows.
  useEffect(() => {
    const pending = focusAfterRead.current;
    if (!pending || !view || readShown.current < pending.from) return;
    focusAfterRead.current = null;
    // Gone from the page (she left an item taken off the list): nothing to focus.
    const block = document.getElementById(pending.id);
    if (!block) return;
    (block.querySelector<HTMLElement>("button:not([disabled])") ?? block).focus();
  }, [view]);

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

  function show(label: string, undo: Toast["undo"], focusId?: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastCounter.current += 1;
    setToast({ id: toastCounter.current, label, undo, ...(focusId ? { focusId } : {}) });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }

  async function runUndo() {
    const undo = toast?.undo;
    if (!undo) return;
    const focusId = toast.focusId;
    setToast(null);
    const ok = await undo();
    if (focusId) focusAfterNextRead(focusId);
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

  /**
   * « Ce n'est pas toi ? »: another friend on this device (a shared tablet). A new key, no name: what the previous
   * friend gave or said no longer shows as hers, and the new one gives her own name at her first opinion or gift.
   */
  async function switchFriend() {
    if (!device) return;
    const previous = deviceName;
    device.reset();
    deviceKey.current = device.key;
    setDeviceName(null);
    setSheet(null);
    setGiftSheet(null);
    setGroupSheet(null);
    title.current?.focus();
    if (previous) show(tFriend("switched", { name: previous }), null);
    await reload();
  }

  /** Given: the new state is announced (« Tu lui offres {article} ») and her next step takes the focus. */
  async function giftDone(item: Item, name: string, role: GiftRole) {
    setDeviceName(name);
    closeGiftSheet();
    const itemName = item.name?.trim() || t("noName");
    show(
      role === "contributor"
        ? tGifts("announce.contributor", { name: itemName })
        : tGifts(view.ownerName ? "announce.reserver" : "announce.reserverHidden", { name: itemName }),
      null,
    );
    focusAfterNextRead(giftBlockId(item.itemId));
    await reload();
  }

  /** « Me retirer », then « Tu t'es retirée · Annuler » (Annuler: she gives again, alongside the others). */
  async function leave(item: Item) {
    const mine = item.gift && "mine" in item.gift ? item.gift.mine : null;
    if (!device || !item.gift || !mine || leaving) return;
    // The name she gives this item under (this device may know several: « Ce n'est pas moi »).
    const name = mine.name;
    const key = device.key;
    setLeaving(item.itemId);
    const result = await leaveGift(token, item.itemId, { name, deviceKey: key });
    setLeaving(null);
    if (!result.ok) {
      show(
        tGifts(
          result.error === "rate_limited"
            ? "errors.rateLimited"
            : result.error === "no_gift"
              ? "errors.noGift"
              : "errors.failed",
        ),
        null,
      );
      void reload();
      return;
    }
    // Back in a reserved gift only: taken off the list or taken by her, there is nothing to join again.
    const undo =
      item.gift.state === "reserved"
        ? async () => (await giveGift(token, item.itemId, { name, deviceKey: key, intent: "join" })).ok
        : null;
    show(tGifts("toast.left"), undo, giftBlockId(item.itemId));
    focusAfterNextRead(giftBlockId(item.itemId));
    await reload();
  }

  const openGroupSheet = (target: GroupLineTarget) =>
    setGroupSheet((current) => ({ target, session: (current?.session ?? 0) + 1, open: true }));
  const closeGroupSheet = () => setGroupSheet((current) => current && { ...current, open: false });
  /** Where her next step is after a change to this line: its item's block, else the group order. */
  const groupFocusOf = (itemId: string | null) =>
    itemId && view.items.some((item) => item.itemId === itemId) ? groupBlockId(itemId) : GROUP_ORDER_ID;

  function editGroupLine(line: GroupLine) {
    const buyerName = view.groupOrder?.mine?.name;
    if (!buyerName) return;
    openGroupSheet({
      kind: "edit",
      lineId: line.id,
      name: line.name || t("noName"),
      buyerName,
      sizeLabel: line.sizeLabel,
      quantity: line.quantity,
      sizes: (line.itemId && view.groupOrder?.itemSizes[line.itemId]) || [],
      // Her own entry, or a link read without a price: she says (or corrects) what it is and what it costs.
      manual: line.nameable && line.status !== "reading" ? { name: line.name, priceCents: line.unitPriceCents } : null,
    });
  }

  /** Added or changed: announced, and her next step takes the focus once the list read back shows it. */
  async function groupDone(target: GroupLineTarget, name: string) {
    if (target.kind !== "edit") setDeviceName(name);
    closeGroupSheet();
    show(tGroup(target.kind === "edit" ? "toast.saved" : "toast.added"), null);
    const itemId =
      target.kind === "item"
        ? target.itemId
        : target.kind === "edit"
          ? ((view.groupOrder && mineLines(view.groupOrder).find((l) => l.id === target.lineId)?.itemId) ?? null)
          : null;
    // After a link, the focus stays where the sheet gives it back (« Ajouter un autre article »); her new line shows
    // in the detail, unfolded (it is on no item of the list).
    if (target.kind === "link") setGroupDetail(true);
    else focusAfterNextRead(groupFocusOf(itemId));
    await reload();
  }

  /** Refused: read the list again; once the order no longer takes changes, say so. */
  async function groupFailed(error: GroupLineError) {
    const next = await reload();
    if (!next) return;
    if (error === "locked" || !next.groupOrder || !groupOrderWritable(next.groupOrder)) {
      closeGroupSheet();
      show(tGroup("errors.locked"), null);
    }
  }

  /** « Retirer »: her line leaves the order. */
  async function removeGroupLine(line: GroupLine) {
    const buyerName = view.groupOrder?.mine?.name;
    if (!device || !buyerName || groupBusy) return;
    setGroupBusy(true);
    const result = await deleteGroupLine(token, line.id, { name: buyerName, deviceKey: device.key });
    setGroupBusy(false);
    if (!result.ok) {
      show(tGroup(`errors.${groupErrorKey(result.error)}`), null);
      void reload();
      return;
    }
    // « Annuler » takes the same item back, in the same size and quantity (a link's address is not on the page).
    const itemId = line.itemId;
    const key = device.key;
    const undo = itemId
      ? async () =>
          (
            await addGroupLine(token, {
              source: "item",
              itemId,
              sizeLabel: line.sizeLabel,
              quantity: line.quantity,
              name: buyerName,
              deviceKey: key,
            })
          ).ok
      : null;
    show(tGroup("toast.removed"), undo, groupFocusOf(itemId));
    focusAfterNextRead(groupFocusOf(itemId));
    await reload();
  }

  // « Seulement {boutique} »: while friends may still add to the order, and when some item is of its shop.
  const filterOrder =
    order && groupOrderWritable(order) && view.items.some((item) => order.eligibleItemIds.includes(item.itemId))
      ? order
      : null;
  const shownItems =
    filterOrder && shopOnly
      ? view.items.filter((item) => filterOrder.eligibleItemIds.includes(item.itemId))
      : view.items;

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
        <h1 ref={title} tabIndex={-1} className="font-display text-title font-strong focus:outline-none">
          {view.name}
        </h1>
        <p className="text-ink-muted">{view.allowOpinions ? t("invite") : tOpinions("closed")}</p>
        {device && deviceName && (
          <p data-testid="friend-switch" className="flex flex-wrap items-center gap-x-space-1 text-sm text-ink-muted">
            <span>{tFriend("youAre", { name: deviceName })}</span>
            <button
              type="button"
              onClick={() => void switchFriend()}
              className={`rounded-button px-space-2 text-accent underline min-h-touch-target ${focusRing}`}
            >
              {tFriend("switch")}
            </button>
          </p>
        )}
      </header>

      {view.groupOrder && (
        <GroupOrderBlock
          order={view.groupOrder}
          noName={t("noName")}
          canAct={device !== null && !view.viewerIsOwner}
          busy={groupBusy}
          detailOpen={groupDetail}
          onToggleDetail={() => setGroupDetail((open) => !open)}
          onAdd={() => openGroupSheet({ kind: "link" })}
          onEdit={editGroupLine}
          onRemove={(line) => void removeGroupLine(line)}
        />
      )}

      <GiftBanner gifts={view.gifts} ownerName={view.ownerName} />

      {view.gifts.open && view.viewerIsOwner && (
        <p data-testid="owner-gifts-note" className="self-start text-ink-muted">
          {tGifts("ownerNote")}
        </p>
      )}

      {view.budget && (
        <p className="flex items-center justify-between gap-space-3 self-start rounded-card border-2 border-selected-line bg-surface-raised px-space-4 py-space-3 font-strong tabular-nums">
          {t("budget", { amount: formatAmount(locale, view.budget.amountCents, view.budget.currency) })}
        </p>
      )}

      {filterOrder && (
        <div className="flex flex-wrap gap-space-2">
          <button
            type="button"
            aria-pressed={!shopOnly}
            onClick={() => setShopOnly(false)}
            className={toggleButtonClass}
          >
            {tGroup("filterAll")}
          </button>
          <button type="button" aria-pressed={shopOnly} onClick={() => setShopOnly(true)} className={toggleButtonClass}>
            {tGroup("filterShop", { shop: filterOrder.shopName })}
          </button>
        </div>
      )}

      {view.items.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <ul
          aria-label={t("itemsLabel")}
          data-testid="shared-items"
          className="grid grid-cols-1 items-start gap-space-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {shownItems.map((item) => (
            <ItemCard
              key={item.itemId}
              item={item}
              view={view}
              deviceName={device ? deviceName : null}
              onGive={() =>
                setSheet((current) => ({ itemId: item.itemId, session: (current?.session ?? 0) + 1, open: true }))
              }
              giftsChecked={checked}
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
              groupCanAct={device !== null && !view.viewerIsOwner}
              groupBusy={groupBusy}
              onGroupTake={() =>
                openGroupSheet({
                  kind: "item",
                  itemId: item.itemId,
                  name: item.name?.trim() || t("noName"),
                  sizes: view.groupOrder?.itemSizes[item.itemId] ?? [],
                })
              }
              onGroupEdit={editGroupLine}
              onGroupRemove={(line) => void removeGroupLine(line)}
            />
          ))}
        </ul>
      )}

      {view.gifts.open && <GivenItems items={view.givenItems} />}

      {device && groupSheet && view.groupOrder && (
        <GroupLineSheet
          key={groupSheet.session}
          open={groupSheet.open}
          onClose={closeGroupSheet}
          token={token}
          target={groupSheet.target}
          shopName={view.groupOrder.shopName}
          currency={view.groupOrder.currency}
          knownNames={knownNames(view)}
          device={device}
          onDone={({ name }) => void groupDone(groupSheet.target, name)}
          onFailed={(error) => void groupFailed(error)}
        />
      )}

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
          onDone={({ name, role }) => void giftDone(giftItem, name, role)}
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
        aria-label={t("toastLabel")}
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

      <BackToTop />
    </>
  );
}

function ItemCard({
  item,
  view,
  deviceName,
  onGive,
  giftsChecked,
  leaving,
  onGift,
  onLeave,
  groupCanAct,
  groupBusy,
  onGroupTake,
  onGroupEdit,
  onGroupRemove,
}: {
  item: Item;
  view: SharedWishlistView;
  deviceName: string | null;
  onGive: () => void;
  giftsChecked: "pending" | "ok" | "failed";
  leaving: boolean;
  onGift: (intent: GiftIntent) => void;
  onLeave: () => void;
  groupCanAct: boolean;
  groupBusy: boolean;
  onGroupTake: () => void;
  onGroupEdit: (line: GroupLine) => void;
  onGroupRemove: (line: GroupLine) => void;
}) {
  const t = useTranslations("SharedList");
  const tOpinions = useTranslations("SharedList.opinions");
  const locale = useLocale();
  const name = item.name?.trim() || t("noName");
  const mine = deviceName !== null && item.opinions.some((o) => opinionNameKey(o.name) === opinionNameKey(deviceName));
  const owner = item.ownerOpinion;
  const ownerLevel = owner?.level ? levelOf(view.levels, owner.level) : null;
  // Her own link: no gift part at all (the page says why once, under the banner).
  const gift = view.gifts.open && !view.viewerIsOwner ? item.gift : null;
  // Taken off her list while this device gives it: shown to her only, struck through.
  const removed = gift?.state === "removed";
  // « Je le prends aussi » on the items of the group order's shop (spec §3.2); never on a cancelled one.
  const groupOrder = view.groupOrder;
  const inGroupOrder =
    groupOrder !== null && groupOrder.status !== "cancelled" && groupOrder.eligibleItemIds.includes(item.itemId);

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
        blockId={giftBlockId(item.itemId)}
        checked={giftsChecked}
        busy={leaving}
        onGive={onGift}
        onLeave={onLeave}
      />

      {inGroupOrder && !removed && (
        <GroupItemActions
          itemName={name}
          order={groupOrder}
          lines={mineLines(groupOrder).filter((line) => line.itemId === item.itemId)}
          blockId={groupBlockId(item.itemId)}
          canAct={groupCanAct}
          busy={groupBusy}
          onTake={onGroupTake}
          onEdit={onGroupEdit}
          onRemove={onGroupRemove}
        />
      )}

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

const giftBlockId = (itemId: string) => `gift-${itemId}`;
const groupBlockId = (itemId: string) => `group-${itemId}`;
/** The group order block's id (its `<section>` in group-order.tsx). */
const GROUP_ORDER_ID = "group-order";

/** Every name on the list (opinions and gifts), as written there: how « Une Léa… » spells a name already used. */
function knownNames(view: SharedWishlistView): string[] {
  return view.items
    .flatMap((item) => {
      const gift = item.gift;
      const givers =
        gift?.state === "reserved"
          ? [gift.reserver, ...gift.contributors]
          : gift?.state === "owner_took"
            ? gift.givers
            : [];
      return [...item.opinions.map((o) => o.name), ...givers];
    })
    .concat(view.groupOrder?.people.filter((p) => !p.isOwner).map((p) => p.name) ?? []);
}
