"use client";

import { type ManualEntry, manualEntrySchema, nameFromUrl, type ProductView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { inputClass, primaryButtonClass } from "@/components/ui";
import { saveManual } from "@/lib/catalog-client";
import { parsePriceCents, parseSizes } from "@/lib/price";

type ErrorKey = "name" | "price" | "sizes" | "failed" | "rateLimited";

/** Name (pre-filled from the address), price and sizes. No photo. */
export function ManualForm({
  productId,
  canonicalUrl,
  onSaved,
}: {
  productId: string;
  canonicalUrl: string;
  onSaved: (product: ProductView) => void;
}) {
  const t = useTranslations("Capture");
  const ids = { name: useId(), price: useId(), sizes: useId(), sizesHint: useId(), error: useId() };
  const [name, setName] = useState(() => nameFromUrl(canonicalUrl) ?? "");
  const [price, setPrice] = useState("");
  const [sizes, setSizes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedPrice = parsePriceCents(price);
    if (!parsedPrice.ok) return setError("price");
    const entry: ManualEntry = { name: name.trim(), sizes: parseSizes(sizes) };
    if (parsedPrice.cents !== undefined) entry.priceCents = parsedPrice.cents;
    const checked = manualEntrySchema.safeParse(entry);
    if (!checked.success) {
      const field = checked.error.issues[0]?.path[0];
      return setError(field === "name" ? "name" : field === "priceCents" ? "price" : "sizes");
    }
    setBusy(true);
    setError(null);
    const result = await saveManual(productId, checked.data);
    setBusy(false);
    if (!result.ok) return setError(result.error === "rate_limited" ? "rateLimited" : "failed");
    onSaved(result.product);
  };

  const invalid = (key: ErrorKey) => (error === key ? true : undefined);
  const described = (...list: (string | false)[]) => list.filter(Boolean).join(" ") || undefined;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-space-3">
      <label htmlFor={ids.name} className="font-strong">
        {t("manual.nameLabel")}
      </label>
      <input
        id={ids.name}
        name="name"
        type="text"
        autoComplete="off"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-invalid={invalid("name")}
        aria-describedby={described(error === "name" && ids.error)}
        className={inputClass}
      />
      <label htmlFor={ids.price} className="font-strong">
        {t("manual.priceLabel")}
      </label>
      <input
        id={ids.price}
        name="price"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={t("manual.pricePlaceholder")}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        aria-invalid={invalid("price")}
        aria-describedby={described(error === "price" && ids.error)}
        className={`${inputClass} tabular-nums`}
      />
      <label htmlFor={ids.sizes} className="font-strong">
        {t("manual.sizesLabel")}
      </label>
      <input
        id={ids.sizes}
        name="sizes"
        type="text"
        autoComplete="off"
        value={sizes}
        onChange={(e) => setSizes(e.target.value)}
        aria-invalid={invalid("sizes")}
        aria-describedby={described(ids.sizesHint, error === "sizes" && ids.error)}
        className={inputClass}
      />
      <p id={ids.sizesHint} className="text-sm text-ink-muted">
        {t("manual.sizesHint")}
      </p>
      {error && (
        <p id={ids.error} role="alert" className="text-danger">
          {error === "rateLimited" ? t("errors.rateLimited") : t(`manual.errors.${error}`)}
        </p>
      )}
      <button type="submit" className={primaryButtonClass} disabled={busy}>
        {busy ? t("busy") : t("manual.save")}
      </button>
    </form>
  );
}
