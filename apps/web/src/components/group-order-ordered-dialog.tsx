"use client";

import type { GroupOrderOrder, OwnerGroupOrder } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState } from "react";
import { parsePriceCents } from "@/lib/price";
import { Dialog } from "./dialog";
import { centsToField } from "./group-order-open-dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

type Row = { id: string; name: string; person: string; quantity: number };

/** Every active line, the owner's first: what « J'ai commandé » prices. */
export function activeRows(order: OwnerGroupOrder, you: string, noName: string): Row[] {
  return order.people.flatMap((person) =>
    person.lines
      .filter((line) => line.removedAt === null)
      .map((line) => ({
        id: line.id,
        name: line.name || noName,
        person: person.isOwner ? person.name || you : person.name,
        quantity: line.quantity,
      })),
  );
}

/** The shipping to prefill: none once free shipping is reached, else the order's. */
export function shippingToPay(order: OwnerGroupOrder): number {
  return order.totals.remainingForFreeCents === 0 ? 0 : order.shipping.shippingCents;
}

/** The fields as she first sees them: each line's known price (empty when unknown) and the shipping. */
function prefill(order: OwnerGroupOrder): { prices: Record<string, string>; shipping: string } {
  const prices: Record<string, string> = {};
  for (const person of order.people)
    for (const line of person.lines)
      if (line.removedAt === null)
        prices[line.id] = line.unitPriceCents === null ? "" : centsToField(line.unitPriceCents);
  return { prices, shipping: centsToField(shippingToPay(order)) };
}

/**
 * « J'ai commandé » (spec § 4.3): each active line with its price, all of them changeable (promo code, real price),
 * and the real shipping. Every price is needed. `onConfirm` gets the body for the API; the page asks about gifts
 * first and sends it.
 */
export function GroupOrderOrderedDialog({
  open,
  resetKey,
  order,
  error,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** Changed each time she opens it from « J'ai commandé »: the fields start again from the order. */
  resetKey: number;
  order: OwnerGroupOrder;
  /** The API's refusal, shown once the window comes back. */
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (body: GroupOrderOrder) => void;
}) {
  const t = useTranslations("GroupOrder.ordered");
  const tLine = useTranslations("GroupOrder.line");
  const tErrors = useTranslations("GroupOrder.errors");
  const tOpen = useTranslations("GroupOrder.open");
  const id = useId();
  const [fields, setFields] = useState(() => prefill(order));
  const [invalid, setInvalid] = useState<string | null>(null);

  // A new « J'ai commandé »: from the order as it is now (only then: a read every 10 s never changes what she typed).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `order` is read at that moment on purpose.
  useEffect(() => {
    setFields(prefill(order));
    setInvalid(null);
  }, [resetKey]);

  const rows = activeRows(order, t("you"), tLine("noName"));

  function submit(event: FormEvent) {
    event.preventDefault();
    setInvalid(null);
    const lines: GroupOrderOrder["lines"] = [];
    for (const row of rows) {
      const parsed = parsePriceCents(fields.prices[row.id] ?? "");
      if (!parsed.ok) return setInvalid(tErrors("amount"));
      if (parsed.cents === undefined) return setInvalid(tErrors("missingPrice"));
      lines.push({ id: row.id, priceCents: parsed.cents });
    }
    const shipping = parsePriceCents(fields.shipping);
    if (!shipping.ok) return setInvalid(tErrors("amount"));
    onConfirm({ shippingCents: shipping.cents ?? 0, lines });
  }

  const message = invalid ?? error;
  return (
    <Dialog open={open} onClose={onClose} title={t("title")} closeLabel={tOpen("close")}>
      <form onSubmit={submit} className="flex flex-col gap-space-4">
        <p className="text-sm text-ink-muted">{t("intro")}</p>
        <ul className="flex flex-col gap-space-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-space-1">
              <label htmlFor={`${id}-${row.id}`} className="text-sm font-strong break-words">
                {t("price", { name: row.name, person: row.person })}
              </label>
              <div className="flex items-center gap-space-2">
                <input
                  id={`${id}-${row.id}`}
                  inputMode="decimal"
                  aria-required="true"
                  value={fields.prices[row.id] ?? ""}
                  onChange={(event) =>
                    setFields((previous) => ({
                      ...previous,
                      prices: { ...previous.prices, [row.id]: event.target.value },
                    }))
                  }
                  className={`${inputClass} ${touch} max-w-sidebar`}
                />
                <span className="text-sm text-ink-muted">€</span>
                {row.quantity > 1 && (
                  <span className="text-sm text-ink-muted">{t("quantity", { quantity: row.quantity })}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-space-1 border-t border-line pt-space-3">
          <label htmlFor={`${id}-shipping`} className="text-sm font-strong">
            {t("shipping")}
          </label>
          <div className="flex items-center gap-space-2">
            <input
              id={`${id}-shipping`}
              inputMode="decimal"
              value={fields.shipping}
              onChange={(event) => setFields((previous) => ({ ...previous, shipping: event.target.value }))}
              className={`${inputClass} ${touch} max-w-sidebar`}
            />
            <span className="text-sm text-ink-muted">€</span>
          </div>
        </div>
        {message && (
          <p role="alert" className="text-sm text-danger">
            {message}
          </p>
        )}
        <div className="flex flex-wrap gap-space-2">
          <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
            {t("submit")}
          </button>
          <button type="button" onClick={onClose} className={`${buttonClass} ${touch}`}>
            {t("cancel")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
