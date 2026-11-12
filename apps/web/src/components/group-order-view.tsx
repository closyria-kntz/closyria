"use client";

import { GROUP_ORDER_SIZE_LABEL_MAX, type GroupOrderOrder, type OwnerGroupOrder } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { formatAmount } from "@/lib/budget";
import { confirmUnlessReserved } from "@/lib/gift-check";
import { absoluteShareUrl } from "@/lib/share-link";
import { pushUndo } from "@/lib/undo";
import {
  actOnGroupOrder,
  addOwnGroupLink,
  type ClientError,
  fetchGroupOrder,
  fetchGroupOrderById,
  fetchShareLink,
  type GroupOrderResult,
  orderGroupOrder,
  patchGroupOrder,
  putOwnGroupLines,
  removeGroupLine,
  restoreGroupLine,
  setGroupPayment,
} from "@/lib/wardrobe-client";
import { BackToTop } from "./back-to-top";
import { Dialog } from "./dialog";
import {
  centsToField,
  chosenDelivery,
  groupOrderErrorKey,
  OTHER_DELIVERY,
  parisToday,
  ShippingChoice,
  type ShippingDraft,
  useShopShippingOptions,
} from "./group-order-open-dialog";
import { GroupOrderOrderedDialog } from "./group-order-ordered-dialog";
import { ProgressBar } from "./progress-bar";
import { ShareSheet } from "./share-sheet";
import { buttonClass, focusRing, initialClass, inputClass, moreButtonClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";
/** The summary's kicker (mockup .k) and its two buttons (mockup .btn.pri and .btn, 44 px). */
const kickerClass = "text-meta font-bold tracking-wide text-une-ink uppercase";
const boxPrimaryClass = `inline-flex min-h-touch-target items-center justify-center rounded-pill bg-button-bg px-space-3 py-space-1-5 text-center text-sm leading-tight font-bold text-button-ink disabled:opacity-60 ${focusRing}`;
const boxOutlineClass = `inline-flex min-h-touch-target items-center justify-center rounded-pill border-2 border-ink px-space-3 py-space-1-5 text-center text-sm leading-tight font-bold text-ink hover:bg-surface-strong disabled:opacity-60 ${focusRing}`;
/** Read again this often while the page shows and the order may still change (friends add, she is elsewhere). */
export const GROUP_ORDER_POLL_MS = 10_000;
const QUANTITIES = [1, 2, 3, 4, 5] as const;

type Order = OwnerGroupOrder;
type Person = Order["people"][number];
type Line = Person["lines"][number];
type Own = Map<string, { sizeLabel: string | null; quantity: number }>;
/** Runs one of her changes; `quiet`: its refusal is shown where she made it, not at the top of the page. */
type Change = (run: () => Promise<GroupOrderResult>, quiet?: boolean) => Promise<GroupOrderResult>;
type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "ready"; order: Order };

