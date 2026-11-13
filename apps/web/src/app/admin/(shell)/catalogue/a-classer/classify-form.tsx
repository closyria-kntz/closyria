"use client";

import type { AdminUnclassifiedProduct } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { inputClass, primaryButtonClass } from "../../../ui";

type Option = { id: string; label: string };

/** Type and colour of one article, and « Appliquer aux articles du même type de cette boutique ». */
export function ClassifyForm({
  product,
  options,
}: {
  product: AdminUnclassifiedProduct;
  options: { categories: Option[]; colors: Option[] };
}) {
  const t = useTranslations("Admin.unclassified");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const id = useId();
  // Starts from the current filing: often only one of the two is missing.
  const [categoryId, setCategoryId] = useState(product.categoryId ?? "");
  const [colorId, setColorId] = useState(product.colorId ?? "");
  const [applyToShopType, setApplyToShopType] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!categoryId || !colorId) return setMessage({ text: t("missing"), failed: true });
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("PATCH", `/api/admin/products/${product.id}/classification`, {
      categoryId,
      colorId,
      ...(product.productType ? { applyToShopType } : {}),
    });
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(productErrorKey(res.status, res.body)), failed: true });
    const updated = (res.body as { updated?: unknown } | null)?.updated;
    setMessage({ text: t("done", { updated: typeof updated === "number" ? updated : 1 }), failed: false });
    router.refresh();
  };

  const select = (label: string, value: string, onChange: (v: string) => void, choices: Option[]) => (
    <label className="flex min-w-0 flex-1 flex-col gap-space-1 text-sm">
      {label}
      <select required value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        <option value="">{t("choose")}</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    // Unnamed: two articles can share a name, and named forms are landmarks that must be unique.
    <form onSubmit={submit} className="flex flex-col gap-space-2">
      <div className="flex flex-col gap-space-2 sm:flex-row">
        {select(t("category"), categoryId, setCategoryId, options.categories)}
        {select(t("color"), colorId, setColorId, options.colors)}
      </div>
      {product.productType ? (
        <label htmlFor={`${id}-apply`} className="flex min-h-touch-target items-center gap-space-2 text-sm">
          <input
            id={`${id}-apply`}
            type="checkbox"
            checked={applyToShopType}
            onChange={(e) => setApplyToShopType(e.target.checked)}
            className="size-space-5 accent-accent"
          />
          {t("applyToType")}
        </label>
      ) : null}
      <div>
        <button type="submit" className={`${primaryButtonClass} min-h-touch-target`} disabled={busy}>
          {t("submit")}
        </button>
      </div>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </form>
  );
}
