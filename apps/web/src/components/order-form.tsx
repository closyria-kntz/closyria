"use client";

import { type Carrier, MAX_ORDER_LINES, MAX_SHOP_NAME, type OrderLineInput } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { checkLines, emptyLine, isTrackingInput, type LineDraft } from "@/lib/orders-form";
import { CARRIERS } from "./order-parts";
import { buttonClass, inputClass, moreButtonClass, primaryButtonClass } from "./ui";

export type OrderFormValues = {
  shopName: string;
  lines: OrderLineInput[];
  /** Manual entry only: her tracking number (normalised by the API) and, if she knows it, the carrier. */
  trackingNumber?: string;
  carrier?: Carrier;
};

/** One article of the form: its fields in a group named « Article {n} ». */
function LineFields({
  index,
  line,
  onChange,
  onRemove,
  invalid,
  errorId,
}: {
  index: number;
  line: LineDraft;
  onChange: (line: LineDraft) => void;
  onRemove: (() => void) | null;
  /** The field the form's message is about, if it is one of this line's. */
  invalid: keyof LineDraft | null;
  errorId: string;
}) {
  const t = useTranslations("Orders.form");
  const id = useId();
  const field = (key: keyof LineDraft, label: string, extra: { inputMode?: "decimal" | "numeric"; wide?: boolean }) => (
    <span className={`flex min-w-space-0 flex-col gap-space-1 ${extra.wide ? "col-span-2" : ""}`}>
      <label htmlFor={`${id}-${key}`} className="text-sm font-strong">
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        value={line[key]}
        inputMode={extra.inputMode}
        autoComplete="off"
        onChange={(e) => onChange({ ...line, [key]: e.target.value })}
        aria-invalid={invalid === key || undefined}
        aria-describedby={invalid === key ? errorId : undefined}
        className={`${inputClass} min-h-touch-target`}
      />
    </span>
  );
  return (
    <fieldset className="flex flex-col gap-space-2 rounded-card bg-surface-raised p-space-3">
      <legend className="float-left text-meta font-bold tracking-wide text-accent uppercase">
        {t("article", { n: index + 1 })}
      </legend>
      <div className="grid grid-cols-2 gap-space-2">
        {field("name", t("name"), { wide: true })}
        {field("sizeLabel", t("size"), {})}
        {field("color", t("color"), {})}
        {field("quantity", t("quantity"), { inputMode: "numeric" })}
        {field("price", t("price"), { inputMode: "decimal" })}
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} className={moreButtonClass}>
          {t("removeLine", { n: index + 1 })}
        </button>
      )}
    </fieldset>
  );
}

/**
 * « Corriger » an order to validate, or type one (« Saisir la commande », « Saisir une commande à la main »): the shop,
 * its articles and — typed by hand — the tracking number. `onSubmit` answers an error to show, or null when done.
 */
export function OrderForm({
  initialShop = "",
  initialLines,
  currencies = [],
  manual = false,
  onSubmit,
  onCancel,
}: {
  initialShop?: string;
  initialLines?: LineDraft[];
  /** The currency of each initial line (a corrected price keeps it). */
  currencies?: readonly (string | null)[];
  /** A typed order: the shop is required, and the tracking number can be given. */
  manual?: boolean;
  onSubmit: (values: OrderFormValues) => Promise<string | null>;
  onCancel: () => void;
}) {
  const t = useTranslations("Orders.form");
  const tParcel = useTranslations("Orders.parcel");
  const ids = { shop: useId(), tracking: useId(), carrier: useId(), error: useId() };
  const [shop, setShop] = useState(initialShop);
  const [lines, setLines] = useState<LineDraft[]>(initialLines?.length ? initialLines : [emptyLine()]);
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState<Carrier | "">("");
  const [busy, setBusy] = useState(false);
  /** The message, and the field it is about (`line-{n}-{field}`, `shop`, `tracking`), tied by aria-describedby. */
  const [error, setErrorState] = useState<{ text: string; field: string | null } | null>(null);
  const setError = (text: string | null, field: string | null = null) =>
    setErrorState(text === null ? null : { text, field });
  const describe = (field: string) =>
    error?.field === field ? { "aria-invalid": true as const, "aria-describedby": ids.error } : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (manual && !shop.trim()) return setError(t("errors.shop"), "shop");
    const checked = checkLines(lines, currencies);
    if (!checked.ok) {
      return setError(
        t(`errors.${checked.error}`),
        `line-${checked.index}-${checked.error === "name" ? "name" : "price"}`,
      );
    }
    if (manual && tracking.trim() && !isTrackingInput(tracking)) return setError(t("errors.tracking"), "tracking");
    setBusy(true);
    setError(null);
    const failure = await onSubmit({
      shopName: shop.trim(),
      lines: checked.lines,
      ...(manual && tracking.trim() ? { trackingNumber: tracking, ...(carrier ? { carrier } : {}) } : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <form noValidate onSubmit={submit} aria-busy={busy || undefined} className="flex flex-col gap-space-3">
      <span className="flex flex-col gap-space-1">
        <label htmlFor={ids.shop} className="text-sm font-strong">
          {t("shop")}
        </label>
        <input
          id={ids.shop}
          value={shop}
          maxLength={MAX_SHOP_NAME}
          autoComplete="off"
          onChange={(e) => setShop(e.target.value)}
          {...describe("shop")}
          className={`${inputClass} min-h-touch-target`}
        />
      </span>
      {lines.map((line, index) => (
        <LineFields
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines have no id of their own while she types them.
          key={index}
          index={index}
          line={line}
          onChange={(next) => setLines(lines.map((l, i) => (i === index ? next : l)))}
          onRemove={lines.length > 1 ? () => setLines(lines.filter((_, i) => i !== index)) : null}
          invalid={
            error?.field === `line-${index}-name` ? "name" : error?.field === `line-${index}-price` ? "price" : null
          }
          errorId={ids.error}
        />
      ))}
      {lines.length < MAX_ORDER_LINES && (
        <button type="button" onClick={() => setLines([...lines, emptyLine()])} className={moreButtonClass}>
          {t("addLine")}
        </button>
      )}
      {manual && (
        <div className="grid grid-cols-1 gap-space-2 sm:grid-cols-2">
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.tracking} className="text-sm font-strong">
              {t("tracking")}
            </label>
            <input
              id={ids.tracking}
              value={tracking}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setTracking(e.target.value)}
              {...describe("tracking")}
              className={`${inputClass} min-h-touch-target`}
            />
          </span>
          <span className="flex flex-col gap-space-1">
            <label htmlFor={ids.carrier} className="text-sm font-strong">
              {t("carrier")}
            </label>
            <select
              id={ids.carrier}
              value={carrier}
              onChange={(e) => setCarrier(e.target.value as Carrier | "")}
              className={`${inputClass} min-h-touch-target`}
            >
              <option value="">{tParcel("carrierAuto")}</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {tParcel(`carrier.${c}`)}
                </option>
              ))}
            </select>
          </span>
        </div>
      )}
      {error && (
        <p id={ids.error} role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      )}
      <span className="flex flex-wrap gap-space-2">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} min-h-touch-target`}>
          {t("save")}
        </button>
        <button type="button" onClick={onCancel} className={`${buttonClass} min-h-touch-target`}>
          {t("cancel")}
        </button>
      </span>
    </form>
  );
}
