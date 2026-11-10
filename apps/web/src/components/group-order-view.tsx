"use client";

import type { GroupOrderOrder, OwnerGroupOrder } from "@closyria/shared";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { formatAmount } from "@/lib/budget";
import { confirmUnlessReserved } from "@/lib/gift-check";
import { pushUndo } from "@/lib/undo";
import {
  actOnGroupOrder,
  fetchGroupOrder,
  fetchGroupOrderById,
  type GroupOrderResult,
  orderGroupOrder,
  patchGroupOrder,
  putOwnGroupLines,
  removeGroupLine,
  restoreGroupLine,
  setGroupPayment,
} from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import {
  centsToField,
  groupOrderErrorKey,
  parisToday,
  parseShipping,
  type ShippingDraft,
  ShippingFields,
} from "./group-order-open-dialog";
import { GroupOrderOrderedDialog } from "./group-order-ordered-dialog";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";
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
  const tShared = useTranslations("SharedList.groupOrder");
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
  // « Total … · Plus que … pour la livraison offerte » and the two others (spec § 3.1).
  const total = money(order.totals.totalCents);
  const remaining = order.totals.remainingForFreeCents;
  const progress =
    remaining === null
      ? tShared("progressShared", { total, shipping: money(order.shipping.shippingCents) })
      : remaining > 0
        ? tShared("progressRemaining", { total, remaining: money(remaining) })
        : tShared("progressFree", { total });
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

  async function act(action: "close" | "reopen" | "cancel") {
    setBusy(true);
    await change(() => actOnGroupOrder(order.id, action));
    setBusy(false);
  }

  /** « J'ai commandé » validated: her ticked items are asked about first (🎁), then the order is sent. */
  async function sendOrder(body: GroupOrderOrder) {
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

  return (
    <div className="flex flex-col gap-space-5 pb-space-6">
      <Link
        href={`/listes/${listId}`}
        className={`self-start rounded-button text-sm text-accent ${touch} inline-flex items-center ${focusRing}`}
      >
        <span aria-hidden="true">←&nbsp;</span>
        {t("back")}
      </Link>

      <div className="flex flex-col gap-space-2 rounded-card border-2 border-selected-line bg-selected-surface p-space-4">
        <h1 className="font-display text-title font-strong break-words">{title}</h1>
        <p className="text-sm text-ink-muted tabular-nums">{delivery}</p>
        {editable && <p className="font-strong tabular-nums">{progress}</p>}
        <p data-testid="group-state" className="font-strong">
          {stateText}
        </p>
        {settled && <p className="font-strong text-accent">{t("state.settled")}</p>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {editable && (
        <div className="flex flex-wrap gap-space-2">
          {order.status === "open" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("close")}
              className={`${buttonClass} ${touch}`}
            >
              {t("actions.close")}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void act("reopen")}
              className={`${buttonClass} ${touch}`}
            >
              {t("actions.reopen")}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setOrdered((previous) => ({
                open: true,
                key: previous.keep ? previous.key : previous.key + 1,
                error: null,
                keep: false,
              }))
            }
            className={`${primaryButtonClass} ${touch}`}
          >
            {t("actions.ordered")}
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(true)} className={`${buttonClass} ${touch}`}>
            {t("actions.edit")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmCancel(true)}
            className={`${buttonClass} ${touch}`}
          >
            {t("actions.cancel")}
          </button>
        </div>
      )}

      <MeBlock order={order} editable={editable} money={money} change={change} />

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

      <GroupOrderOrderedDialog
        open={ordered.open}
        resetKey={ordered.key}
        order={order}
        error={ordered.error}
        busy={busy}
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
    </div>
  );
}

