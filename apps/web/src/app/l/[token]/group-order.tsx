"use client";

import type { SharedGroupOrder } from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { focusRing, primaryButtonClass } from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { occasionDay } from "./gifts";

type Line = SharedGroupOrder["people"][number]["lines"][number];

/** « 10 novembre »: the day she ordered, in Paris. */
function orderedDay(locale: string, at: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Paris" })
    .format(new Date(at))
    .replace(/ /g, " ");
}

/** Whether friends may still add or change lines (open and before its deadline). */
export const groupOrderWritable = (order: SharedGroupOrder) => order.status === "open" && !order.locked;

/** Her own active lines (only the device attached to her name knows them). */
export const mineLines = (order: SharedGroupOrder): Line[] => {
  const ids = new Set(order.mine?.lineIds ?? []);
  return order.people.flatMap((p) => (p.isOwner ? [] : p.lines.filter((l) => ids.has(l.id))));
};

/**
 * The 🛍️ banner at the head of the order's block (spec §3.1, §3.5): « Commande groupée chez {boutique} avec {prénom},
 * jusqu'au {date} » (the block's title), the way to free shipping, and the state once closed, ordered or cancelled.
 */
function GroupBanner({ order, titleId }: { order: SharedGroupOrder; titleId: string }) {
  const t = useTranslations("SharedList.groupOrder");
  const locale = useLocale();
  const shop = order.shopName;
  const name = order.ownerName;
  const date = order.deadline ? occasionDay(locale, order.deadline) : null;
  const title = name
    ? date
      ? t("bannerNameDate", { shop, name, date })
      : t("bannerName", { shop, name })
    : date
      ? t("bannerDate", { shop, date })
      : t("banner", { shop });
  const money = (cents: number) => formatAmount(locale, cents, order.currency);
  const total = money(order.totals.totalCents);
  const remaining = order.totals.remainingForFreeCents;
  let progress: string | null = null;
  if (order.status === "open" || order.status === "closed")
    progress =
      remaining === null
        ? t("progressShared", { total, shipping: money(order.shipping.shippingCents) })
        : remaining > 0
          ? t("progressRemaining", { total, remaining: money(remaining) })
          : t("progressFree", { total });
  let state: string | null = null;
  if (order.status === "cancelled") state = t("cancelled");
  else if (order.status === "ordered" && order.orderedAt)
    state = t("ordered", { date: orderedDay(locale, order.orderedAt) });
  else if (order.status === "closed" || order.locked) state = name ? t("closed", { name }) : t("closedHidden");

  return (
    <div data-testid="group-banner" className="flex flex-col gap-space-1 break-words">
      <h2 id={titleId} className="font-display text-lead font-strong">
        <span aria-hidden="true">🛍️ </span>
        {title}
      </h2>
      {progress && <p className="tabular-nums">{progress}</p>}
      {state && <p className="font-strong">{state}</p>}
    </div>
  );
}

const linkButtonClass = `hit-area relative rounded-button px-space-2 text-sm text-ink-muted underline hover:text-ink disabled:opacity-60 ${focusRing}`;

/** « Tu le prends aussi (T38 × 1) ». */
function useMineLabel() {
  const t = useTranslations("SharedList.groupOrder");
  return (line: Pick<Line, "sizeLabel" | "quantity">) =>
    line.sizeLabel
      ? t("mine", { size: line.sizeLabel, quantity: line.quantity })
      : t("mineNoSize", { quantity: line.quantity });
}

/**
 * The group order part of an item of its shop (spec §3.2): her lines of it (« Tu le prends aussi (T38 × 1) ·
 * Modifier · Retirer ») and « Je le prends aussi », still offered (another size).
 */
