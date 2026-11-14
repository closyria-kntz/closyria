"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { isAccountPromptVisible, subscribeAccountPrompt } from "@/lib/account-prompt";
import { readHomeBannerDismissedAt, shouldShowHomeBanner, writeHomeBannerDismissedAt } from "@/lib/home-account-banner";
import { useIsGuest } from "@/lib/profile-context";
import { signInHref } from "@/lib/sign-in";
import { focusRing, primaryButtonClass } from "./ui";

/**
 * Home, for a guest only (comptes visibles 2026-11-14): a quiet banner offering an account, closed for 30 days in this
 * browser. Gives way to the account proposal (G6) when that one shows, so the page never says it twice.
 */
export function HomeAccountBanner() {
  const t = useTranslations("Home.accountBanner");
  const guest = useIsGuest();
  const prompt = useSyncExternalStore(subscribeAccountPrompt, isAccountPromptVisible, () => false);
  // Read after mounting: the server has no storage, and the first paint must match it.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(shouldShowHomeBanner({ guest, dismissedAt: readHomeBannerDismissedAt(), now: new Date() }));
  }, [guest]);

  if (!visible || prompt) return null;
  return (
    <section
      aria-label={t("label")}
      data-testid="home-account-banner"
      className="flex flex-wrap items-center gap-x-space-4 gap-y-space-2 rounded-card border border-line bg-hint py-space-2 pr-space-2 pl-space-4"
    >
      <p className="min-w-space-0 flex-1 basis-measure text-sm">{t("body")}</p>
      <div className="flex items-center gap-space-1">
        <Link href={signInHref("/")} className={`${primaryButtonClass} min-h-touch-target`}>
          {t("action")}
        </Link>
        <button
          type="button"
          aria-label={t("dismiss")}
          onClick={() => {
            writeHomeBannerDismissedAt();
            setVisible(false);
          }}
          className={`grid size-touch-target shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-strong hover:text-ink ${focusRing}`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-space-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </section>
  );
}
