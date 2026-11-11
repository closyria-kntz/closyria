"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { focusRing } from "./ui";

const storageKey = (id: string) => `closyria.tip.${id}`;

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(id)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(id: string) {
  try {
    window.localStorage.setItem(storageKey(id), "1");
  } catch {
    // Private window or blocked storage: it stays closed until the page is opened again.
  }
}

/**
 * An amber tip (refonte Boudoir, spec R8, mockup .tip): « Astuce » over one sentence, closed once read with ✕.
 * This browser remembers it is closed; Task 7 keeps it on her account instead, so it stays closed everywhere.
 */
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const t = useTranslations("Home.tip");
  // Unknown until the browser is read: nothing shows rather than a tip that vanishes at once.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => setDismissed(readDismissed(id)), [id]);
  if (dismissed !== false) return null;

  const close = () => {
    writeDismissed(id);
    setDismissed(true);
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
        <b className="block">{t("label")}</b>
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
