"use client";

import type { ItemView } from "@closyria/shared";
import type { ReactNode } from "react";
import { ItemCard } from "./item-card";

/** 2 columns on a phone (< 48 rem), 3 on a tablet, 5 from 64 rem (spec §4). */
export const GRID_CLASS = "grid grid-cols-2 gap-x-space-3 gap-y-space-5 md:grid-cols-3 lg:grid-cols-5 lg:gap-x-space-4";

export function ItemGrid({
  label,
  items,
  selected,
  onToggle,
  showStage,
  children,
}: {
  label: string;
  items: readonly ItemView[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  showStage: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <ul aria-label={label} data-testid="item-grid" className={GRID_CLASS}>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selected={selected.has(item.id)}
            selecting={selected.size > 0}
            onToggle={onToggle}
            showStage={showStage}
          />
        ))}
      </ul>
      {children}
    </>
  );
}
