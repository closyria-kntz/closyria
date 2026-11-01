import "@fontsource-variable/cormorant-garamond/wght.css";
import "@fontsource-variable/jost/wght.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageViewTracker } from "@/components/page-view-tracker";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return { title: t("title"), description: t("description") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // The admin's texts are only sent inside the admin area (its layout adds them), never to the public site.
  const { Admin: _admin, ...publicMessages } = await getMessages();
  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <NextIntlClientProvider messages={publicMessages}>{children}</NextIntlClientProvider>
        <PageViewTracker />
      </body>
    </html>
  );
}
