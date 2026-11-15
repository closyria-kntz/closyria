"use client";

import { type ItemView, type OrderView, orderHref } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { fetchOrders } from "@/lib/orders-client";
import { linkActionClass, OrderMeta, orderShop, ParcelList, TrackingForm, useCalendarDay } from "./order-parts";
import { blockClass, blockTitleClass, buttonClass } from "./ui";

type Orders = { kind: "loading" } | { kind: "guest" } | { kind: "failed" } | { kind: "ready"; orders: OrderView[] };

/** Her validated orders holding this article, newest first. */
const ordersOf = (orders: readonly OrderView[], itemId: string) =>
  orders.filter((o) => o.status === "confirmed" && o.lines.some((l) => l.itemId === itemId));

/**
 * « Commande / colis » on an article's sheet (spec §3.3–3.5): « Retour possible jusqu'au … » once received, its orders
 * with their parcels (« En route », the last step, « Suivre chez le transporteur », « Changer de transporteur »), and
 * « Ajouter un numéro de suivi » while it is « Commandé ». Shown only when there is something to say or do.
 */
export function ItemOrderBlock({ item }: { item: ItemView }) {
  const t = useTranslations("Orders");
  const titleId = useId();
  const calendarDay = useCalendarDay();
  const [state, setState] = useState<Orders>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when the article changes step (a « Oui » elsewhere, a delivery), and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    fetchOrders(undefined, controller.signal).then(
      (list) =>
        alive &&
        setState(list === "guest" ? { kind: "guest" } : { kind: "ready", orders: ordersOf(list.orders, item.id) }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [item.id, item.stage, attempt]);

  const ordered = item.stage === "ordered";
  const deadline = item.stage === "owned" && item.returnDeadline ? item.returnDeadline : null;
  const orders = state.kind === "ready" ? state.orders : [];
  if (!ordered && !deadline && orders.length === 0) return null;

  const merge = (order: OrderView) =>
    setState((current) => {
      const known = current.kind === "ready" ? current.orders : [];
      const others = known.filter((o) => o.id !== order.id);
      return { kind: "ready", orders: ordersOf([order, ...others], item.id) };
    });

  return (
    <section aria-labelledby={titleId} data-block className={blockClass}>
      <h2 id={titleId} className={blockTitleClass}>
        {t("item.title")}
      </h2>
      {deadline && (
        <p className="clothing-tag relative self-start">{t("returnUntil", { date: calendarDay(deadline) })}</p>
      )}
      {orders.map((order) => {
        const shop = orderShop(order);
        return (
          <div key={order.id} className="flex flex-col gap-space-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-space-3">
              <span className="flex flex-col">
                <span className="font-strong">{shop ? t("item.orderOf", { shop }) : t("item.orderNoShop")}</span>
                <OrderMeta order={order} />
              </span>
              <Link href={orderHref(order.id)} className={linkActionClass}>
                {t("item.viewOrder")}
              </Link>
            </div>
            {order.parcels.length > 0 ? (
              <ParcelList order={order} onChange={merge} raised />
            ) : (
              <p className="text-sm text-ink-muted">{t("item.noParcel")}</p>
            )}
          </div>
        );
      })}
      {ordered && state.kind === "ready" && <TrackingForm itemId={item.id} onAdded={merge} />}
      {ordered && state.kind === "guest" && (
        <Link href={`/connexion?next=${encodeURIComponent(window.location.pathname)}`} className={linkActionClass}>
          {t("item.guest")}
        </Link>
      )}
      {state.kind === "failed" && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("item.loadFailed")}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className={`${buttonClass} min-h-touch-target`}
          >
            {t("page.retry")}
          </button>
        </div>
      )}
    </section>
  );
}