/** « 12 mars »: a `YYYY-MM-DD` day as such. */
const dayOf = (locale: string, date: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(/ /g, " ");
/** « 10 novembre »: the day of a moment, in Paris. */
export const parisDayOf = (locale: string, at: string) =>
  new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Paris" })
    .format(new Date(at))
    .replace(/ /g, " ");

const running = (order: Order) => order.status === "open" || order.status === "closed";

const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** Her own lines as she ticked them: item → size and quantity. */
function ownOf(order: Order): Own {
  const own: Own = new Map();
  for (const person of order.people) {
    if (!person.isOwner) continue;
    for (const line of person.lines)
      if (line.removedAt === null && line.itemId !== null && !own.has(line.itemId))
        own.set(line.itemId, { sizeLabel: line.sizeLabel, quantity: line.quantity });
  }
  return own;
}

/**
 * Her group order of a list (spec § 4.2): the shop, the delivery, the deadline, the way to free shipping and the
 * state; « Toi » (her items of the shop to tick); one block per friend (« Retirer », then « Payé »); the actions of
 * the state. Read again every 10 s while the page shows and the order is open or closed; the amounts are the API's.
 */
export function GroupOrderView({
  listId,
  orderId = null,
}: {
  listId: string;
  /** A given order of the list (a past one): shown as it is, only « Payé » can change. */
  orderId?: string | null;
}) {
  const t = useTranslations("GroupOrder");
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Answers arrive in any order (a read every 10 s, her changes): only one newer than the last applied is kept.
  const sent = useRef(0);
  const applied = useRef(0);

  const take = useCallback(
    (seq: number, result: GroupOrderResult): boolean => {
      if (seq < applied.current) return false;
      applied.current = seq;
      // An order of another list behind this address: as if there were none.
      if (result.ok && result.order.wishlistId !== listId) setState({ status: "missing" });
      else if (result.ok) setState({ status: "ready", order: result.order });
      else if (result.error === "not_found") setState({ status: "missing" });
      return true;
    },
    [listId],
  );

  const load = useCallback(
    async (quiet: boolean) => {
      const seq = ++sent.current;
      const result = orderId ? await fetchGroupOrderById(orderId) : await fetchGroupOrder(listId);
      if (!result.ok && result.error !== "not_found") {
        // A failed read in the background leaves the page as it was.
        if (!quiet && seq >= applied.current) setState({ status: "error" });
        return;
      }
      take(seq, result);
    },
    [listId, orderId, take],
  );

  /** A change she made: its answer is the whole order (or an error code for the message). */
  const change = useCallback<Change>(
    async (run, quiet = false) => {
      const seq = ++sent.current;
      const result = await run();
      if (result.ok) {
        take(seq, result);
        setError(null);
        return result;
      }
      if (!quiet) setError(t(`errors.${groupOrderErrorKey(result.error)}`));
      // Refused because it changed elsewhere: the page catches up.
      if (result.error !== "failed") void load(true);
      return result;
    },
    [take, load, t],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const order = state.status === "ready" ? state.order : null;
  const live = order !== null && running(order);
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, GROUP_ORDER_POLL_MS);
    const onReturn = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [live, load]);

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
        <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load(false)}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <section className="flex max-w-measure flex-col items-start gap-space-3">
        <h1 className="font-display text-title font-strong">{t("missing.title")}</h1>
        <p className="text-ink-muted">{t("missing.body")}</p>
        <Link href={`/listes/${listId}`} className={`${primaryButtonClass} ${touch}`}>
          {t("back")}
        </Link>
      </section>
    );
  }

  return (
    <Ready
      order={state.order}
      listId={listId}
      pinned={orderId !== null}
      error={error}
      busy={busy}
      setBusy={setBusy}
      change={change}
    />
  );
}

