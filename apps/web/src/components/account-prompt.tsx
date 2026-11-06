"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import {
  hideAccountPrompt,
  isAccountPromptVisible,
  markPromptFollowed,
  subscribeAccountPrompt,
  takePromptFollowed,
  writeDismissedAt,
} from "@/lib/account-prompt";
import { fetchSummary } from "@/lib/catalog-client";
import { track } from "@/lib/track";
import { buttonClass, primaryButtonClass } from "./ui";

/**
 * The account proposal (G6): a banner in the page, never a modal, that she can close (not shown again for 7 days).
 * Also counts `account_created_from_prompt` when she comes back signed in after following its button.
 */
export function AccountPrompt() {
  const t = useTranslations("Account");
  const visible = useSyncExternalStore(subscribeAccountPrompt, isAccountPromptVisible, () => false);
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const here = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    let alive = true;
    // She followed the banner earlier: if she is now a real account, the proposal worked.
    if (takePromptFollowed()) {
      void fetchSummary().then((summary) => {
        if (alive && summary && !summary.isAnonymous) track("account_created_from_prompt");
      });
    }
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;
  return (
    <section
      aria-label={t("label")}
      className="flex flex-wrap items-center justify-between gap-space-3 rounded-card border border-line bg-hint px-space-4 py-space-3"
    >
      <div className="flex max-w-measure flex-col gap-space-1">
        <h2 className="text-body font-strong">{t("title")}</h2>
        <p className="text-sm">{t("body")}</p>
      </div>
      <div className="flex items-center gap-space-2">
        <Link
          href={`/connexion?next=${encodeURIComponent(here)}`}
          onClick={() => markPromptFollowed()}
          className={`${primaryButtonClass} min-h-touch-target`}
        >
          {t("action")}
        </Link>
        <button
          type="button"
          className={`${buttonClass} min-h-touch-target`}
          onClick={() => {
            writeDismissedAt();
            hideAccountPrompt();
          }}
        >
          {t("dismiss")}
        </button>
      </div>
    </section>
  );
}