export function GroupItemActions({
  itemName,
  order,
  lines,
  blockId,
  canAct,
  busy,
  onTake,
  onEdit,
  onRemove,
}: {
  itemName: string;
  order: SharedGroupOrder;
  /** Her lines of this item. */
  lines: Line[];
  /** Where the page puts the focus after a change (her next step is in it). */
  blockId: string;
  /** False on the owner's own link, and before this device is known: no button. */
  canAct: boolean;
  busy: boolean;
  onTake: () => void;
  onEdit: (line: Line) => void;
  onRemove: (line: Line) => void;
}) {
  const t = useTranslations("SharedList.groupOrder");
  const mineLabel = useMineLabel();
  const writable = groupOrderWritable(order) && canAct;
  if (lines.length === 0 && !writable) return null;
  const forItem = <span className="sr-only"> {t("forItem", { name: itemName })}</span>;
  return (
    <div id={blockId} tabIndex={-1} className={`flex flex-col gap-space-2 rounded-md ${focusRing}`}>
      {lines.map((line) => (
        <p
          key={line.id}
          className="flex flex-wrap items-center justify-between gap-x-space-3 gap-y-space-1 rounded-md border border-selected-line bg-selected-surface px-space-3 py-space-2 text-sm"
        >
          <span className="font-strong text-accent">{mineLabel(line)}</span>
          {writable && (
            <span className="flex items-center gap-space-1">
              <button type="button" disabled={busy} onClick={() => onEdit(line)} className={linkButtonClass}>
                {t("edit")}
                {forItem}
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" disabled={busy} onClick={() => onRemove(line)} className={linkButtonClass}>
                {t("remove")}
                {forItem}
              </button>
            </span>
          )}
        </p>
      ))}
      {writable && (
        <button
          type="button"
          disabled={busy}
          onClick={onTake}
          className={`inline-flex min-h-touch-target items-center justify-center rounded-button border border-selected-line bg-surface-raised px-space-3 text-sm font-strong text-ink hover:bg-selected-surface disabled:opacity-60 ${focusRing}`}
        >
          <span aria-hidden="true">🛍️&nbsp;</span>
          {t("take")}
          {forItem}
        </button>
      )}
    </div>
  );
}

/**
 * The group order's block, right under the list's title (spec §3.4, §3.5; retours R3): the banner, her share
 * (marked « provisoire » until ordered, then what she owes and « Payé ✓ »), « Voir le détail ({n} articles) » that
 * unfolds everyone's lines (the owner first) and hers taken out, and « Ajouter un autre article » while it is open.
 */
