import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { getAdminAccess } from "./server";

export async function generateMetadata(): Promise<Metadata> {
  // A 404 must look like any other: no admin title or robots policy that would reveal the area.
  if ((await getAdminAccess()) === "not-found") return {};
  const t = await getTranslations("Admin.metadata");
  return { title: t("title"), robots: { index: false, follow: false, nocache: true } };
}

/**
 * Outer guard of the whole admin area (ruling R15): without a session or without the admin role it does
 * not exist (404). The passkey requirement is checked one level down, so that /admin/passkey-required,
 * which only admins can see, never redirects to itself.
 */
export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  if ((await getAdminAccess()) === "not-found") notFound();
  // Only now are the admin's texts sent to the browser (the root layout leaves them out).
  return <NextIntlClientProvider messages={await getMessages()}>{children}</NextIntlClientProvider>;
}
