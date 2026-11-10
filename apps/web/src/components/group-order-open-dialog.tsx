"use client";

import type { GroupOrderShipping, ShippingOption } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useId, useState } from "react";
import { formatAmount } from "@/lib/budget";
import { parsePriceCents } from "@/lib/price";
import { type ClientError, fetchShopShippingOptions, openGroupOrder } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { groupOrderHref } from "./group-order-banner";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";
const OTHER = "other";

export type ListShop = { id: string; name: string };

/** Today in Paris (`YYYY-MM-DD`): the earliest deadline the API takes. */
export const parisToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

/** The message of an API refusal, under `GroupOrder.errors`. */
export function groupOrderErrorKey(error: ClientError) {
  switch (error) {
    case "already_open":
      return "alreadyOpen";
    case "not_shared":
      return "notShared";
    case "group_order_locked":
      return "locked";
    case "invalid_transition":
      return "transition";
    case "too_many_lines":
      return "tooMany";
    case "currency_mismatch":
      return "currency";
    case "item_deleted":
      return "itemDeleted";
    case "missing_price":
      return "missingPrice";
    default:
      return "failed";
  }
}

/** The delivery typed by hand (« Autre »): label, shipping and the optional threshold, in euros. */
export type ShippingDraft = { label: string; shipping: string; freeFrom: string };

/** « 4,90 » / « 80 » from cents, for a field she may change. */
export const centsToField = (cents: number) =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");

/** The typed delivery as the API takes it, or the key of what is wrong. */
export function parseShipping(
  draft: ShippingDraft,
  fallbackLabel: string,
): { ok: true; shipping: GroupOrderShipping } | { ok: false; error: "amount" | "threshold" } {
  const shipping = parsePriceCents(draft.shipping);
  if (!shipping.ok || shipping.cents === undefined) return { ok: false, error: "amount" };
  const freeFrom = parsePriceCents(draft.freeFrom);
  if (!freeFrom.ok) return { ok: false, error: "amount" };
  if (freeFrom.cents === 0) return { ok: false, error: "threshold" };
  return {
    ok: true,
    shipping: {
      label: draft.label.trim().slice(0, 40) || fallbackLabel,
      shippingCents: shipping.cents,
      freeFromCents: freeFrom.cents ?? null,
    },
  };
}

/** The three fields of a typed delivery. */
export function ShippingFields({
  draft,
  onChange,
}: {
  draft: ShippingDraft;
  onChange: (draft: ShippingDraft) => void;
}) {
  const t = useTranslations("GroupOrder.open");
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-3">
      <div className="flex min-w-space-0 flex-col gap-space-1">
        <label htmlFor={`${id}-label`} className="text-sm font-strong">
          {t("otherLabel")}
        </label>
        <input
          id={`${id}-label`}
          value={draft.label}
          maxLength={40}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
          className={`${inputClass} ${touch}`}
        />
      </div>
      <div className="flex min-w-space-0 flex-col gap-space-1">
        <label htmlFor={`${id}-shipping`} className="text-sm font-strong">
          {t("shipping")}
        </label>
        <input
          id={`${id}-shipping`}
          inputMode="decimal"
          value={draft.shipping}
          onChange={(event) => onChange({ ...draft, shipping: event.target.value })}
          className={`${inputClass} ${touch}`}
        />
      </div>
      <div className="flex min-w-space-0 flex-col gap-space-1">
        <label htmlFor={`${id}-free`} className="text-sm font-strong">
          {t("freeFrom")}
        </label>
        <input
          id={`${id}-free`}
          inputMode="decimal"
          value={draft.freeFrom}
          onChange={(event) => onChange({ ...draft, freeFrom: event.target.value })}
          className={`${inputClass} ${touch}`}
        />
      </div>
    </div>
  );
}

type Options = { status: "loading" } | { status: "ready"; options: ShippingOption[] } | { status: "error" };

/**
 * « Ouvrir une commande groupée » (spec § 4.1): one of the shops of the list's items, the shop's delivery options
 * (from the admin) or « Autre », and an optional deadline. Opened, she lands on the group order's page.
 */