export function GroupOrderBlock({
  order,
  noName,
  canAct,
  busy,
  detailOpen,
  onToggleDetail,
  onAdd,
  onEdit,
  onRemove,
}: {
  order: SharedGroupOrder;
  noName: string;
  canAct: boolean;
  busy: boolean;
  /** Everyone's lines shown (folded at first). */
  detailOpen: boolean;
  onToggleDetail: () => void;
  onAdd: () => void;
  onEdit: (line: Line) => void;
  onRemove: (line: Line) => void;
}) {
  const t = useTranslations("SharedList.groupOrder");
  const locale = useLocale();
  const titleId = useId();
  const detailId = useId();
  const money = (cents: number) => formatAmount(locale, cents, order.currency);
  const writable = groupOrderWritable(order) && canAct;
  const mine = order.mine;
  const own = new Set(mine?.lineIds ?? []);
  const ownerName = order.ownerName;
  const lineCount = order.people.reduce((count, person) => count + person.lines.length, 0);
  const removedLines = mine?.removedLines ?? [];
  const live = order.status !== "cancelled";

  return (
    <section
      aria-labelledby={titleId}
      id="group-order"
      tabIndex={-1}
      className={`flex flex-col gap-space-3 rounded-card border-2 border-selected-line bg-card-bg p-space-4 ${focusRing}`}
    >
      <GroupBanner order={order} titleId={titleId} />

      {live && mine && mine.lineIds.length > 0 && (
        <div className="flex flex-col gap-space-1 rounded-md border border-selected-line bg-selected-surface px-space-3 py-space-2">
          <p className="tabular-nums">
            <span className="font-strong">
              {t("share", {
                amount: money(mine.totalCents),
                items: money(mine.itemsCents),
                shipping: money(mine.shippingCents),
              })}
            </span>
            {mine.provisional && <span className="text-ink-muted"> · {t("provisional")}</span>}
          </p>
          {order.status === "ordered" &&
            (mine.paidAt ? (
              <p className="font-strong text-accent">{t("paid")}</p>
            ) : (
              <p className="font-strong tabular-nums">
                {ownerName
                  ? t("owe", { amount: money(mine.totalCents), name: ownerName })
                  : t("oweHidden", { amount: money(mine.totalCents) })}
              </p>
            ))}
        </div>
      )}

      {live && (lineCount > 0 || removedLines.length > 0) && (
        <>
          <button
            type="button"
            aria-expanded={detailOpen}
            aria-controls={detailOpen ? detailId : undefined}
            onClick={onToggleDetail}
            className={`group inline-flex min-h-touch-target items-center gap-space-1 self-start rounded-button text-sm font-strong underline underline-offset-2 ${focusRing}`}
          >
            {t("detail", { count: lineCount })}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="size-space-4 shrink-0 transition-transform duration-base group-aria-expanded:rotate-180 motion-reduce:transition-none"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </button>

          {detailOpen && (
            <div id={detailId} className="flex flex-col gap-space-3">
              {order.people.length > 0 && (
                <ul className="flex flex-col gap-space-3">
                  {order.people.map((person) => {
                    const isMe = !person.isOwner && person.lines.some((l) => own.has(l.id));
                    const who = person.isOwner ? person.name || ownerName || t("ownerFallback") : person.name;
                    return (
                      <li key={person.lines[0]?.id ?? person.name} className="flex flex-col gap-space-1">
                        <p className="font-strong">{isMe ? t("you", { name: who }) : who}</p>
                        <ul className="flex flex-col gap-space-2">
                          {person.lines.map((line) => (
                            <SummaryLine
                              key={line.id}
                              line={line}
                              noName={noName}
                              money={money}
                              actions={
                                writable && own.has(line.id) ? (
                                  <span className="flex items-center gap-space-1">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => onEdit(line)}
                                      className={linkButtonClass}
                                    >
                                      {t("edit")}
                                      <span className="sr-only"> {t("forItem", { name: line.name || noName })}</span>
                                    </button>
                                    <span aria-hidden="true">·</span>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => onRemove(line)}
                                      className={linkButtonClass}
                                    >
                                      {t("remove")}
                                      <span className="sr-only"> {t("forItem", { name: line.name || noName })}</span>
                                    </button>
                                  </span>
                                ) : null
                              }
                            />
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                </ul>
              )}

              {removedLines.length > 0 && (
                <ul className="flex flex-col gap-space-1 text-sm">
                  {removedLines.map((line) => (
                    <li
                      key={line.id}
                      data-testid="removed-line"
                      className="flex flex-wrap items-center gap-x-space-2 text-ink-muted"
                    >
                      <span className="line-through break-words">{line.name || noName}</span>
                      <span>{ownerName ? t("removedBy", { name: ownerName }) : t("removedByHidden")}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {live && writable && (
        <button
          type="button"
          disabled={busy}
          onClick={onAdd}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {t("addOther")}
        </button>
      )}
    </section>
  );
}

function SummaryLine({
  line,
  noName,
  money,
  actions,
}: {
  line: Line;
  noName: string;
  money: (cents: number) => string;
  actions: React.ReactNode;
}) {
  const t = useTranslations("SharedList.groupOrder");
  const reading = line.status === "reading";
  const detail = line.sizeLabel
    ? t("sizeQuantity", { size: line.sizeLabel, quantity: line.quantity })
    : t("quantityOnly", { quantity: line.quantity });
  return (
    <li className="flex items-center gap-space-3 text-sm">
      <span className="size-touch-target shrink-0 overflow-hidden rounded-md bg-media-backdrop">
        {line.imageUrl && (
          // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
          <img src={line.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        )}
      </span>
      <span className="flex min-w-space-0 flex-1 flex-col">
        {reading ? (
          <span aria-busy="true" className="text-ink-muted">
            {t("reading")}
          </span>
        ) : (
          <span className="font-strong break-words">{line.name || noName}</span>
        )}
        <span className="flex flex-wrap gap-x-space-2 text-ink-muted tabular-nums">
          <span>{detail}</span>
          {!reading && <span>{line.unitPriceCents === null ? t("unknownPrice") : money(line.unitPriceCents)}</span>}
        </span>
      </span>
      {actions}
    </li>
  );
}
