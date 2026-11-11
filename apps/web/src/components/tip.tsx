"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { tipShown, usePreferences } from "@/lib/preferences";
import { focusRing } from "./ui";

/**
 * An amber tip (refonte Boudoir, spec R8, mockup .tip): « Astuce » over one sentence, closed once read with ✕.
 * Her account remembers it is closed (`seenTips`), so it stays closed on all her devices. One tip at most per page.
 */
export function Tip({ id, title, children }: { id: string; title?: string; children: ReactNode }) {
  const t = useTranslations("Tip");
  const { state, closeTip } = usePreferences();
  // Unknown until her preferences are read: nothing shows rather than a tip that vanishes at once.
  if (!tipShown(state, id)) return null;

  const close = () => {
    closeTip(id);
    // The tip and its button are gone: the page itself takes the focus, where it was read.
    document.getElementById("app-content")?.focus({ preventScroll: true });
  };

  return (
    <aside
      aria-label={t("label")}
      className="flex items-start gap-space-2-5 rounded-card bg-tip py-space-3 pr-space-1 pl-space-3-5 text-chip text-tip-ink"
    >
      <span aria-hidden="true" className="pt-space-0-5">
        💡
      </span>
      <p className="flex-1 pt-space-0-5">
        <b className="block">{title ?? t("label")}</b>
        {children}
      </p>
      <button
        type="button"
        onClick={close}
        aria-label={t("close")}
        className={`-my-space-2 inline-flex size-touch-target shrink-0 items-center justify-center rounded-pill ${focusRing}`}
      >
        {/* Drawn: Figtree has no « ✕ ». */}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-space-4 fill-none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </aside>
  );
}
