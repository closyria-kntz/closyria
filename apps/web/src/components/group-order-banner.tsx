"use client";

import type { WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { primaryButtonClass } from "./ui";

/** Where her group order of a list lives. */
export const groupOrderHref = (listId: string) => `/listes/${listId}/commande-groupee`;

/**
 * « Commande groupée chez {boutique} en cours » + « Voir » (spec § 4.2): on « Mes envies » and on the list, while a
 * group order of the list is open or closed. Nothing else of it there (§ 4.5).
 */
export function GroupOrderBanner({ list }: { list: WishlistView }) {
  const t = useTranslations("GroupOrder.banner");
  const order = list.groupOrder;
  if (!order || (order.status !== "open" && order.status !== "closed")) return null;
  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-space-3 rounded-card border-2 border-selected-line bg-selected-surface px-space-4 py-space-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
    >
      <p className="max-w-measure text-sm font-strong break-words text-ink">
        <span aria-hidden="true">🛍️ </span>
        {t("text", { shop: order.shopName })}
      </p>
      <Link href={groupOrderHref(list.id)} className={`${primaryButtonClass} min-h-touch-target self-start`}>
        {t("see")}
      </Link>
    </section>
  );
}
