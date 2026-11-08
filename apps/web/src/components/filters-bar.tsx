"use client";

import { audienceSchema, itemSortSchema, type LoveLevel, type ReferenceView, type TagView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { levelOf } from "@/lib/love-levels";
import { useLoveLevels } from "@/lib/profile-context";
import { MAX_SEARCH, STAGE_FILTER_OPTIONS, type ViewFilters } from "@/lib/wardrobe-view";
import { focusRing, inputClass } from "./ui";

const field = `${inputClass} min-h-touch-target`;
/** Full, soft chips: sunken fill, no border; chosen = the hint fill, ink text (refonte, gap 3). */
const chipClass = `inline-flex min-h-touch-target items-center gap-space-1 rounded-full bg-surface-sunken px-space-4 text-sm font-strong text-ink transition-colors duration-base hover:bg-surface-strong aria-pressed:bg-hint aria-pressed:hover:bg-hint ${focusRing}`;
/** A round tool of the bar (search, filters): soft fill, a finger wide. */
export const toolClass = `inline-flex size-touch-target shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink hover:bg-surface-strong aria-expanded:bg-hint ${focusRing}`;
/** The drawn check of an active chip (decorative: `aria-pressed` carries the state). */
function ChipCheck() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-space-4 shrink-0"
    >
      <path className="chip-check" pathLength={1} d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  );
}
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
 * The chips under the title: her levels (several at once) and « Prioritaires », then « Effacer le filtre » /
 * « Effacer les N filtres » at the end of the row as soon as one is on (it clears the search too, never the sort).
 */
export function FilterChips({
  filters,
  onChange,
  activeCount,
  onClearAll,
}: {
  filters: ViewFilters;
  onChange: (filters: ViewFilters) => void;
  /** Number of filters on (the sort does not count). */
  activeCount: number;
  /** Clears every filter (the sort stays: it is not a filter). */
  onClearAll: () => void;
}) {
  const t = useTranslations("Views.filters");
  const levels = useLoveLevels();
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
              {filters.levels?.includes(level) && <ChipCheck />}
              <span aria-hidden="true">{emoji}</span>
              {label}
            </button>
          );
        })}
      </fieldset>
      <button type="button" aria-pressed={filters.priority ?? false} onClick={togglePriority} className={chipClass}>
        {filters.priority && <ChipCheck />}
        {t("priority")}
      </button>
      {activeCount > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className={`min-h-touch-target rounded-full px-space-3 text-sm font-strong text-ink underline underline-offset-4 ${focusRing}`}
        >
          {t("clearAll", { count: activeCount })}
        </button>
      )}
    </div>
  );
}

/** The magnifier of the bar: it opens into a field; what she types goes to the address after a short pause. */
export function SearchField({
  value,
  label,
  onChange,
}: {
  value: string | undefined;
  label: string;
  onChange: (value: string | undefined) => void;
}) {
  const t = useTranslations("Views.filters.search");
  const [open, setOpen] = useState(Boolean(value));
  const [text, setText] = useState(value ?? "");
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const told = useRef(onChange);
  told.current = onChange;
  const fieldId = useId();
  // Where the focus goes once the field opens or closes: only after she opened or closed it herself (an address with
  // `recherche=` opens it on load without taking the focus, which would pop up a phone's keyboard).
  const focusNext = useRef<"field" | "button" | null>(null);
  // Cleared elsewhere (« Effacer », the back button): the field follows the address.
  useEffect(() => {
    clearTimeout(timer.current);
    setText(value ?? "");
    if (value) setOpen(true);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // After the render that mounted the field (or the magnifier back): the element exists only now.
  useEffect(() => {
    if (open && focusNext.current === "field") input.current?.focus();
    if (!open && focusNext.current === "button") button.current?.focus();
    focusNext.current = null;
  }, [open]);
  const type = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => told.current(next.trim().slice(0, MAX_SEARCH) || undefined), SEARCH_PAUSE_MS);
  };
  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setText("");
    if (value) onChange(undefined);
    focusNext.current = "button";
  };
  if (!open) {
    return (
      <button
        ref={button}
        type="button"
        aria-label={t("open")}
        aria-expanded={false}
        onClick={() => {
          focusNext.current = "field";
          setOpen(true);
        }}
        className={toolClass}
      >
        <MagnifierIcon />
      </button>
    );
  }
  return (
    <search className="search-open flex h-touch-target w-full min-w-space-0 items-center rounded-full bg-surface-sunken pl-space-3 sm:w-sidebar">
      <label htmlFor={fieldId} className="flex shrink-0 text-ink-muted">
        <MagnifierIcon />
        <span className="sr-only">{label}</span>
      </label>
      <input
        ref={input}
        id={fieldId}
        type="search"
        value={text}
        maxLength={MAX_SEARCH}
        placeholder={label}
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        className="min-w-space-0 flex-1 bg-transparent px-space-2 text-body text-ink outline-none placeholder:text-ink-muted"
      />
      <button
        type="button"
        aria-label={t("close")}
        onClick={close}
        className={`flex size-touch-target shrink-0 items-center justify-center rounded-full text-ink-muted hover:text-ink ${focusRing}`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="size-space-4"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </search>
  );
}

/** How long the search waits after the last key before it asks again. */
const SEARCH_PAUSE_MS = 300;

function MagnifierIcon() {
  return (
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
  );
}

/**
 * The filters and sort menu of the bar: a round button that opens a panel with the sort, then the other filters
 * (shop, type, colour, audience, tag, stage). State lives in the address; Escape or a click outside closes it.
 * The panel is placed against the nearest positioned ancestor (the page's header row).
 */
export function FiltersMenu({
  filters,
  onChange,
  shops,
  tags,
  reference,
  activeCount,
  sortable = true,
}: {
  filters: ViewFilters;
  onChange: (filters: ViewFilters) => void;
  shops: readonly { id: string; name: string }[];
  tags: readonly TagView[];
  reference: ReferenceView | null;
  activeCount: number;
  /** False on a list tab: the list keeps its own order, so there is no sort to offer. */
  sortable?: boolean;
}) {
  const t = useTranslations("Views.filters");
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // One Escape closes the panel and nothing else (not the « Sélectionner » mode behind it).
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture: ahead of the page's own Escape listeners, whenever they were added.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

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
  // The levels, the priority and the search are not in the panel: they do not count on its button.
  const panelCount = activeCount - (filters.levels ? 1 : 0) - (filters.priority ? 1 : 0) - (filters.q ? 1 : 0);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("menu", { count: panelCount })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`${toolClass} relative`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="size-space-4"
        >
          <path d="M2 4.5h12M4.5 8h7M7 11.5h2" />
        </svg>
        {panelCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-space-1 -right-space-1 flex size-space-5 items-center justify-center rounded-full bg-accent text-caption font-strong text-accent-ink tabular-nums"
          >
            {panelCount}
          </span>
        )}
      </button>
      {open && (
        <section
          ref={panel}
          id={panelId}
          aria-labelledby={titleId}
          className="glass absolute inset-x-space-0 top-full z-20 mt-space-2 flex flex-col gap-space-3 rounded-card p-space-4 text-left text-ink shadow-lifted sm:left-auto sm:w-narrow"
        >
          <h2 id={titleId} className="font-display text-lead">
            {t("menuTitle")}
          </h2>
          <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
            {sortable && (
              <Select label={t("sort")} value={filters.sort ?? "recent"} onChange={(value) => set({ sort: value })}>
                {itemSortSchema.options.map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`sortOptions.${sort}`)}
                  </option>
                ))}
              </Select>
            )}
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
        </section>
      )}
    </>
  );
}
