"use client";

import type { OrderList, OrderView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useState } from "react";
import { createManualOrder, fetchOrders } from "@/lib/orders-client";
import { useCurrentProfile } from "@/lib/profile-context";
import { sectionTitleClass } from "./home-news";
import { DraftOrderCard, OrderCard, UnreadEmailCard } from "./order-card";
import { OrderForm, type OrderFormValues } from "./order-form";
import { errorText } from "./order-parts";
import { buttonClass, focusRing, primaryButtonClass } from "./ui";

const HERE = "/mes-commandes";
const linkClass = `inline-flex min-h-touch-target items-center self-start rounded-button text-sm font-strong text-accent underline underline-offset-4 ${focusRing}`;

type State = { kind: "loading" } | { kind: "failed" } | { kind: "guest" } | { kind: "ready"; list: OrderList };

/** Replaces (or adds first) an order in her list. */
export function withOrder(list: OrderList, order: OrderView): OrderList {
  const known = list.orders.some((o) => o.id === order.id);
  const orders = known ? list.orders.map((o) => (o.id === order.id ? order : o)) : [order, ...list.orders];
  return { ...list, orders: orders.filter((o) => o.status !== "dismissed") };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-space-3">
      <h2 id={id} className={sectionTitleClass}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** « Saisir une commande à la main »: typed from scratch, validated at once. */
function ManualEntry({ onSaved }: { onSaved: (order: OrderView) => void }) {
  const t = useTranslations("Orders.page");
  const tForm = useTranslations("Orders.form");
  const profile = useCurrentProfile();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass} min-h-touch-target self-start`}>
        {t("manual")}
      </button>
    );
  }
  const save = async (values: OrderFormValues) => {
    if (!profile.id) return tForm("errors.failed");
    const result = await createManualOrder({ ...values, profileId: profile.id });
    if (!result.ok) return errorText(tForm, result.error);
    setOpen(false);
    onSaved(result.order);
    return null;
  };
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-3 rounded-card bg-surface-sunken p-space-4">
      <h2 id={titleId} className={sectionTitleClass}>
        {t("manualTitle")}
      </h2>
      <OrderForm manual onSubmit={save} onCancel={() => setOpen(false)} />
    </section>
  );
}

/**
 * « Mes commandes » (spec §3.2–3.5): what waits for her (orders read from her e-mails, e-mails nothing could read),
 * then her orders with their parcels. A guest is asked to create her account first. A notification's `#commande-…`
 * brings the order into view.
 */
export function OrdersScreen() {
  const t = useTranslations("Orders.page");
  const tInbox = useTranslations("Orders.inbox");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once, and on « Réessayer ».
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetchOrders().then(
      (list) => alive && setState(list === "guest" ? { kind: "guest" } : { kind: "ready", list }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  // The order a notification leads to (`#commande-…`), once the list is there.
  const ready = state.kind === "ready";
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView();
  }, [ready]);

  const update = (change: (list: OrderList) => OrderList) =>
    setState((current) => (current.kind === "ready" ? { kind: "ready", list: change(current.list) } : current));

  const header = (
    <div className="flex flex-col gap-space-2">
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
    </div>
  );

  let body: ReactNode;
  if (state.kind === "loading") body = <p role="status">{t("loading")}</p>;
  else if (state.kind === "failed") {
    body = (
      <div className="flex flex-col items-start gap-space-2">
        <p role="alert" className="text-danger">
          {t("failed")}
        </p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${buttonClass} min-h-touch-target`}>
          {t("retry")}
        </button>
      </div>
    );
  } else if (state.kind === "guest") {
    body = (
      <section aria-labelledby="orders-guest" className="flex flex-col gap-space-3 rounded-card bg-hint p-space-4">
        <h2 id="orders-guest" className={sectionTitleClass}>
          {t("guestTitle")}
        </h2>
        <p>{t("guestBody")}</p>
        <Link
          href={`/connexion?next=${encodeURIComponent(HERE)}`}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {tInbox("createAccount")}
        </Link>
      </section>
    );
  } else {
    const { list } = state;
    const drafts = list.orders.filter((o) => o.status === "draft");
    const confirmed = list.orders.filter((o) => o.status === "confirmed");
    const waiting = drafts.length + list.unreadEmails.length;
    body = (
      <>
        {waiting > 0 && (
          <Section title={t("toValidate")}>
            {drafts.map((order) => (
              <DraftOrderCard key={order.id} order={order} onChange={(next) => update((l) => withOrder(l, next))} />
            ))}
            {list.unreadEmails.map((email) => (
              <UnreadEmailCard
                key={email.id}
                email={email}
                onDone={(order) =>
                  update((l) => {
                    const rest = { ...l, unreadEmails: l.unreadEmails.filter((e) => e.id !== email.id) };
                    return order ? withOrder(rest, order) : rest;
                  })
                }
              />
            ))}
          </Section>
        )}
        {confirmed.length > 0 ? (
          <Section title={t("orders")}>
            {confirmed.map((order) => (
              <OrderCard key={order.id} order={order} onChange={(next) => update((l) => withOrder(l, next))} />
            ))}
          </Section>
        ) : (
          waiting === 0 && (
            <section
              aria-labelledby="orders-empty"
              className="flex flex-col gap-space-3 rounded-card bg-surface-sunken p-space-5"
            >
              <h2 id="orders-empty" className={sectionTitleClass}>
                {t("emptyTitle")}
              </h2>
              <p>{t("emptyBody")}</p>
              <Link href="/reglages/commandes" className={`${primaryButtonClass} min-h-touch-target self-start`}>
                {t("settings")}
              </Link>
            </section>
          )
        )}
        <ManualEntry onSaved={(order) => update((l) => withOrder(l, order))} />
        {(confirmed.length > 0 || waiting > 0) && (
          <Link href="/reglages/commandes" className={linkClass}>
            {t("settings")}
          </Link>
        )}
      </>
    );
  }

  return (
    <div className="flex max-w-measure flex-col gap-space-5 pb-space-6">
      {header}
      {body}
    </div>
  );
}
