"use client";

import type { OrderView, UnreadEmailView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  answerReceived,
  confirmOrder,
  createManualOrder,
  dismissOrder,
  dismissUnreadEmail,
  patchOrder,
} from "@/lib/orders-client";
import { lineDraftOf, lineHref, trackableItem } from "@/lib/orders-form";
import { useCurrentProfile } from "@/lib/profile-context";
import { OrderForm, type OrderFormValues } from "./order-form";
import { errorText, OrderLines, OrderMeta, orderShop, ParcelList, TrackingForm, useDay } from "./order-parts";
import { cardPrimaryClass, cardSoftClass, moreButtonClass } from "./ui";

/**
 * The cards of « Après la commande » (Task 7), on « Accueil » and « Mes commandes »: an order to validate (« C'est
 * bon », « Corriger », « Ce n'est pas une commande »), an e-mail nothing could read (typed by hand), a validated order
 * with its parcels, and « Tu as reçu ta commande … ? ».
 */

const kickerClass = "text-meta font-bold tracking-wide text-une-ink uppercase";
const titleClass = "font-title text-une-title leading-tight font-regular text-balance";
/** The powder-pink card of what waits for her (as the une): one obvious action. */
const waitingCardClass = "flex scroll-mt-space-4 flex-col gap-space-3 rounded-card bg-une p-space-4 text-ink";
/** A validated order: the white card of « Mes articles ». */
const orderCardClass = "flex scroll-mt-space-4 flex-col gap-space-3 rounded-card bg-surface-raised p-space-4";

/** The anchor of an order on « Mes commandes » (where its notifications lead). */
export const orderAnchor = (orderId: string) => `commande-${orderId}`;

/** An order read from her e-mail, to validate; `gone`: it left « À valider » (validated or set aside). */
export function DraftOrderCard({
  order,
  onChange,
}: {
  order: OrderView;
  onChange: (order: OrderView, gone: boolean) => void;
}) {
  const t = useTranslations("Orders.card");
  const tParcel = useTranslations("Orders.parcel");
  const tForm = useTranslations("Orders.form");
  const titleId = useId();
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shop = orderShop(order);

  const act = async (run: () => ReturnType<typeof confirmOrder>) => {
    setBusy(true);
    setError(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) return setError(t("failed"));
    onChange(result.order, result.order.status !== "draft");
  };

  const fix = async (values: OrderFormValues) => {
    const result = await patchOrder(order.id, {
      ...(values.shopName && values.shopName !== (shop ?? "") ? { shopName: values.shopName } : {}),
      lines: values.lines,
    });
    if (!result.ok) return errorText(tForm, result.error);
    setFixing(false);
    onChange(result.order, false);
    return null;
  };

  return (
    <article
      id={orderAnchor(order.id)}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={waitingCardClass}
    >
      <div className="flex flex-col gap-space-1">
        <span className={kickerClass}>{t("toValidate")}</span>
        <h3 id={titleId} className={titleClass}>
          {shop ? t("received", { shop }) : t("receivedNoShop")}
        </h3>
        <OrderMeta order={order} />
      </div>
      {fixing ? (
        <OrderForm
          initialShop={shop ?? ""}
          initialLines={order.lines.map(lineDraftOf)}
          currencies={order.lines.map((l) => l.currency)}
          onSubmit={fix}
          onCancel={() => setFixing(false)}
        />
      ) : (
        <>
          <OrderLines order={order} />
          {order.parcels.length > 0 && (
            <ul aria-label={t("parcels")} className="flex flex-col gap-space-1 text-sm">
              {order.parcels.map((p) => (
                <li key={p.id}>
                  <b>{p.carrier ? tParcel(`carrier.${p.carrier}`) : tParcel("carrier.unknown")}</b>
                  <span className="text-ink-muted tabular-nums"> · {p.trackingNumber}</span>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="text-sm font-bold">
              {error}
            </p>
          )}
          <div className="grid grid-cols-2 gap-space-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => confirmOrder(order.id))}
              className={cardPrimaryClass}
            >
              {t("ok")}
            </button>
            <button type="button" disabled={busy} onClick={() => setFixing(true)} className={cardSoftClass}>
              {t("fix")}
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => dismissOrder(order.id))}
            className={moreButtonClass}
          >
            {t("dismiss")}
          </button>
        </>
      )}
    </article>
  );
}

/** « On n'a pas su lire cet e-mail »: she types the order (validated at once), or sets the e-mail aside. */
export function UnreadEmailCard({
  email,
  onDone,
}: {
  email: UnreadEmailView;
  /** It left the list; with the order she typed from it, if any. */
  onDone: (order: OrderView | null) => void;
}) {
  const t = useTranslations("Orders.card");
  const tForm = useTranslations("Orders.form");
  const titleId = useId();
  const day = useDay();
  const profile = useCurrentProfile();
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (values: OrderFormValues) => {
    if (!profile.id) return tForm("errors.failed");
    const result = await createManualOrder({ ...values, profileId: profile.id, inboundEmailId: email.id });
    if (!result.ok) return errorText(tForm, result.error);
    onDone(result.order);
    return null;
  };

  const dismiss = async () => {
    setBusy(true);
    setError(null);
    const result = await dismissUnreadEmail(email.id);
    setBusy(false);
    if (!result.ok) return setError(t("failed"));
    onDone(null);
  };

  return (
    <article aria-labelledby={titleId} aria-busy={busy || undefined} className={waitingCardClass}>
      <div className="flex flex-col gap-space-1">
        <span className={kickerClass}>{t("toValidate")}</span>
        <h3 id={titleId} className={titleClass}>
          {t("unreadTitle")}
        </h3>
      </div>
      {typing ? (
        <OrderForm manual onSubmit={save} onCancel={() => setTyping(false)} />
      ) : (
        <>
          <p className="text-sm">{t("unreadBody", { date: day(email.receivedAt) })}</p>
          {error && (
            <p role="alert" className="text-sm font-bold">
              {error}
            </p>
          )}
          <button type="button" onClick={() => setTyping(true)} className={cardPrimaryClass}>
            {t("unreadEnter")}
          </button>
          <button type="button" disabled={busy} onClick={() => void dismiss()} className={moreButtonClass}>
            {t("dismiss")}
          </button>
        </>
      )}
    </article>
  );
}

/** « Tu as reçu ta commande {boutique} ? » → « Oui » (her articles go to « Reçu ») or « Pas encore ». */
function ReceivedButtons({ order, onChange }: { order: OrderView; onChange: (order: OrderView) => void }) {
  const t = useTranslations("Orders");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const reply = async (answer: "yes" | "not_yet") => {
    setBusy(true);
    setError(false);
    const result = await answerReceived(order.id, answer);
    setBusy(false);
    if (!result.ok) return setError(true);
    onChange(result.order);
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-space-2">
        <button type="button" disabled={busy} onClick={() => void reply("yes")} className={cardPrimaryClass}>
          {t("receivedYes")}
        </button>
        <button type="button" disabled={busy} onClick={() => void reply("not_yet")} className={cardSoftClass}>
          {t("receivedNotYet")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm font-bold">
          {t("card.failed")}
        </p>
      )}
    </>
  );
}

