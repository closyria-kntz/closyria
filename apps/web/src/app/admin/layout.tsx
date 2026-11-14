import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getAdminAccess, redirectToSignIn } from "./server";

export async function generateMetadata(): Promise<Metadata> {
  // A 404 must look like any other: no admin title or robots policy that would reveal the area.
  const access = await getAdminAccess();
  if (access === "not-found" || access === "sign-in") return {};
  const t = await getTranslations("Admin.metadata");
  return { title: t("title"), robots: { index: false, follow: false, nocache: true } };
}

/**
 * Outer guard of the whole admin area (ruling R15): a visitor not signed in to an account goes to the sign-in
 * page (comptes visibles 2026-11-14); for a signed-in account without the admin role it does not exist (404). The passkey requirement is checked one level down, so that /admin/passkey-required,
 * which only admins can see, never redirects to itself.
 */
export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  const access = await getAdminAccess();
  if (access === "sign-in") await redirectToSignIn();
  if (access === "not-found") notFound();
  // Only now are the admin's texts sent to the browser (the root layout leaves them out).
  return <NextIntlClientProvider messages={await getMessages()}>{children}</NextIntlClientProvider>;
}
