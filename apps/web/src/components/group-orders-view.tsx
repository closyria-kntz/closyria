"use client";

import type { WishlistView } from "@closyria/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "@/lib/live-changes";
import { fetchWishlists } from "@/lib/wardrobe-client";
import { ArticlesTabs, isRunningGroupOrder } from "./articles-tabs";
import { groupOrderHref } from "./group-order-banner";
import { buttonClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/**
 * « Commandes groupées », the third tab of « Mes articles »: each list with a group order still to follow (open, or
 * closed and not ordered yet), its shop and its state, and « Voir la commande ». None: how to start one.
 */
export function GroupOrdersView() {
  const t = useTranslations("Views.groupOrders");
  const [lists, setLists] = useState<WishlistView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      setLists(await fetchWishlists());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load(), status === "ready");

  const running = lists.filter(isRunningGroupOrder);
  return (
    <div className="flex flex-col gap-space-5 pt-space-5 pb-space-6">
      <ArticlesTabs current="groupOrders" lists={status === "ready" ? lists : null} />
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>
      {status === "loading" && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {status === "ready" && running.length === 0 && (
        <section className="flex flex-col items-start gap-space-3 rounded-card bg-surface-sunken p-space-5">
          <h2 className="font-title text-lead font-regular">{t("empty.title")}</h2>
          <p className="max-w-measure text-ink-muted">{t("empty.body")}</p>
          <Link href="/listes" className={`${primaryButtonClass} ${touch}`}>
            {t("empty.action")}
          </Link>
        </section>
      )}
      {running.length > 0 && (
        <ul aria-label={t("listLabel")} className="grid gap-space-3 md:grid-cols-2">
          {running.map((list) => (
            <li key={list.id} className="flex flex-col gap-space-2 rounded-card bg-surface-sunken p-space-4">
              <span className="text-caption font-bold tracking-wide text-accent uppercase">
                {t(`status.${list.groupOrder?.status === "closed" ? "closed" : "open"}`)}
              </span>
              <h2 className="font-title text-lead font-regular">
                {t("shop", { shop: list.groupOrder?.shopName ?? "" })}
              </h2>
              <p className="text-sm text-ink-muted">{t("list", { name: list.name })}</p>
              <Link href={groupOrderHref(list.id)} className={`${primaryButtonClass} ${touch} self-start`}>
                {t("see")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