function Ready({
  order,
  listId,
  pinned,
  error,
  busy,
  setBusy,
  change,
}: {
  order: Order;
  listId: string;
  /** Opened by its id from the past ones: read-only, but for « Payé ». */
  pinned: boolean;
  error: string | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  change: Change;
}) {
  const t = useTranslations("GroupOrder");
  const locale = useLocale();
  const money = (cents: number) => formatAmount(locale, cents, order.currency);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [editing, setEditing] = useState(false);
  // `keep`: she chose « Attendre » in the 🎁 window; the next « J'ai commandé » shows what she had typed.
  const [ordered, setOrdered] = useState<{ open: boolean; key: number; error: string | null; keep: boolean }>({
    open: false,
    key: 0,
    error: null,
    keep: false,
  });
  const editable = running(order) && !pinned;
  // Her own lines still being saved: « J'ai commandé » waits for them (it would order what she had before).
  const [saving, setSaving] = useState(false);
  const blocked = busy || saving;

  const shop = order.shop.name;
  const title = order.deadline ? t("titleDate", { shop, date: dayOf(locale, order.deadline) }) : t("title", { shop });
  const delivery =
    order.shipping.freeFromCents === null
      ? t("delivery", { label: order.shipping.label, shipping: money(order.shipping.shippingCents) })
      : t("deliveryThreshold", {
          label: order.shipping.label,
          shipping: money(order.shipping.shippingCents),
          threshold: money(order.shipping.freeFromCents),
        });
  const remaining = order.totals.remainingForFreeCents;
  const friends = order.people.filter((person) => !person.isOwner);
  const owed = friends.flatMap((person) => (person.payment ? [person.payment] : []));
  const settled = order.status === "ordered" && owed.length > 0 && owed.every((payment) => payment.paidAt !== null);
  const pastDeadline = order.status === "open" && order.deadline !== null && order.deadline < parisToday();
  const stateText =
    order.status === "cancelled"
      ? t("state.cancelled")
      : order.status === "ordered"
        ? t("state.ordered", { date: order.orderedAt ? parisDayOf(locale, order.orderedAt) : "" })
        : order.status === "closed"
          ? t("state.closed")
          : pastDeadline
            ? t("state.openPastDeadline")
            : t("state.open");
  // Once ordered (or cancelled, or a past one): what it came to, items and shipping (frozen at « J'ai commandé »).
  const grandTotal = money(order.totals.totalCents + order.totals.shippingTotalCents);

  // « Partager le message » while it is open: the list's link to send to her friends (none for a link of before), in
  // the share window (task 9), whose first choice copies the whole message.
  const inviting = order.status === "open" && !pinned;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [noLink, setNoLink] = useState(false);
  useEffect(() => {
    if (!inviting) return;
    let live = true;
    void fetchShareLink(listId).then((result) => {
      if (!live || !result.ok) return;
      if (result.url) setShareUrl(absoluteShareUrl(window.location.origin, result.url));
      else setNoLink(true);
    });
    return () => {
      live = false;
    };
  }, [inviting, listId]);
  const invitation =
    shareUrl === null
      ? null
      : order.deadline
        ? t("copy.messageText", { shop, date: dayOf(locale, order.deadline), link: shareUrl })
        : t("copy.messageTextNoDate", { shop, link: shareUrl });

  async function act(action: "close" | "reopen" | "cancel") {
    setBusy(true);
    await change(() => actOnGroupOrder(order.id, action));
    setBusy(false);
  }

  /** « J'ai commandé » validated: her ticked items are asked about first (🎁), then the order is sent. */
  async function sendOrder(body: GroupOrderOrder) {
    if (saving) return;
    setOrdered((previous) => ({ ...previous, open: false, error: null }));
    const itemIds = [...ownOf(order).keys()];
    if (!(await confirmUnlessReserved(itemIds, "order"))) {
      setOrdered((previous) => ({ ...previous, keep: true }));
      return;
    }
    setBusy(true);
    const result = await change(() => orderGroupOrder(order.id, body), true);
    setBusy(false);
    if (!result.ok)
      setOrdered((previous) => ({
        ...previous,
        open: true,
        error: t(`errors.${groupOrderErrorKey(result.error)}`),
      }));
  }

  // The summary's line (mockup commandeG(): « Plus que 8,50 € pour la livraison offerte · jusqu'au 20 novembre »).
  const way =
    remaining === null
      ? t("summary.shared", { shipping: money(order.shipping.shippingCents) })
      : remaining > 0
        ? t("summary.remaining", { remaining: money(remaining) })
        : t("summary.free");
  const wayLine = order.deadline ? `${way} · ${t("summary.until", { date: dayOf(locale, order.deadline) })}` : way;
  const share =
    remaining === null
      ? null
      : remaining > 0
        ? (order.totals.totalCents / (order.totals.totalCents + remaining)) * 100
        : 100;
  const orderedButton = (primary: boolean) => (
    <button
      type="button"
      disabled={blocked}
      onClick={() =>
        setOrdered((previous) => ({
          open: true,
          key: previous.keep ? previous.key : previous.key + 1,
          error: null,
          keep: false,
        }))
      }
      className={primary ? boxPrimaryClass : boxOutlineClass}
    >
      {t("actions.ordered")}
    </button>
  );

  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      <Link
        href={`/listes/${listId}`}
        className={`self-start rounded-button text-sm text-accent ${touch} inline-flex items-center ${focusRing}`}
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t("back")}
      </Link>

      {/* Phone: title, summary, people. Computer: the people on the left, the summary on the right (mockup). */}
      <div className="grid items-start gap-space-3-5 lg:grid-cols-(--grid-order) lg:gap-x-space-6">
        <h1 className="font-title text-page-title leading-tight break-words lg:col-start-1">{title}</h1>

        <section
          aria-label={t("summary.kicker", { shop })}
          className="flex flex-col gap-space-2 rounded-card bg-surface-sunken p-space-3-5 lg:sticky lg:top-space-4 lg:col-start-2 lg:row-span-3 lg:row-start-1"
        >
          <p className={kickerClass}>{t("summary.kicker", { shop })}</p>
          {editable ? (
            <p className="font-title text-stat leading-none tabular-nums">{money(order.totals.totalCents)}</p>
          ) : (
            <p data-testid="group-total" className="font-title text-stat leading-none tabular-nums">
              {grandTotal}
            </p>
          )}
          {editable && share !== null && <ProgressBar share={share} />}
          {editable && <p className="text-sm tabular-nums">{wayLine}</p>}
          <p className="text-meta text-ink-muted tabular-nums">{delivery}</p>
          <p data-testid="group-state" className="text-sm font-bold">
            {stateText}
          </p>
          {settled && <p className="text-sm font-bold text-une-ink">{t("state.settled")}</p>}
          {editable && (
            <div className="grid grid-cols-2 gap-space-2">
              {order.status === "open" ? (
                <button type="button" disabled={busy} onClick={() => void act("close")} className={boxPrimaryClass}>
                  {t("actions.close")}
                </button>
              ) : (
                orderedButton(true)
              )}
              {inviting && invitation && shareUrl ? (
                <button type="button" onClick={() => setInviteOpen(true)} className={boxOutlineClass}>
                  {t("copy.message")}
                </button>
              ) : order.status === "open" ? (
                orderedButton(false)
              ) : (
                <button type="button" disabled={busy} onClick={() => void act("reopen")} className={boxOutlineClass}>
                  {t("actions.reopen")}
                </button>
              )}
            </div>
          )}
          {inviting && invitation && shareUrl && (
            <ShareSheet
              open={inviteOpen}
              onClose={() => setInviteOpen(false)}
              title={title}
              text={invitation}
              url={shareUrl}
              copy="message"
            />
          )}
          {inviting && !invitation && noLink && (
            <p data-testid="group-no-link" className="text-meta text-ink-muted">
              {t("copy.noLink")}
            </p>
          )}
          {editable && (
            <div className="flex flex-col items-start">
              {order.status === "open" && inviting && invitation && shareUrl && (
                <div className="mb-space-1 grid w-full">{orderedButton(false)}</div>
              )}
              <button type="button" disabled={busy} onClick={() => setEditing(true)} className={moreButtonClass}>
                {t("actions.edit")}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmCancel(true)} className={moreButtonClass}>
                {t("actions.cancel")}
              </button>
            </div>
          )}
        </section>

        <div className="flex min-w-space-0 flex-col gap-space-3-5 lg:col-start-1">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <MeBlock order={order} editable={editable} money={money} change={change} onSaving={setSaving} />

          {friends.length === 0 ? (
            <p className="max-w-measure text-sm text-ink-muted">{t("friends.empty")}</p>
          ) : (
            friends.map((person) => (
              <FriendBlock
                key={person.key}
                order={order}
                person={person}
                editable={editable}
                busy={busy}
                money={money}
                change={change}
              />
            ))
          )}
        </div>
      </div>

      <GroupOrderOrderedDialog
        open={ordered.open}
        resetKey={ordered.key}
        order={order}
        error={ordered.error}
        busy={blocked}
        onClose={() => setOrdered((previous) => ({ ...previous, open: false }))}
        onConfirm={(body) => void sendOrder(body)}
      />
      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t("cancel.title")}
        closeLabel={t("open.close")}
      >
        <p className="text-ink-muted">{t("cancel.body")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setConfirmCancel(false);
              void act("cancel");
            }}
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("cancel.confirm")}
          </button>
          <button type="button" onClick={() => setConfirmCancel(false)} className={`${buttonClass} ${touch}`}>
            {t("cancel.keep")}
          </button>
        </div>
      </Dialog>
      <EditDialog open={editing} order={order} onClose={() => setEditing(false)} change={change} />
      <BackToTop />
    </div>
  );
}

