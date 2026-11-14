"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { signInHref } from "@/lib/sign-in";
import { focusRing } from "./ui";

/**
 * « Se connecter » in the band, in place of the profile switcher, for a guest (comptes visibles 2026-11-14): the
 * sign-in / account creation page, back to this page afterwards. What she kept as a guest follows her (`onLinkAccount`).
 */
export function SignInButton() {
  const t = useTranslations("Shell.signIn");
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return (
    <Link
      href={signInHref(search ? `${pathname}?${search}` : pathname)}
      aria-label={t("label")}
      data-testid="band-sign-in"
      className={`inline-flex min-h-touch-target shrink-0 items-center gap-space-1-5 rounded-pill bg-band-field px-space-3-5 text-caption font-bold text-band-ink hover:bg-band-tab-on hover:text-band-tab-on-ink ${focusRing}`}
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-nav-icon fill-none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
      </svg>
      {t("action")}
    </Link>
  );
}
