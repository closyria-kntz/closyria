"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

/** « Déjà offerts » at the bottom of the link (spec §3): « {article} — Offert ✓ » for each item she received. */
export function GivenItems({ items }: { items: readonly { name: string }[] }) {
  const t = useTranslations("SharedList.gifts");
  const titleId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2">
      <h2 id={titleId} className="font-display text-heading font-strong">
        {t("given")}
      </h2>
      <ul className="flex flex-col gap-space-1 text-ink-muted">
        {items.map((item, index) => (
          // Names only (several may match): the order is the list's.
          // biome-ignore lint/suspicious/noArrayIndexKey: the server sends no id, and the list is read-only.
          <li key={index} className="break-words">
            {t("givenLine", { name: item.name.trim() || t("givenFallback") })}
          </li>
        ))}
      </ul>
    </section>
  );
}