export function GroupOrderOpenDialog({
  open,
  onClose,
  listId,
  shops,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  shops: ListShop[];
}) {
  const t = useTranslations("GroupOrder.open");
  const tErrors = useTranslations("GroupOrder.errors");
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [options, setOptions] = useState<Options>({ status: "loading" });
  const [choice, setChoice] = useState<string>("");
  const [draft, setDraft] = useState<ShippingDraft>({ label: "", shipping: "", freeFrom: "" });
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A shop of the list that went away (its last item removed): the first one left.
  useEffect(() => {
    if (!shops.some((shop) => shop.id === shopId)) setShopId(shops[0]?.id ?? "");
  }, [shops, shopId]);

  // The shop's options each time she picks a shop: the first is chosen, « Autre » without any.
  useEffect(() => {
    if (!open || !shopId) return;
    let live = true;
    setOptions({ status: "loading" });
    void fetchShopShippingOptions(shopId).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setOptions({ status: "error" });
        setChoice(OTHER);
        return;
      }
      setOptions({ status: "ready", options: result.options });
      setChoice(result.options[0]?.id ?? OTHER);
    });
    return () => {
      live = false;
    };
  }, [open, shopId]);

  const money = (cents: number) => formatAmount(locale, cents);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!shopId) return setError(tErrors("noShop"));
    if (deadline && deadline < parisToday()) return setError(tErrors("deadline"));
    let delivery: { shippingOptionId: string } | { shipping: GroupOrderShipping };
    if (choice === OTHER || choice === "") {
      const parsed = parseShipping(draft, t("otherLabelDefault"));
      if (!parsed.ok) return setError(tErrors(parsed.error));
      delivery = { shipping: parsed.shipping };
    } else {
      delivery = { shippingOptionId: choice };
    }
    setBusy(true);
    const result = await openGroupOrder(listId, { shopId, deadline: deadline || null, ...delivery });
    setBusy(false);
    if (!result.ok) return setError(tErrors(groupOrderErrorKey(result.error)));
    onClose();
    router.push(groupOrderHref(listId));
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("title")} closeLabel={t("close")}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-space-4">
        <p className="text-sm text-ink-muted">{t("hint")}</p>
        <div className="flex flex-col gap-space-1">
          <label htmlFor={`${id}-shop`} className="text-sm font-strong">
            {t("shop")}
          </label>
          <select
            id={`${id}-shop`}
            value={shopId}
            onChange={(event) => setShopId(event.target.value)}
            className={`${inputClass} ${touch}`}
          >
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="flex flex-col gap-space-2">
          <legend className="mb-space-1 text-sm font-strong">{t("delivery")}</legend>
          {options.status === "loading" && (
            <p role="status" className="text-sm text-ink-muted">
              {t("optionsLoading")}
            </p>
          )}
          {options.status === "ready" &&
            options.options.map((option) => (
              <Choice
                key={option.id}
                name={`${id}-delivery`}
                checked={choice === option.id}
                onChange={() => setChoice(option.id)}
                label={
                  option.freeFromCents === null
                    ? t("option", { label: option.label, shipping: money(option.shippingCents) })
                    : t("optionThreshold", {
                        label: option.label,
                        shipping: money(option.shippingCents),
                        threshold: money(option.freeFromCents),
                      })
                }
              />
            ))}
          {options.status !== "loading" && (
            <Choice
              name={`${id}-delivery`}
              checked={choice === OTHER}
              onChange={() => setChoice(OTHER)}
              label={t("other")}
            />
          )}
          {choice === OTHER && <ShippingFields draft={draft} onChange={setDraft} />}
        </fieldset>

        <div className="flex flex-col gap-space-1">
          <label htmlFor={`${id}-deadline`} className="text-sm font-strong">
            {t("deadline")}
          </label>
          <input
            id={`${id}-deadline`}
            type="date"
            min={parisToday()}
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
            className={`${inputClass} ${touch}`}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-space-2">
          <button
            type="submit"
            disabled={busy || options.status === "loading"}
            className={`${primaryButtonClass} ${touch}`}
          >
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

/** One delivery to choose: the whole row is the radio's label. */
function Choice({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      className={`flex items-center gap-space-3 rounded-button border px-space-3 py-space-2 text-sm ${touch} ${checked ? "border-accent bg-hint font-strong" : "border-line bg-surface-raised"}`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="size-space-4 accent-accent" />
      <span className="break-words">{label}</span>
    </label>
  );
}
