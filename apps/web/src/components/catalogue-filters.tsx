"use client";

import { catalogSortSchema, type ReferenceView, type ShopValue, shopValueSchema } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ChipCheck, chipClass, FiltersPanel, Select, useCategoryOptions } from "@/components/filters-bar";
import { focusRing } from "@/components/ui";
import {
  activeCatalogueFilterCount,
  type CatalogueFilters,
  DEFAULT_CATALOGUE_SORT,
  type FilterRef,
  MAX_CATALOGUE_SEARCH,
  MY_SIZES_PATH,
  PRICE_RANGES,
  type PriceRange,
  withoutFilter,
} from "@/lib/catalogue-client";

/** How long the search waits after the last key before it asks again (as « Mes articles »). */
const SEARCH_PAUSE_MS = 300;

type Flag = "mySize" | "onSale" | "isNew";

/** A change of the filters, from the latest ones. */
export type FiltersChange = (current: CatalogueFilters) => CatalogueFilters;

/** An active filter: the chip of a chosen one (the hint fill), a tap takes it off. */
const activeChipClass = chipClass.replace("bg-surface-strong", "bg-hint");

/**
 * Her search on the catalogue (article, shop, « robe rouge »), always open at the top of « Découvrir » (mockup .srch):
 * what she types goes to the address after a short pause; cleared elsewhere (« Effacer les filtres », the back button),
 * it follows the address.
 */
