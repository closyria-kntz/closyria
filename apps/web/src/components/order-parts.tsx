"use client";

import {
  type Carrier,
  carrierSchema,
  carrierTrackingUrl,
  MAX_TRACKING_NUMBER,
  type OrderLineView,
  type OrderView,
  type ParcelView,
} from "@closyria/shared";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { addItemTracking, changeParcelCarrier, deleteParcel, patchParcel } from "@/lib/orders-client";
import { type ClientError, isTrackingInput } from "@/lib/orders-form";
import { formatPrice } from "@/lib/price";
import { Dialog } from "./dialog";
import { buttonClass, focusRing, inputClass, moreButtonClass, primaryButtonClass } from "./ui";

/**
 * Pieces shared by « Mes commandes », the order cards of « Accueil » and the « Commande / colis » block of an article:
 * an order's articles, a parcel (where it stands, « Suivre chez le transporteur », « Changer de transporteur ») and
 * « Ajouter un numéro de suivi ».
 */

export const CARRIERS = carrierSchema.options;

/** A written link-like action (« Suivre chez le transporteur »): bold, underlined, finger-wide. */
export const linkActionClass = `inline-flex min-h-touch-target items-center self-start rounded-button text-sm font-bold underline underline-offset-3 ${focusRing}`;

/** « 12 novembre »: an instant as a Paris day. */
export function useDay() {
  const format = useFormatter();
  return (at: string) => format.dateTime(new Date(at), { day: "numeric", month: "long", timeZone: "Europe/Paris" });
}

