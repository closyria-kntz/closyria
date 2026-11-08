"use client";

import type { ItemView } from "@closyria/shared";
import type { ReactNode } from "react";
import { type CardActions, ItemCard } from "./item-card";

/** « Sélectionner » mode: which items are chosen, and the toggle. */
export type GridSelection = { selected: ReadonlySet<string>; onToggle: (id: string) => void };

/** 2 columns on a phone (< 48 rem), 3 on a tablet, 4 from 64 rem (refonte, gaps of the mockup). */
export const GRID_CLASS =
  "grid grid-cols-2 gap-x-space-4 gap-y-space-5 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-space-5 lg:gap-y-space-6";

export function ItemGrid({
  label,
  items,
  actions,
  showStage,
  selection,
  children,
}: {
  label: string;
  items: readonly ItemView[];
  actions: CardActions;
  showStage: boolean;
  /** Set in « Sélectionner » mode. */
  selection?: GridSelection | null;
  children?: ReactNode;
}) {
  return (
    <>
      <ul aria-label={label} data-testid="item-grid" className={GRID_CLASS}>
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            actions={actions}
            showStage={showStage}
            selection={
              selection ? { selected: selection.selected.has(item.id), onToggle: selection.onToggle } : undefined
            }
          />
        ))}
      </ul>
      {children}
    </>
  );
}
