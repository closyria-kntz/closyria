"use client";

import type { WishlistView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { NavUnderline } from "./nav-underline";
import { focusRing } from "./ui";

export type ListTab = { list: WishlistView; count: number };

/**
 * The tabs of « Mes envies »: « Toutes mes envies » (`null`), then each list, each with its number of wishes. The
 * raspberry line follows the current one. Nothing to choose from (no list) shows nothing.
 */
export function ListTabs({
  lists,
  current,
  allCount,
  onChange,
}: {
  lists: readonly ListTab[];
  current: string | null;
  allCount: number;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations("Views.listTabs");
  const container = useRef<HTMLElement>(null);
  if (lists.length === 0) return null;
  const tab = (id: string | null, name: string, count: number) => (
    <button
      key={id ?? "all"}
      type="button"
      aria-current={current === id ? "true" : undefined}
      onClick={() => current !== id && onChange(id)}
      className={`${focusRing} min-h-touch-target rounded-button px-space-3 text-ink-muted aria-[current=true]:font-strong aria-[current=true]:text-ink`}
    >
      {name} <span className="font-body text-sm font-normal tabular-nums text-ink-muted">{count}</span>
    </button>
  );
  return (
    <nav
      ref={container}
      aria-label={t("label")}
      className="relative flex flex-wrap gap-space-1 border-b border-line pb-space-1"
    >
      {tab(null, t("all"), allCount)}
      {lists.map(({ list, count }) => tab(list.id, list.name, count))}
      <NavUnderline containerRef={container} activeSelector='[aria-current="true"]' />
    </nav>
  );
}
