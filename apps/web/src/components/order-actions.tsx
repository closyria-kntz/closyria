"use client";

import { MAX_EXTERNAL_REF, MAX_ORDER_SHOP_NAME, type OrderView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { deleteOrder, patchOrder } from "@/lib/orders-client";
import { checkOrderEdit, type OrderEditDraft, orderEditDraftOf, parisDay } from "@/lib/orders-form";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, moreButtonClass, primaryButtonClass } from "./ui";

/**
 * What she does with a whole validated order, on « Mes commandes » and in the « Commande / colis » block of an article
 * (2026-11-15): « Modifier » (its shop's name, its number, its date; its articles change on their own sheets) and
 * « Supprimer la commande », after a confirmation (her articles stay).
 */

/** « Supprimer la commande »: a confirmation, then the order goes (`onDeleted`); her articles stay. */
export function DeleteOrderAction({ order, onDeleted }: { order: OrderView; onDeleted: (orderId: string) => void }) {
  const t = useTranslations("Orders.manage");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const remove = async () => {
    setBusy(true);
    setFailed(false);
    const result = await deleteOrder(order.id);
    setBusy(false);
    // Already gone (another tab): it is gone all the same.
    if (!result.ok && result.error !== "not_found") return setFailed(true);
    setOpen(false);
    onDeleted(order.id);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setOpen(true);
        }}
        className={moreButtonClass}
      >
        {t("delete")}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("deleteTitle")} closeLabel={t("cancel")}>
        <p>{t("deleteBody")}</p>
        {failed && (
          <p role="alert" className="text-sm text-danger">
            {t("failed")}
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
    </>
  );
}

type EditField = "shop" | "ref" | "date";

/** « Modifier » open: the shop's name, the order's number and its day; `onDone` with the order saved, or null. */
function EditOrderForm({ order, onDone }: { order: OrderView; onDone: (order: OrderView | null) => void }) {
  const t = useTranslations("Orders.manage");
  const ids = { shop: useId(), shopHint: useId(), ref: useId(), date: useId(), error: useId() };
  const [draft, setDraft] = useState<OrderEditDraft>(() => orderEditDraftOf(order));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: EditField | null } | null>(null);
  const today = parisDay(new Date());

  const describe = (field: EditField, hint?: string) => {
    const described = [hint, error?.field === field ? ids.error : undefined].filter(Boolean).join(" ");
    return {
      ...(error?.field === field ? { "aria-invalid": true as const } : {}),
      ...(described ? { "aria-describedby": described } : {}),
    };
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const checked = checkOrderEdit(order, draft, new Date());
    if (!checked.ok) return setError({ text: t(`errors.${checked.error}`), field: checked.error });
    if (Object.keys(checked.patch).length === 0) return onDone(null);
    setBusy(true);
    setError(null);
    const result = await patchOrder(order.id, checked.patch);
    setBusy(false);
    if (!result.ok) {
      if (result.error === "order_exists") return setError({ text: t("errors.order_exists"), field: "ref" });
      return setError({ text: t("failed"), field: null });
    }
    onDone(result.order);
  };

  const set = (key: keyof OrderEditDraft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex w-full flex-col gap-space-3">
      <span className="flex flex-col gap-space-1">
        <label htmlFor={ids.shop} className="text-sm font-strong">
          {t("shop")}
        </label>
        <input
          id={ids.shop}
          value={draft.shopName}
          maxLength={MAX_ORDER_SHOP_NAME}
          autoComplete="off"
          onChange={(e) => set("shopName")(e.target.value)}
          {...describe("shop", order.shop ? ids.shopHint : undefined)}
          className={`${inputClass} min-h-touch-target`}
        />
        {order.shop && (
          <span id={ids.shopHint} className="text-meta text-ink-muted">
            {t("shopHint")}
          </span>
        )}
      </span>
      <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.ref} className="text-sm font-strong">
            {t("ref")}
          </label>
          <input
            id={ids.ref}
            value={draft.externalRef}
            maxLength={MAX_EXTERNAL_REF}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => set("externalRef")(e.target.value)}
            {...describe("ref")}
            className={`${inputClass} min-h-touch-target`}
          />
        </span>
        <span className="flex flex-col gap-space-1">
          <label htmlFor={ids.date} className="text-sm font-strong">
            {t("date")}
          </label>
          <input
            id={ids.date}
            type="date"
            value={draft.orderedOn}
            max={today}
            onChange={(e) => set("orderedOn")(e.target.value)}
            {...describe("date")}
            className={`${inputClass} min-h-touch-target`}
          />
        </span>
      </div>
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      )}
      <span className="flex flex-wrap gap-space-2">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
          {t("save")}
        </button>
        <button type="button" onClick={() => onDone(null)} className={`${buttonClass} min-h-touch-target`}>
          {t("cancel")}
        </button>
      </span>
    </form>
  );
}

/**
 * The actions of a validated order: `lead` first (« Voir la commande » on an article's sheet), « Modifier » and
 * « Supprimer la commande ». « Modifier » opens its form in place; once saved, « Commande modifiée. » is said and the
 * focus comes back to « Modifier ».
 */
export function OrderActions({
  order,
  onChange,
  onDeleted,
  lead,
}: {
  order: OrderView;
  onChange: (order: OrderView) => void;
  onDeleted: (orderId: string) => void;
  lead?: ReactNode;
}) {
  const t = useTranslations("Orders.manage");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  // Back to « Modifier » once the form is closed and the button shown again.
  const [closings, setClosings] = useState(0);
  useEffect(() => {
    if (closings > 0) editButton.current?.focus();
  }, [closings]);

  const done = (next: OrderView | null) => {
    setEditing(false);
    if (next) {
      onChange(next);
      setSaved(true);
    }
    setClosings((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-space-2">
      {editing ? (
        <EditOrderForm order={order} onDone={done} />
      ) : (
        <span className="flex flex-wrap items-center gap-x-space-4 gap-y-space-2">
          {lead}
          <button
            ref={editButton}
            type="button"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
            className={moreButtonClass}
          >
            {t("edit")}
          </button>
          <DeleteOrderAction order={order} onDeleted={onDeleted} />
        </span>
      )}
      <p role="status" className="text-sm empty:hidden">
        {saved && !editing ? t("saved") : null}
      </p>
    </div>
  );
}
