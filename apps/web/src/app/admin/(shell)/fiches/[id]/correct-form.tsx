"use client";

import type { AdminProductDetail } from "@closyria/shared";
import { audienceSchema, childDetailSchema, seasonSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { adminRequest, productErrorKey } from "@/lib/admin-catalog";
import { type ProductForm, productPatch } from "@/lib/admin-reference";
import { buttonClass, inputClass, primaryButtonClass } from "../../../ui";

type Option = { id: string; label: string };
export type CorrectOptions = { categories: Option[]; colors: Option[]; materials: Option[]; patterns: Option[] };

const euros = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","));

/** « Corriger la fiche »: name, brand, price and filing; any save marks the sheet « Corrigée ». */
export function CorrectForm({ product, options }: { product: AdminProductDetail; options: CorrectOptions }) {
  const t = useTranslations("Admin.products");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const initial: ProductForm = {
    name: product.name ?? "",
    brand: product.brand ?? "",
    price: euros(product.priceCents),
    audience: product.audience ?? "",
    childDetail: product.childDetail ?? "",
    categoryId: product.categoryId ?? "",
    colorId: product.colorId ?? "",
    materialId: product.materialId ?? "",
    patternId: product.patternId ?? "",
    season: product.season ?? "",
  };
  const [form, setForm] = useState<ProductForm>(initial);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // Focus moves into the form when it opens.
  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  // « Annuler » drops what was typed: the form starts again from the sheet.
  const cancel = () => {
    setForm(initial);
    setMessage(null);
    close();
  };
  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const built = productPatch(form, initial);
    if (!built.ok) return setMessage({ text: t(`fieldErrors.${built.field}`), failed: true });
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("PATCH", `/api/admin/products/${product.id}`, built.patch);
    busyRef.current = false;
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(productErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t("saved"), failed: false });
    close();
    router.refresh();
  };

  const field = (key: keyof ProductForm, label: string, extra?: { hint?: string; inputMode?: "decimal" }) => (
    <label className="flex flex-col gap-space-1 text-sm">
      {label}
      <input
        ref={key === "name" ? firstFieldRef : undefined}
        value={form[key]}
        onChange={(e) => set(key, e.target.value as never)}
        className={inputClass}
        {...(extra?.inputMode ? { inputMode: extra.inputMode } : {})}
      />
      {extra?.hint ? <span className="text-ink-muted">{extra.hint}</span> : null}
    </label>
  );
  const select = (key: keyof ProductForm, label: string, choices: { value: string; label: string }[]) => (
    <label className="flex flex-col gap-space-1 text-sm">
      {label}
      <select value={form[key]} onChange={(e) => set(key, e.target.value as never)} className={inputClass}>
        <option value="">{t("noneOption")}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
  const ofOptions = (list: Option[]) => list.map((o) => ({ value: o.id, label: o.label }));

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-center gap-space-3">
        <button
          ref={triggerRef}
          type="button"
          className={buttonClass}
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => (open ? cancel() : setOpen(true))}
        >
          {t("correct")}
        </button>
        <span role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
          {message?.text}
        </span>
      </div>
      {open ? (
        <form
          id={formId}
          onSubmit={submit}
          aria-label={t("correctTitle")}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-sunken p-space-4"
        >
          <div className="grid gap-space-3 md:grid-cols-2">
            {field("name", t("nameField"))}
            {field("brand", t("brandField"))}
            {field("price", t("priceField"), { hint: t("priceHint"), inputMode: "decimal" })}
            {select(
              "audience",
              t("audience"),
              audienceSchema.options.map((v) => ({ value: v, label: t(`audiences.${v}`) })),
            )}
            {form.audience === "child"
              ? select(
                  "childDetail",
                  t("childDetail"),
                  childDetailSchema.options.map((v) => ({ value: v, label: t(`childDetails.${v}`) })),
                )
              : null}
            {select("categoryId", t("categoryField"), ofOptions(options.categories))}
            {select("colorId", t("color"), ofOptions(options.colors))}
            {select("materialId", t("material"), ofOptions(options.materials))}
            {select("patternId", t("pattern"), ofOptions(options.patterns))}
            {select(
              "season",
              t("season"),
              seasonSchema.options.map((v) => ({ value: v, label: t(`seasons.${v}`) })),
            )}
          </div>
          <div className="flex flex-wrap gap-space-2">
            <button type="submit" className={`${primaryButtonClass} aria-disabled:opacity-60`} aria-disabled={busy}>
              {t("save")}
            </button>
            <button type="button" className={buttonClass} onClick={cancel}>
              {t("cancel")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