const questionOf = (t: ReturnType<typeof useTranslations<"Orders">>, order: OrderView) => {
  const shop = orderShop(order);
  return shop ? t("receivedQuestion", { shop }) : t("receivedQuestionNoShop");
};

/** The question on « Accueil »: a card of its own, gone once she answered. */
export function ReceivedQuestionCard({ order, onChange }: { order: OrderView; onChange: (order: OrderView) => void }) {
  const t = useTranslations("Orders");
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className={waitingCardClass}>
      <div className="flex flex-col gap-space-1">
        <span className={kickerClass}>{t("card.parcels")}</span>
        <h3 id={titleId} className={titleClass}>
          {questionOf(t, order)}
        </h3>
      </div>
      <OrderLines order={order} />
      <ReceivedButtons order={order} onChange={onChange} />
    </article>
  );
}

/**
 * A validated order on « Mes commandes »: its shop, its articles (each a link to its sheet), its parcels, the question
 * when it waits for her answer, and « Ajouter un numéro de suivi » while nothing is delivered.
 */
export function OrderCard({ order, onChange }: { order: OrderView; onChange: (order: OrderView) => void }) {
  const t = useTranslations("Orders");
  const titleId = useId();
  const shop = orderShop(order);
  const tracked = trackableItem(order);
  return (
    <article id={orderAnchor(order.id)} aria-labelledby={titleId} className={orderCardClass}>
      <div className="flex flex-col gap-space-1">
        <h3 id={titleId} className="font-title text-section-title leading-tight font-regular">
          {shop ?? t("card.noShop")}
        </h3>
        <OrderMeta order={order} />
      </div>
      {order.receivedQuestion && (
        <div className="flex flex-col gap-space-2 rounded-card bg-une p-space-3">
          <p className="font-strong">{questionOf(t, order)}</p>
          <ReceivedButtons order={order} onChange={onChange} />
        </div>
      )}
      <OrderLines order={order} hrefOf={lineHref} />
      <ParcelList order={order} onChange={onChange} />
      {tracked && <TrackingForm itemId={tracked} onAdded={onChange} />}
    </article>
  );
}