/** A block of the page, named by its heading (« Toi », a friend's name). */
function Block({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4"
    >
      <h2 id={id} className="font-display text-lead font-strong break-words">
        {title}
      </h2>
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
    <p className="font-strong tabular-nums">
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
 */
function MeBlock({
  order,
  editable,
  money,
  change,
}: {
  order: Order;
  editable: boolean;
  money: (cents: number) => string;
  change: Change;
}) {
  const t = useTranslations("GroupOrder");
  const id = useId();
  const [pending, setPending] = useState<Own | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const waiting = useRef(0);
  const own = pending ?? ownOf(order);
  const owner = order.people.find((person) => person.isOwner);
  const lineOf = new Map(
    (owner?.lines ?? []).filter((line) => line.removedAt === null).map((line) => [line.itemId, line]),
  );

  function save(next: Own) {
    setPending(next);
    waiting.current += 1;
    const lines = [...next].map(([itemId, value]) => ({ itemId, ...value }));
    queue.current = queue.current.then(async () => {
      await change(() => putOwnGroupLines(order.id, { lines }));
      waiting.current -= 1;
      if (waiting.current === 0) setPending(null);
    });
  }
  const update = (itemId: string, value: { sizeLabel: string | null; quantity: number } | null) => {
    const next = new Map(own);
    if (value) next.set(itemId, value);
    else next.delete(itemId);
    save(next);
  };

  return (
    <Block title={t("me.title")}>
      {order.ownItems.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("me.empty", { shop: order.shop.name })}</p>
      ) : (
        <ul className="flex flex-col gap-space-3">
          {order.ownItems.map((item) => {
            const chosen = own.get(item.itemId);
            const line = lineOf.get(item.itemId);
            const name = item.name || t("line.noName");
            return (
              <li
                key={item.itemId}
                className="flex flex-col gap-space-2 border-b border-line pb-space-3 last:border-b-0"
              >
                <div className="flex items-center gap-space-3 text-sm">
                  <Thumb url={item.imageUrl} />
                  <span className="flex min-w-space-0 flex-1 flex-col">
                    <span className="font-strong break-words">{name}</span>
                    {line && (
                      <span className="text-ink-muted tabular-nums">
                        {line.unitPriceCents === null ? t("line.unknownPrice") : money(line.unitPriceCents)}
                      </span>
                    )}
                  </span>
                </div>
                <label className={`flex items-center gap-space-3 text-sm ${touch}`}>
                  <input
                    type="checkbox"
                    checked={chosen !== undefined}
                    disabled={!editable}
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
                        disabled={!editable}
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
                        disabled={!editable}
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
    <Block title={person.name}>
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
              className="flex flex-wrap items-center gap-space-3 text-sm"
            >
              <Thumb url={line.imageUrl} />
              <span className="flex min-w-space-0 flex-1 flex-col">
                {line.status === "reading" ? (
                  <span aria-busy="true" className="text-ink-muted">
                    {tShared("reading")}
                  </span>
                ) : (
                  <span className={`font-strong break-words ${removed ? "text-ink-muted line-through" : ""}`}>
                    {name}
                  </span>
                )}
                <span className="flex flex-wrap gap-x-space-2 text-ink-muted tabular-nums">
                  <span>{detail}</span>
                  <span>{line.unitPriceCents === null ? t("line.unknownPrice") : money(line.unitPriceCents)}</span>
                  {removed && <span>{t("line.removed")}</span>}
                </span>
                {line.url && (
                  <a
                    href={line.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`hit-area relative self-start rounded-button text-accent underline ${focusRing}`}
                  >
                    {t("line.seeAtShop", { shop: order.shop.name })}
                    <span className="sr-only"> — {name}</span>
                  </a>
                )}
              </span>
              {editable && !removed && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(line)}
                  className={`${buttonClass} ${touch}`}
                >
                  {t("line.remove")}
                  <span className="sr-only"> {t("line.forItem", { name, person: person.name })}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Totals order={order} personKey={person.key} money={money} />
      {order.status === "ordered" && person.payment && (
        <div className="flex flex-wrap items-center justify-between gap-space-3 rounded-md border border-selected-line bg-selected-surface px-space-3 py-space-2">
          <p className="font-strong tabular-nums">{t("owes", { amount: money(person.payment.amountCents) })}</p>
          <label className={`flex items-center gap-space-2 text-sm font-strong ${touch}`}>
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
    </Block>
  );
}

function Thumb({ url }: { url: string | null }) {
  return (
    <span className="size-touch-target shrink-0 overflow-hidden rounded-md bg-media-backdrop">
      {url && (
        // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      )}
    </span>
  );
}

/** « Modifier la date et la livraison » while it is not ordered (spec § 4.2). */
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
    setInvalid(null);
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setInvalid(null);
    if (deadline && deadline < parisToday() && deadline !== order.deadline) return setInvalid(t("errors.deadline"));
    const parsed = parseShipping(draft, t("open.otherLabelDefault"));
    if (!parsed.ok) return setInvalid(t(`errors.${parsed.error}`));
    setBusy(true);
    const result = await change(
      () => patchGroupOrder(order.id, { deadline: deadline || null, shipping: parsed.shipping }),
      true,
    );
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
        <fieldset className="flex flex-col gap-space-2">
          <legend className="mb-space-1 text-sm font-strong">{t("open.delivery")}</legend>
          <ShippingFields draft={draft} onChange={setDraft} />
        </fieldset>
        {invalid && (
          <p role="alert" className="text-sm text-danger">
            {invalid}
          </p>
        )}
        <div className="flex flex-wrap gap-space-2">
          <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
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
