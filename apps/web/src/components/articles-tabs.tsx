"use client";

import type { WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ARTICLES_PATH, GROUP_ORDERS_PATH } from "@/lib/articles-address";
import { fetchWishlists } from "@/lib/wardrobe-client";
import { focusRing } from "./ui";

export type ArticlesTab = "articles" | "lists" | "groupOrders";

/** A group order still to follow (open, or closed and not ordered yet). */
export const isRunningGroupOrder = (list: WishlistView) =>
  list.groupOrder !== null && (list.groupOrder.status === "open" || list.groupOrder.status === "closed");

const HREFS: Record<ArticlesTab, string> = {
  articles: ARTICLES_PATH,
  lists: "/listes",
  groupOrders: GROUP_ORDERS_PATH,
};

/**
 * « Articles · Listes · Commandes groupées » at the top of « Mes articles » (mockup .seg): three links in a soft pill,
 * the current one raised on the card colour. The lists and the running group orders are counted once read.
 */
export function ArticlesTabs({ current, lists }: { current: ArticlesTab; lists?: readonly WishlistView[] | null }) {
  const t = useTranslations("Views.tabs");
  const [read, setRead] = useState<readonly WishlistView[] | null>(null);
  useEffect(() => {
    if (lists) return;
    let alive = true;
    fetchWishlists().then(
      (found) => alive && setRead(found),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [lists]);
  const known = lists ?? read;
  const counts: Record<ArticlesTab, number> = {
    articles: 0,
    lists: known?.length ?? 0,
    groupOrders: known?.filter(isRunningGroupOrder).length ?? 0,
  };
  return (
    <nav aria-label={t("label")} className="flex gap-space-1 rounded-pill bg-surface-strong p-space-1">
      {(Object.keys(HREFS) as ArticlesTab[]).map((tab) => (
        <Link
          key={tab}
          href={HREFS[tab]}
          aria-current={tab === current ? "page" : undefined}
          className={`hit-area relative flex min-w-space-0 flex-1 items-center justify-center rounded-pill px-space-1-5 py-space-2 text-center text-chip font-bold text-ink aria-[current=page]:bg-surface-raised aria-[current=page]:shadow-seg ${focusRing}`}
        >
          {counts[tab] > 0 ? t("count", { label: t(tab), count: counts[tab] }) : t(tab)}
        </Link>
      ))}
    </nav>
  );
}