export function CatalogueSearch({ value, onChange }: { value: string | undefined; onChange: (q?: string) => void }) {
  const t = useTranslations("Discover.search");
  const fieldId = useId();
  const [text, setText] = useState(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const told = useRef(onChange);
  told.current = onChange;
  useEffect(() => {
    clearTimeout(timer.current);
    setText(value ?? "");
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const type = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => told.current(next.trim().slice(0, MAX_CATALOGUE_SEARCH).trim() || undefined),
      SEARCH_PAUSE_MS,
    );
  };
  return (
    <search
      aria-label={t("label")}
      className="relative isolate flex h-control-sm w-full min-w-space-0 flex-1 items-center rounded-pill bg-surface-strong pl-space-3 sm:h-control-plus lg:max-w-panel"
    >
      <label htmlFor={fieldId} className="hit-area-under flex shrink-0 text-ink-muted">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="size-space-4"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span className="sr-only">{t("label")}</span>
      </label>
      <input
        id={fieldId}
        type="search"
        value={text}
        maxLength={MAX_CATALOGUE_SEARCH}
        placeholder={t("placeholder")}
        onChange={(event) => type(event.target.value)}
        className={`min-w-space-0 flex-1 self-stretch rounded-pill bg-transparent px-space-2 text-ui text-ink placeholder:text-ink-muted ${focusRing}`}
      />
    </search>
  );
}

/**
 * « Filtres et tri » of « Découvrir » (spec D4), the same panel as « Mes articles »: « Ma taille en stock », « En
 * baisse », « Nouveautés » and the shop's values as chips, then the sort, the type, the colour, the price and the shop.
 * Without any of « Mes tailles », « Ma taille en stock » is greyed and « Ajoute tes tailles » leads to them.
 */
export function CatalogueFiltersMenu({
  filters,
  onChange,
  shops,
  reference,
  hasSizes,
}: {
  filters: CatalogueFilters;
  /** Changes the filters from the latest ones (two quick taps never undo each other). */
  onChange: (change: FiltersChange) => void;
  shops: readonly { id: string; name: string }[];
  reference: ReferenceView | null;
  /** Whether her profile has any size; null until the first page said so. */
  hasSizes: boolean | null;
}) {
  const t = useTranslations("Discover.filters");
  const categories = useCategoryOptions(reference);
  const noSizes = hasSizes === false;
  // The search is not in the panel: it does not count on its button.
  const count = activeCatalogueFilterCount(filters, hasSizes) - (filters.q ? 1 : 0);

  const toggle = (flag: Flag) =>
    onChange((current) => (current[flag] ? withoutFilter(current, { key: flag }) : { ...current, [flag]: true }));
  const toggleValue = (value: ShopValue) =>
    onChange((current) => {
      const chosen = new Set(current.values);
      if (!chosen.delete(value)) chosen.add(value);
      const values = shopValueSchema.options.filter((v) => chosen.has(v));
      const { values: _, ...rest } = current;
      return values.length > 0 ? { ...rest, values } : rest;
    });
  const set = (key: "category" | "color" | "shop" | "price" | "sort", value: string) =>
    onChange((current) => {
      const next: CatalogueFilters = { ...current };
      if (value === "" || (key === "sort" && value === DEFAULT_CATALOGUE_SORT)) delete next[key];
      else (next as Record<string, string>)[key] = value;
      return next;
    });

  const flagChip = (flag: Flag, disabled = false) => {
    const on = !disabled && Boolean(filters[flag]);
    return (
      <button
        type="button"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => toggle(flag)}
        className={`${chipClass} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-strong`}
      >
        {on && <ChipCheck />}
        {t(flag)}
      </button>
    );
  };

  return (
    <FiltersPanel label={t("menu", { count })} title={t("menuTitle")} count={count}>
      <div className="flex flex-col gap-space-2">
        <div className="flex flex-wrap gap-x-space-2 gap-y-space-2-5 sm:gap-space-2-5">
          {flagChip("mySize", noSizes)}
          {flagChip("onSale")}
          {flagChip("isNew")}
        </div>
        {noSizes && (
          <p data-testid="no-sizes" className="text-sm text-ink-muted">
            {t("noSizes")}{" "}
            <Link
              href={MY_SIZES_PATH}
              className={`inline-flex min-h-touch-target items-center font-strong text-ink underline underline-offset-4 ${focusRing}`}
            >
              {t("addSizes")}
            </Link>
          </p>
        )}
      </div>
      <fieldset className="flex flex-col gap-space-2">
        <legend className="mb-space-2 text-sm font-strong">{t("values")}</legend>
        <div className="flex flex-wrap gap-x-space-2 gap-y-space-2-5 sm:gap-space-2-5">
          {shopValueSchema.options.map((value) => {
            const on = filters.values?.includes(value) ?? false;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleValue(value)}
                className={chipClass}
              >
                {on && <ChipCheck />}
                {t(`valueOptions.${value}`)}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
        <Select label={t("sort")} value={filters.sort ?? DEFAULT_CATALOGUE_SORT} onChange={(v) => set("sort", v)}>
          {catalogSortSchema.options.map((sort) => (
            <option key={sort} value={sort}>
              {t(`sortOptions.${sort}`)}
            </option>
          ))}
        </Select>
        <Select label={t("category")} value={filters.category ?? ""} onChange={(v) => set("category", v)}>
          <option value="">{t("any")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </Select>
        <Select label={t("color")} value={filters.color ?? ""} onChange={(v) => set("color", v)}>
          <option value="">{t("anyF")}</option>
          {reference?.colors.map((color) => (
            <option key={color.id} value={color.id}>
              {color.name}
            </option>
          ))}
        </Select>
        <Select label={t("price")} value={filters.price ?? ""} onChange={(v) => set("price", v)}>
          <option value="">{t("any")}</option>
          {PRICE_RANGES.map((range) => (
            <option key={range} value={range}>
              {t(`priceOptions.${range}`)}
            </option>
          ))}
        </Select>
        <Select label={t("shop")} value={filters.shop ?? ""} onChange={(v) => set("shop", v)}>
          <option value="">{t("anyF")}</option>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </Select>
      </div>
    </FiltersPanel>
  );
}

/**
 * The filters on, as chips under the tools (spec §3.1 « pastilles des filtres actifs »): each one says what it is and
 * a tap takes it off; the sort is not a filter.
 */
export function ActiveFilterChips({
  filters,
  onChange,
  shops,
  reference,
  hasSizes,
}: {
  filters: CatalogueFilters;
  onChange: (change: FiltersChange) => void;
  shops: readonly { id: string; name: string }[];
  reference: ReferenceView | null;
  /** Whether her profile has any size; without any, « Ma taille en stock » filters nothing and gets no chip. */
  hasSizes: boolean | null;
}) {
  const t = useTranslations("Discover.filters");
  const chips: { ref: FilterRef; label: string }[] = [];
  if (filters.q) chips.push({ ref: { key: "q" }, label: t("search", { q: filters.q }) });
  if (filters.mySize && hasSizes !== false) chips.push({ ref: { key: "mySize" }, label: t("mySize") });
  if (filters.onSale) chips.push({ ref: { key: "onSale" }, label: t("onSale") });
  if (filters.isNew) chips.push({ ref: { key: "isNew" }, label: t("isNew") });
  for (const value of filters.values ?? []) {
    chips.push({ ref: { key: "values", value }, label: t(`valueOptions.${value}`) });
  }
  const category = reference?.categories.find((c) => c.id === filters.category);
  if (filters.category) chips.push({ ref: { key: "category" }, label: category?.name ?? t("category") });
  const color = reference?.colors.find((c) => c.id === filters.color);
  if (filters.color) chips.push({ ref: { key: "color" }, label: color?.name ?? t("color") });
  if (filters.price) chips.push({ ref: { key: "price" }, label: t(`priceOptions.${filters.price as PriceRange}`) });
  const shop = shops.find((s) => s.id === filters.shop);
  if (filters.shop) chips.push({ ref: { key: "shop" }, label: shop?.name ?? t("shop") });
  if (chips.length === 0) return null;
  return (
    <ul aria-label={t("active")} className="flex flex-wrap gap-space-2">
      {chips.map(({ ref, label }) => (
        <li key={`${ref.key}-${"value" in ref ? ref.value : ""}`}>
          <button
            type="button"
            aria-label={t("remove", { label })}
            onClick={() => onChange((current) => withoutFilter(current, ref))}
            className={activeChipClass}
          >
            {label}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="size-space-3 shrink-0"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