/**
 * A person's tile (mockup .tile), named by its heading (« Toi », a friend's name): her initial, her name and what she
 * owes on a price tag, then her lines.
 */
function Block({
  title,
  tag,
  settled = false,
  children,
}: {
  title: string;
  tag: string | null;
  /** Paid: the tag goes quiet (muted, no hole). */
  settled?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-space-2-5 rounded-card bg-surface-raised p-space-3-5">
      <div className="flex items-center gap-space-2">
        <span aria-hidden="true" className={initialClass}>
          {title.trim().charAt(0).toLocaleUpperCase()}
        </span>
        <h2 id={id} className="min-w-space-0 flex-1 text-chip font-bold break-words">
          {title}
        </h2>
        {tag &&
          (settled ? (
            <span
              data-testid="paid-tag"
              className="shrink-0 rounded-pill bg-surface-sunken px-space-2-5 py-space-0-75 text-chip font-bold text-ink-muted tabular-nums"
            >
              {tag}
            </span>
          ) : (
            <span className="price-tag shrink-0 tabular-nums">{tag}</span>
          ))}
      </div>
      {children}
    </section>
  );
}

/** « Articles {items} + port {port} = {total} » of one person, as the API split it. */
function Totals({ order, personKey, money }: { order: Order; personKey: string; money: (cents: number) => string }) {
  const t = useTranslations("GroupOrder");
  const share = order.totals.perPerson[personKey];
  if (!share) return null;
  return (
    <p className="text-meta text-ink-muted tabular-nums">
      {t("totals", {
        items: money(share.itemsCents),
        shipping: money(share.shippingCents),
        total: money(share.totalCents),
      })}
    </p>
  );
}

