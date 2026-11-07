"use client";

import { audienceSchema, itemSortSchema, type LoveLevel, type ReferenceView, type TagView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { levelOf } from "@/lib/love-levels";
import { useLoveLevels } from "@/lib/profile-context";
import { STAGE_FILTER_OPTIONS, type ViewFilters } from "@/lib/wardrobe-view";
import { buttonClass, focusRing, inputClass } from "./ui";

type Props = {
  filters: ViewFilters;
  onChange: (filters: ViewFilters) => void;
  shops: readonly { id: string; name: string }[];
  tags: readonly TagView[];
  reference: ReferenceView | null;
  /** Number of filters on (the sort does not count). */
  activeCount: number;
};

const field = `${inputClass} min-h-touch-target`;
const chipClass = `inline-flex min-h-touch-target items-center gap-space-1 rounded-full border border-line bg-surface-raised px-space-3 text-sm text-ink hover:bg-surface-strong aria-pressed:border-accent aria-pressed:bg-surface-strong aria-pressed:font-strong ${focusRing}`;
/** Highest first, as in the menu of a card: En feu, Mims, J'aime, Bof. */
const CHIP_LEVELS: readonly LoveLevel[] = [4, 3, 2, 1];

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-space-1">
      <label htmlFor={id} className="text-sm font-strong">
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={field}>
        {children}
      </select>
    </div>
  );
}

/**
 * Sort, her level chips (several at once) and « Prioritaires », then the other filters (shop, type, colour,
 * audience, tag, stage) in a panel; state lives in the address.
 */
export function FiltersBar({ filters, onChange, shops, tags, reference, activeCount }: Props) {
  const t = useTranslations("Views.filters");
  const levels = useLoveLevels();
  const [open, setOpen] = useState(activeCount > 0);
  const panel = useId();

  const categories = useMemo(() => {
    if (!reference) return [];
    const byId = new Map(reference.categories.map((c) => [c.id, c]));
    const label = (id: string): string => {
      const c = byId.get(id);
      if (!c) return "";
      return c.parentId && byId.has(c.parentId) ? `${label(c.parentId)} › ${c.name}` : c.name;
    };
    return reference.categories
      .map((c) => ({ id: c.id, label: label(c.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  }, [reference]);

  const set = (patch: Partial<Record<keyof ViewFilters, string>>) => {
    const next: Record<string, unknown> = { ...filters };
    for (const [key, value] of Object.entries(patch)) {
      if (value === "") delete next[key];
      else next[key] = value;
    }
    onChange(next as ViewFilters);
  };

  const toggleLevel = (level: LoveLevel) => {
    const chosen = new Set(filters.levels);
    if (!chosen.delete(level)) chosen.add(level);
    const { levels: _, ...rest } = filters;
    onChange(chosen.size > 0 ? { ...rest, levels: [...chosen].sort((a, b) => b - a) } : rest);
  };
  const togglePriority = () => {
    const { priority: _, ...rest } = filters;
    onChange(filters.priority ? rest : { ...rest, priority: true });
  };

  return (
    <div className="flex flex-col gap-space-3">
      <div className="flex flex-wrap items-end gap-space-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((value) => !value)}
          className={`${buttonClass} min-h-touch-target`}
        >
          {activeCount > 0 ? t("active", { count: activeCount }) : t("title")}
        </button>
        <Select label={t("sort")} value={filters.sort ?? "recent"} onChange={(value) => set({ sort: value })}>
          {itemSortSchema.options.map((sort) => (
            <option key={sort} value={sort}>
              {t(`sortOptions.${sort}`)}
            </option>
          ))}
        </Select>
        {activeCount > 0 && (
          <button
            type="button"
            className={`${buttonClass} min-h-touch-target`}
            onClick={() => onChange(filters.sort ? { sort: filters.sort } : {})}
          >
            {t("reset")}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-space-2">
        <fieldset className="flex flex-wrap gap-space-2">
          <legend className="sr-only">{t("levels")}</legend>
          {CHIP_LEVELS.map((level) => {
            const { emoji, label } = levelOf(levels, level);
            return (
              <button
                key={level}
                type="button"
                aria-pressed={filters.levels?.includes(level) ?? false}
                onClick={() => toggleLevel(level)}
                className={chipClass}
              >
                <span aria-hidden="true">{emoji}</span>
                {label}
              </button>
            );
          })}
        </fieldset>
        <button type="button" aria-pressed={filters.priority ?? false} onClick={togglePriority} className={chipClass}>
          {t("priority")}
        </button>
      </div>
      {open && (
        <div
          id={panel}
          className="grid grid-cols-1 gap-space-3 rounded-card border border-line bg-surface-raised p-space-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Select label={t("shop")} value={filters.shop ?? ""} onChange={(value) => set({ shop: value })}>
            <option value="">{t("anyF")}</option>
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </Select>
          <Select label={t("category")} value={filters.category ?? ""} onChange={(value) => set({ category: value })}>
            <option value="">{t("any")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
          <Select label={t("color")} value={filters.color ?? ""} onChange={(value) => set({ color: value })}>
            <option value="">{t("anyF")}</option>
            {reference?.colors.map((color) => (
              <option key={color.id} value={color.id}>
                {color.name}
              </option>
            ))}
          </Select>
          <Select label={t("audience")} value={filters.audience ?? ""} onChange={(value) => set({ audience: value })}>
            <option value="">{t("any")}</option>
            {audienceSchema.options.map((audience) => (
              <option key={audience} value={audience}>
                {t(`audienceOptions.${audience}`)}
              </option>
            ))}
          </Select>
          <Select label={t("tag")} value={filters.tag ?? ""} onChange={(value) => set({ tag: value })}>
            <option value="">{t("anyF")}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Select label={t("stage")} value={filters.stage ?? ""} onChange={(value) => set({ stage: value })}>
            <option value="">{t("stageView")}</option>
            {STAGE_FILTER_OPTIONS.map((stage) => (
              <option key={stage} value={stage}>
                {t(`stageOptions.${stage}`)}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