/** « 29 novembre »: a Paris calendar day (`YYYY-MM-DD`). */
export function useCalendarDay() {
  const format = useFormatter();
  return (day: string) =>
    format.dateTime(new Date(`${day}T00:00:00Z`), { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The shop's name to show (known, typed, or none). */
export const orderShop = (order: Pick<OrderView, "shopName">) => order.shopName?.trim() || null;

/** « Commandée le 12 novembre · n° 1042 », what is known of it. */
export function OrderMeta({ order }: { order: OrderView }) {
  const t = useTranslations("Orders.card");
  const day = useDay();
  const parts = [
    order.orderedAt ? t("orderedOn", { date: day(order.orderedAt) }) : null,
    order.externalRef ? t("ref", { ref: order.externalRef }) : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return <p className="text-meta text-ink-muted">{parts.join(" · ")}</p>;
}

/** Size, colour and quantity of a line (« M · Rouge · × 2 »). */
export function useLineDetails() {
  const t = useTranslations("Orders.card");
  return (line: Pick<OrderLineView, "sizeLabel" | "color" | "quantity">) =>
    [line.sizeLabel, line.color, line.quantity > 1 ? t("quantity", { count: line.quantity }) : null]
      .filter((p): p is string => Boolean(p))
      .join(" · ");
}

/** An order's articles: name (a link to its sheet once it has one), details and price of one piece. */
export function OrderLines({
  order,
  hrefOf,
}: {
  order: Pick<OrderView, "lines">;
  hrefOf?: (line: OrderLineView) => string | null;
}) {
  const t = useTranslations("Orders.card");
  const locale = useLocale();
  const details = useLineDetails();
  return (
    <ul aria-label={t("articles")} className="flex flex-col gap-space-2">
      {order.lines.map((line) => {
        const href = hrefOf?.(line) ?? null;
        const more = details(line);
        return (
          <li key={line.id} className="flex items-baseline justify-between gap-space-3">
            <span className="flex min-w-space-0 flex-col">
              {href ? (
                <Link
                  href={href}
                  className={`hit-area relative self-start rounded-button font-strong underline underline-offset-3 ${focusRing}`}
                >
                  {line.name}
                </Link>
              ) : (
                <span className="font-strong">{line.name}</span>
              )}
              {more && <span className="text-meta text-ink-muted">{more}</span>}
            </span>
            {line.priceCents !== null && (
              <span className="shrink-0 text-sm font-bold tabular-nums">
                {formatPrice(locale, line.priceCents, line.currency ?? "EUR")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The parcel's step in words, its dates in a second line. */
function ParcelState({ parcel }: { parcel: ParcelView }) {
  const t = useTranslations("Orders.parcel");
  const day = useDay();
  const delivered = parcel.status === "delivered";
  const line =
    delivered && parcel.deliveredAt
      ? t("deliveredOn", { date: day(parcel.deliveredAt) })
      : t(`status.${parcel.status}`);
  const step = parcel.lastEventLabel && !delivered ? parcel.lastEventLabel : null;
  const estimated = !delivered && parcel.estimatedAt ? t("estimated", { date: day(parcel.estimatedAt) }) : null;
  return (
    <div className="flex flex-col gap-space-0-5">
      <span className="flex flex-wrap items-center gap-space-2">
        <span className="clothing-tag relative">{line}</span>
        {step && <span className="text-sm">{step}</span>}
      </span>
      {estimated && <span className="text-sm text-ink-muted">{estimated}</span>}
    </div>
  );
}

/** The errors « Modifier le numéro » says in words; anything else is « Ça n'a pas marché ». */
function numberErrorText(
  t: ReturnType<typeof useTranslations<"Orders.parcel">>,
  tForm: ReturnType<typeof useTranslations<"Orders.form">>,
  error: ClientError | "tracking",
): string {
  if (error === "parcel_exists" || error === "parcel_delivered") return t(`errors.${error}`);
  return errorText(tForm, error === "invalid_request" ? "tracking" : error);
}

/**
 * One parcel: its carrier and number, where it stands, « Suivre chez le transporteur » (every parcel, RF 4), and —
 * not delivered — « Changer de transporteur » and « Modifier le numéro », which start the tracking again; « Supprimer
 * ce suivi » (after a confirmation) for any parcel of an order not set aside.
 */
export function ParcelRow({
  order,
  parcel,
  onChange,
  raised = false,
}: {
  order: OrderView;
  parcel: ParcelView;
  onChange: (order: OrderView) => void;
  /** On a soft block (the article's sheet): the white card, so the parcel stands out. */
  raised?: boolean;
}) {
  const t = useTranslations("Orders.parcel");
  const tForm = useTranslations("Orders.form");
  const ids = { select: useId(), hint: useId(), number: useId(), numberCarrier: useId(), numberError: useId() };
  const [carrier, setCarrier] = useState<Carrier | "">(parcel.carrier ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Without a known carrier she picks it at once; otherwise « Changer de transporteur » opens the choice.
  const [fixing, setFixing] = useState(parcel.carrier === null);
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(parcel.trackingNumber);
  const [numberCarrier, setNumberCarrier] = useState<Carrier | "">("");
  const [numberError, setNumberError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const name = parcel.carrier ? t(`carrier.${parcel.carrier}`) : t("carrier.unknown");
  const open = order.status !== "dismissed";
  const canFix = parcel.status !== "delivered" && open;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!carrier) return;
    setBusy(true);
    setMessage(null);
    const result = await changeParcelCarrier(order.id, parcel.id, carrier);
    setBusy(false);
    if (!result.ok) return setMessage({ ok: false, text: tForm("errors.failed") });
    onChange(result.order);
    setFixing(false);
    setMessage({ ok: true, text: t("carrierSaved") });
  };

  const openEditing = () => {
    setNumber(parcel.trackingNumber);
    setNumberCarrier("");
    setNumberError(null);
    setMessage(null);
    setFixing(false);
    setEditing(true);
  };

  const saveNumber = async (event: FormEvent) => {
    event.preventDefault();
    if (!isTrackingInput(number)) return setNumberError(tForm("errors.tracking"));
    setBusy(true);
    setNumberError(null);
    const result = await patchParcel(order.id, parcel.id, {
      trackingNumber: number,
      ...(numberCarrier ? { carrier: numberCarrier } : {}),
    });
    setBusy(false);
    if (!result.ok) return setNumberError(numberErrorText(t, tForm, result.error));
    const next = result.order.parcels.find((p) => p.id === parcel.id);
    setCarrier(next?.carrier ?? "");
    // A number no carrier signs: she picks the carrier, as for a pasted one.
    setFixing(next?.carrier === null);
    setEditing(false);
    onChange(result.order);
    setMessage({ ok: true, text: t("numberSaved") });
  };

  const remove = async () => {
    setBusy(true);
    setDeleteFailed(false);
    const result = await deleteParcel(order.id, parcel.id);
    setBusy(false);
    if (!result.ok) return setDeleteFailed(true);
    setDeleting(false);
    onChange(result.order);
  };

  return (
    <li
      className={`flex flex-col gap-space-2 rounded-card p-space-3 ${raised ? "bg-surface-raised" : "bg-surface-sunken"}`}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-space-3">
        <span className="font-strong">{name}</span>
        <span className="text-meta text-ink-muted tabular-nums">{parcel.trackingNumber}</span>
      </span>
      <ParcelState parcel={parcel} />
      <a
        href={carrierTrackingUrl(parcel.carrier, parcel.trackingNumber)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkActionClass}
      >
        {t("follow")}
        <span className="sr-only"> {t("newTab")}</span>
      </a>
      {open && !editing && (
        <span className="flex flex-wrap gap-x-space-4 gap-y-space-2">
          {canFix && !fixing && (
            <button type="button" onClick={() => setFixing(true)} className={moreButtonClass}>
              {t("changeCarrier")}
            </button>
          )}
          {canFix && (
            <button type="button" onClick={openEditing} className={moreButtonClass}>
              {t("editNumber")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDeleteFailed(false);
              setDeleting(true);
            }}
            className={moreButtonClass}
          >
            {t("deleteTracking")}
          </button>
        </span>
      )}
      {canFix && fixing && !editing && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-space-2">
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.select} className="text-sm font-strong">
              {t("pickCarrier")}
            </label>
            <select
              id={ids.select}
              value={carrier}
              aria-describedby={ids.hint}
              onChange={(e) => setCarrier(e.target.value as Carrier | "")}
              className={`${inputClass} min-h-touch-target w-auto`}
            >
              {!parcel.carrier && <option value="">{t("pickPlaceholder")}</option>}
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {t(`carrier.${c}`)}
                </option>
              ))}
            </select>
          </span>
          <button
            type="submit"
            disabled={busy || !carrier || carrier === parcel.carrier}
            className={`${buttonClass} min-h-touch-target disabled:opacity-60`}
          >
            {t("saveCarrier")}
          </button>
          <p id={ids.hint} className="w-full text-meta text-ink-muted">
            {t("carrierHint")}
          </p>
        </form>
      )}
      {canFix && editing && (
        <form noValidate onSubmit={saveNumber} className="flex flex-col gap-space-3">
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.number} className="text-sm font-strong">
              {t("trackingField")}
            </label>
            <input
              id={ids.number}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={MAX_TRACKING_NUMBER * 2}
              aria-invalid={numberError ? true : undefined}
              aria-describedby={numberError ? ids.numberError : undefined}
              className={`${inputClass} min-h-touch-target`}
            />
          </span>
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.numberCarrier} className="text-sm font-strong">
              {t("carrierOptional")}
            </label>
            <select
              id={ids.numberCarrier}
              value={numberCarrier}
              onChange={(e) => setNumberCarrier(e.target.value as Carrier | "")}
              className={`${inputClass} min-h-touch-target w-auto self-start`}
            >
              <option value="">{t("carrierAuto")}</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {t(`carrier.${c}`)}
                </option>
              ))}
            </select>
          </span>
          {numberError && (
            <p id={ids.numberError} role="alert" className="text-sm text-danger">
              {numberError}
            </p>
          )}
          <span className="flex flex-wrap gap-space-2">
            <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
              {t("saveNumber")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`${buttonClass} min-h-touch-target`}>
              {t("cancel")}
            </button>
          </span>
        </form>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-danger"}`}>
          {message.text}
        </p>
      )}
      <Dialog open={deleting} onClose={() => setDeleting(false)} title={t("deleteTitle")} closeLabel={t("cancel")}>
        <p>{t("deleteBody")}</p>
        {deleteFailed && (
          <p role="alert" className="text-sm text-danger">
            {tForm("errors.failed")}
          </p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className={`${primaryButtonClass} min-h-touch-target self-start`}
        >
          {t("deleteConfirm")}
        </button>
      </Dialog>
    </li>
  );
}

/** An order's parcels. */
export function ParcelList({
  order,
  onChange,
  raised = false,
}: {
  order: OrderView;
  onChange: (order: OrderView) => void;
  raised?: boolean;
}) {
  const t = useTranslations("Orders.card");
  if (order.parcels.length === 0) return null;
  return (
    <ul aria-label={t("parcels")} className="flex flex-col gap-space-2">
      {order.parcels.map((parcel) => (
        <ParcelRow key={parcel.id} order={order} parcel={parcel} onChange={onChange} raised={raised} />
      ))}
    </ul>
  );
}

/**
 * « Ajouter un numéro de suivi » on her article « Commandé »: a button that opens the number and, optionally, the
 * carrier (guessed from the number otherwise).
 */
export function TrackingForm({ itemId, onAdded }: { itemId: string; onAdded: (order: OrderView) => void }) {
  const t = useTranslations("Orders.parcel");
  const tForm = useTranslations("Orders.form");
  const ids = { number: useId(), carrier: useId(), error: useId() };
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [carrier, setCarrier] = useState<Carrier | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <div className="flex flex-col gap-space-1">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(false);
          }}
          className={`${buttonClass} min-h-touch-target self-start font-strong`}
        >
          {t("addTracking")}
        </button>
        {done && (
          <p role="status" className="text-sm">
            {t("added")}
          </p>
        )}
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isTrackingInput(number)) return setError(tForm("errors.tracking"));
    setBusy(true);
    setError(null);
    const result = await addItemTracking(itemId, { trackingNumber: number, ...(carrier ? { carrier } : {}) });
    setBusy(false);
    if (!result.ok) return setError(errorText(tForm, result.error === "invalid_request" ? "tracking" : result.error));
    onAdded(result.order);
    setNumber("");
    setCarrier("");
    setOpen(false);
    setDone(true);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-space-3">
      <span className="flex flex-col gap-space-1">
        <label htmlFor={ids.number} className="text-sm font-strong">
          {t("trackingField")}
        </label>
        <input
          id={ids.number}
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={MAX_TRACKING_NUMBER * 2}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          className={`${inputClass} min-h-touch-target`}
        />
      </span>
      <span className="flex flex-col gap-space-1">
        <label htmlFor={ids.carrier} className="text-sm font-strong">
          {t("carrierOptional")}
        </label>
        <select
          id={ids.carrier}
          value={carrier}
          onChange={(e) => setCarrier(e.target.value as Carrier | "")}
          className={`${inputClass} min-h-touch-target w-auto self-start`}
        >
          <option value="">{t("carrierAuto")}</option>
          {CARRIERS.map((c) => (
            <option key={c} value={c}>
              {t(`carrier.${c}`)}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <span className="flex flex-wrap gap-space-2">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
          {t("add")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${buttonClass} min-h-touch-target`}>
          {t("cancel")}
        </button>
      </span>
    </form>
  );
}

/** What went wrong, in her words (`tracking`: the number the API refused). */
export function errorText(
  t: ReturnType<typeof useTranslations<"Orders.form">>,
  error: ClientError | "tracking",
): string {
  switch (error) {
    case "tracking":
    case "item_not_ordered":
    case "tracking_exists":
    case "order_exists":
    case "rate_limited":
      return t(`errors.${error}`);
    default:
      return t("errors.failed");
  }
}