/**
 * « Toi »: her items of the list from this shop, each to tick (« Je le prends dans cette commande ») with its size and
 * quantity. Every change sends all her lines, one save after the other; what she ticked shows until the API answers.
 * While it runs, « Ajouter un autre article »: a link of the shop goes to her wishes, the list and her lines (ticked).
 */
function MeBlock({
  order,
  editable,
  money,
  change,
  onSaving,
}: {
  order: Order;
  editable: boolean;
  money: (cents: number) => string;
  change: Change;
  /** True from her first change until the last of her saves is answered. */
  onSaving: (saving: boolean) => void;
}) {
  const t = useTranslations("GroupOrder");
  const tShared = useTranslations("SharedList.groupOrder");
  const id = useId();
  const [pending, setPending] = useState<Own | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const [link, setLink] = useState("");
  const [size, setSize] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const own = pending ?? ownOf(order);
  const owner = order.people.find((person) => person.isOwner);
  const lineOf = new Map(
    (owner?.lines ?? []).filter((line) => line.removedAt === null).map((line) => [line.itemId, line]),
  );

  function save(next: Own) {
    setPending(next);
    waiting.current += 1;
    onSaving(true);
    const lines = [...next].map(([itemId, value]) => ({ itemId, ...value }));
    queue.current = queue.current.then(async () => {
      await change(() => putOwnGroupLines(order.id, { lines }));
      waiting.current -= 1;
      if (waiting.current === 0) {
        setPending(null);
        onSaving(false);
      }
    });
  }
  /** The refusal of her link, in the words of the friends' « Ajouter un autre article ». */
  function linkErrorOf(error: ClientError): string {
    switch (error) {
      case "not_in_shop":
        return tShared("errors.notInShop", { shop: order.shop.name });
      case "too_many_lines":
        return tShared("errors.tooMany");
      case "rate_limited":
        return tShared("errors.rateLimited");
      case "invalid_request":
        return tShared("errors.link");
      default:
        return t(`errors.${groupOrderErrorKey(error)}`);
    }
  }

  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (adding) return;
    const url = link.trim();
    if (!isHttpUrl(url)) {
      setLinkError(tShared("errors.link"));
      linkInput.current?.focus();
      return;
    }
    setLinkError(null);
    setAdding(true);
    waiting.current += 1;
    onSaving(true);
    const body = { url, sizeLabel: size.trim() === "" ? null : size.trim(), quantity };
    // After her saves still on their way: each of them sends all her lines, this one among them once it is answered.
    const sent = queue.current.then(() => change(() => addOwnGroupLink(order.id, body), true));
    queue.current = sent;
    const result = await sent;
    waiting.current -= 1;
    if (waiting.current === 0) {
      setPending(null);
      onSaving(false);
    }
    setAdding(false);
    if (result.ok) {
      setLink("");
      setSize("");
      setQuantity(1);
    } else setLinkError(linkErrorOf(result.error));
    linkInput.current?.focus();
  }

  const update = (itemId: string, value: { sizeLabel: string | null; quantity: number } | null) => {
    const next = new Map(own);
    if (value) next.set(itemId, value);
    else next.delete(itemId);
    save(next);
  };

  return (
    <Block
      title={t("me.title")}
      tag={
        owner && order.totals.perPerson[owner.key] ? money(order.totals.perPerson[owner.key]?.totalCents ?? 0) : null
      }
    >
      {order.ownItems.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("me.empty", { shop: order.shop.name })}</p>
      ) : (
        <ul className="flex flex-col gap-space-3">
          {order.ownItems.map((item) => {
            const chosen = own.get(item.itemId);
            const line = lineOf.get(item.itemId);
            const name = item.name || t("line.noName");
            const reading = line?.status === "reading" && !item.name;
            return (
              <li
                key={item.itemId}
                className="flex flex-col gap-space-2 border-b border-line pb-space-3 last:border-b-0"
              >
                <div className="flex items-center gap-space-3 text-sm">
                  <Thumb url={item.imageUrl} />
                  <span className="flex min-w-space-0 flex-1 flex-col">
                    {reading ? (
                      <span aria-busy="true" className="text-ink-muted">
                        {tShared("reading")}
                      </span>
                    ) : (
                      <span className="font-title text-ui leading-tight break-words">{name}</span>
                    )}
                    {line && (
                      <span className="text-meta text-ink-muted tabular-nums">
                        {line.unitPriceCents === null ? t("line.unknownPrice") : money(line.unitPriceCents)}
                      </span>
                    )}
                  </span>
                </div>
                <label className={`flex items-center gap-space-3 text-sm ${touch}`}>
                  <input
                    type="checkbox"
                    checked={chosen !== undefined}
                    disabled={!editable || adding}
                    onChange={(event) =>
                      update(item.itemId, event.target.checked ? { sizeLabel: null, quantity: 1 } : null)
                    }
                    className="size-space-5 accent-accent"
                  />
                  <span>
                    {t("me.take")}
                    <span className="sr-only"> — {name}</span>
                  </span>
                </label>
                {chosen && (
                  <div className="grid grid-cols-2 gap-space-3 sm:max-w-narrow">
                    <div className="flex min-w-space-0 flex-col gap-space-1">
                      <label htmlFor={`${id}-${item.itemId}-size`} className="text-sm font-strong">
                        {t("me.size")}
                        <span className="sr-only"> — {name}</span>
                      </label>
                      <select
                        id={`${id}-${item.itemId}-size`}
                        value={chosen.sizeLabel ?? ""}
                        disabled={!editable || adding}
                        onChange={(event) => update(item.itemId, { ...chosen, sizeLabel: event.target.value || null })}
                        className={`${inputClass} ${touch}`}
                      >
                        <option value="">{t("me.noSize")}</option>
                        {[...new Set([...item.sizes, ...(chosen.sizeLabel ? [chosen.sizeLabel] : [])])].map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex min-w-space-0 flex-col gap-space-1">
                      <label htmlFor={`${id}-${item.itemId}-quantity`} className="text-sm font-strong">
                        {t("me.quantity")}
                        <span className="sr-only"> — {name}</span>
                      </label>
                      <select
                        id={`${id}-${item.itemId}-quantity`}
                        value={chosen.quantity}
                        disabled={!editable || adding}
                        onChange={(event) => update(item.itemId, { ...chosen, quantity: Number(event.target.value) })}
                        className={`${inputClass} ${touch}`}
                      >
                        {QUANTITIES.map((quantity) => (
                          <option key={quantity} value={quantity}>
                            {quantity}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {owner && <Totals order={order} personKey={owner.key} money={money} />}
      {editable && (
        <form
          noValidate
          onSubmit={(event) => void addLink(event)}
          aria-labelledby={`${id}-add`}
          className="flex flex-col gap-space-3 border-t border-line pt-space-3"
        >
          <h3 id={`${id}-add`} className="font-strong">
            {t("me.addOther")}
          </h3>
          <div className="flex flex-col gap-space-1">
            <label htmlFor={`${id}-link`} className="text-sm font-strong">
              {tShared("sheet.link", { shop: order.shop.name })}
            </label>
            <input
              ref={linkInput}
              id={`${id}-link`}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? `${id}-link-error` : undefined}
              className={`${inputClass} ${touch}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-space-3 sm:max-w-narrow">
            <div className="flex min-w-space-0 flex-col gap-space-1">
              <label htmlFor={`${id}-link-size`} className="text-sm font-strong">
                {tShared("sheet.size")}
              </label>
              <input
                id={`${id}-link-size`}
                type="text"
                autoComplete="off"
                maxLength={GROUP_ORDER_SIZE_LABEL_MAX}
                value={size}
                onChange={(event) => setSize(event.target.value)}
                className={`${inputClass} ${touch}`}
              />
            </div>
            <div className="flex min-w-space-0 flex-col gap-space-1">
              <label htmlFor={`${id}-link-quantity`} className="text-sm font-strong">
                {tShared("sheet.quantity")}
              </label>
              <select
                id={`${id}-link-quantity`}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                className={`${inputClass} ${touch}`}
              >
                {QUANTITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {linkError && (
            <p id={`${id}-link-error`} role="alert" className="text-sm text-danger">
              {linkError}
            </p>
          )}
          <button
            type="submit"
            disabled={adding}
            aria-busy={adding || undefined}
            className={`${primaryButtonClass} ${touch} self-start`}
          >
            {tShared("sheet.add")}
          </button>
        </form>
      )}
    </Block>
  );
}

/**
 * A friend's block: her lines (photo, name, size × quantity, price, link to the shop), « Retirer » while it runs
 * (« Annuler » in the toast for 8 s), her totals, then once ordered what she owes and « Payé ».
 */
function FriendBlock({
  order,
  person,
  editable,
  busy,
  money,
  change,
}: {
  order: Order;
  person: Person;
  editable: boolean;
  busy: boolean;
  money: (cents: number) => string;
  change: Change;
}) {
  const t = useTranslations("GroupOrder");
  const tShared = useTranslations("SharedList.groupOrder");
  const [paying, setPaying] = useState<boolean | null>(null);
  const paid = paying ?? Boolean(person.payment?.paidAt);
  // What she owes: her payment once ordered, her share until then.
  const owes = person.payment?.amountCents ?? order.totals.perPerson[person.key]?.totalCents ?? null;

  async function remove(line: Line) {
    const result = await change(() => removeGroupLine(order.id, line.id));
    if (!result.ok) return;
    pushUndo(t("toast.removed", { name: person.name }), async () => {
      const restored = await change(() => restoreGroupLine(order.id, line.id));
      return restored.ok;
    });
  }

  async function pay(next: boolean) {
    setPaying(next);
    await change(() => setGroupPayment(order.id, person.key, next));
    setPaying(null);
  }

  return (
    <Block
      title={person.name}
      tag={owes === null ? null : t(paid && person.payment ? "paidTag" : "owes", { amount: money(owes) })}
      settled={paid && Boolean(person.payment)}
    >
      <ul className="flex flex-col gap-space-3">
        {person.lines.map((line) => {
          const removed = line.removedAt !== null;
          const name = line.name || t("line.noName");
          const detail = line.sizeLabel
            ? t("line.sizeQuantity", { size: line.sizeLabel, quantity: line.quantity })
            : t("line.quantityOnly", { quantity: line.quantity });
          return (
            <li
              key={line.id}
              data-testid={removed ? "removed-line" : undefined}
              className="flex items-center gap-space-3 text-sm"
            >
              <Thumb url={line.imageUrl} />
              <span className="flex min-w-space-0 flex-1 flex-col items-start">
                {line.status === "reading" ? (
                  <span aria-busy="true" className="text-ink-muted">
                    {tShared("reading")}
                  </span>
                ) : (
                  <span
                    className={`font-title text-ui leading-tight break-words ${removed ? "text-ink-muted line-through" : ""}`}
                  >
                    {name}
                  </span>
                )}
                <span className="flex flex-wrap gap-x-space-2 text-meta text-ink-muted tabular-nums">
                  <span>{detail}</span>
                  {removed && <span>{t("line.removed")}</span>}
                </span>
                {line.url && (
                  <a
                    href={line.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hit-area relative self-start rounded-button text-meta text-accent underline ${focusRing}`}
                  >
                    {t("line.seeAtShop", { shop: order.shop.name })}
                    <span className="sr-only"> — {name}</span>
                  </a>
                )}
                {editable && !removed && (
                  <button type="button" disabled={busy} onClick={() => void remove(line)} className={moreButtonClass}>
                    {t("line.remove")}
                    <span className="sr-only"> {t("line.forItem", { name, person: person.name })}</span>
                  </button>
                )}
              </span>
              <b className={`shrink-0 tabular-nums ${removed ? "text-ink-muted line-through" : ""}`}>
                {line.unitPriceCents === null ? t("line.unknownPrice") : money(line.unitPriceCents)}
              </b>
            </li>
          );
        })}
      </ul>
      <Totals order={order} personKey={person.key} money={money} />
      {order.status === "ordered" && person.payment && (
        <div className="flex flex-wrap items-center justify-between gap-space-3 rounded-md bg-surface-sunken px-space-3 py-space-1">
          <label className={`flex items-center gap-space-2 text-sm font-bold ${touch}`}>
            <input
              type="checkbox"
              checked={paid}
              disabled={paying !== null}
              onChange={(event) => void pay(event.target.checked)}
              className="size-space-5 accent-accent"
            />
            <span>
              {t("paid")}
              <span className="sr-only"> {t("paidFor", { name: person.name })}</span>
            </span>
          </label>
        </div>
      )}
      {order.status === "ordered" && person.payment && !paid && (
        <CopyButton
          label={t("copy.reminder")}
          labelSuffix={t("paidFor", { name: person.name })}
          text={t("copy.reminderText", {
            name: person.name,
            amount: money(person.payment.amountCents),
            shop: order.shop.name,
          })}
        />
      )}
    </Block>
  );
}

/** How long « Copié ✓ » shows on the button after a copy. */
const COPIED_MS = 2000;

/**
 * A text to paste elsewhere (the message to her friends, a reminder): copied in the click, « Copié ✓ » for 2 s. If the
 * clipboard refuses, the text shows below, selected, to copy by hand.
 */
function CopyButton({ label, labelSuffix, text }: { label: string; labelSuffix?: string; text: string }) {
  const t = useTranslations("GroupOrder.copy");
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (failed) field.current?.select();
  }, [failed]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
    } catch {
      setCopied(false);
      setFailed(true);
      field.current?.select();
    }
  }

  return (
    <div className="flex flex-col items-start gap-space-2">
      <button type="button" onClick={() => void copy()} className={`${buttonClass} ${touch}`}>
        {copied ? t("done") : label}
        {!copied && labelSuffix && <span className="sr-only"> {labelSuffix}</span>}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("done") : ""}
      </span>
      {failed && (
        <div className="flex w-full flex-col gap-space-1">
          <label htmlFor={`${id}-text`} className="text-sm text-ink-muted">
            {t("failed")}
          </label>
          <textarea
            ref={field}
            id={`${id}-text`}
            readOnly
            rows={3}
            value={text}
            onFocus={(event) => event.target.select()}
            className={`${inputClass} w-full resize-none`}
          />
        </div>
      )}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="aspect-3/4 w-order-thumb shrink-0 overflow-hidden rounded-md bg-media-backdrop">
      {url && (
        // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      )}
    </span>
  );
}

/**
 * « Modifier la date et la livraison » while it is not ordered (spec § 4.2): the shop's delivery options and « Autre »,
 * as when she opened it. The delivery of the order is chosen when it is one of the options, else « Autre » shows it.
 */
function EditDialog({
  open,
  order,
  onClose,
  change,
}: {
  open: boolean;
  order: Order;
  onClose: () => void;
  change: Change;
}) {
  const t = useTranslations("GroupOrder");
  const id = useId();
  const options = useShopShippingOptions(order.shop.id, open);
  const [choice, setChoice] = useState("");
  const [deadline, setDeadline] = useState("");
  const [draft, setDraft] = useState<ShippingDraft>({ label: "", shipping: "", freeFrom: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each time it opens: the order as it is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read when it opens only, never while she types.
  useEffect(() => {
    if (!open) return;
    setDeadline(order.deadline ?? "");
    setDraft({
      label: order.shipping.label,
      shipping: centsToField(order.shipping.shippingCents),
      freeFrom: order.shipping.freeFromCents === null ? "" : centsToField(order.shipping.freeFromCents),
    });
    setChoice("");
    setInvalid(null);
  }, [open]);

  // Once the options are read: the one that is the order's delivery, else « Autre ».
  // biome-ignore lint/correctness/useExhaustiveDependencies: chosen when the options arrive, never while she chooses.
  useEffect(() => {
    if (!open || options.status === "loading") return;
    const { label, shippingCents, freeFromCents } = order.shipping;
    const same =
      options.status === "ready"
        ? options.options.find(
            (option) =>
              option.label === label &&
              option.shippingCents === shippingCents &&
              option.freeFromCents === freeFromCents,
          )
        : undefined;
    setChoice(same?.id ?? OTHER_DELIVERY);
  }, [open, options]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setInvalid(null);
    if (deadline && deadline < parisToday() && deadline !== order.deadline) return setInvalid(t("errors.deadline"));
    const chosen = chosenDelivery(choice, options, draft, t("open.otherLabelDefault"));
    if (!chosen.ok) return setInvalid(t(`errors.${chosen.error}`));
    const shipping =
      chosen.kind === "option"
        ? {
            label: chosen.option.label,
            shippingCents: chosen.option.shippingCents,
            freeFromCents: chosen.option.freeFromCents,
          }
        : chosen.shipping;
    setBusy(true);
    const result = await change(() => patchGroupOrder(order.id, { deadline: deadline || null, shipping }), true);
    setBusy(false);
    if (result.ok) onClose();
    else setInvalid(t(`errors.${groupOrderErrorKey(result.error)}`));
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("edit.title")} closeLabel={t("open.close")}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-space-4">
        <div className="flex flex-col gap-space-1">
          <label htmlFor={`${id}-deadline`} className="text-sm font-strong">
            {t("open.deadline")}
          </label>
          <input
            id={`${id}-deadline`}
            type="date"
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className={`${inputClass} ${touch}`}
          />
        </div>
        <ShippingChoice options={options} choice={choice} onChoice={setChoice} draft={draft} onDraft={setDraft} />
        {invalid && (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        )}
        <div className="flex flex-wrap gap-space-2">
          <button
            type="submit"
            disabled={busy || options.status === "loading"}
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("edit.save")}
          </button>
          <button type="button" onClick={onClose} className={`${buttonClass} ${touch}`}>
            {t("open.cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
