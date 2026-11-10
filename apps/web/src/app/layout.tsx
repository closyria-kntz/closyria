import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/jost/wght.css";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageViewTracker } from "@/components/page-view-tracker";
import "./globals.css";

// `cover` lets the page reach under the notch and home indicator; the phone tab bar pads itself with the safe area.
export const viewport: Viewport = { viewportFit: "cover" };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Metadata");
  return {
    title: t("title"),
    description: t("description"),
    // The manifest is app/manifest.webmanifest (linked below); iOS ignores it, so the icon is declared too.
    icons: { apple: "/icons/icon-192.png" },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  // The admin's texts are only sent inside the admin area (its layout adds them), never to the public site.
  const { Admin: _admin, ...publicMessages } = await getMessages();
  return (
    // theme-init.js sets `data-theme` before React hydrates: the attribute is expected to differ.
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Blocking on purpose: her light / dark choice before the first paint. A file, for `script-src 'self'`. */}
        <script src="/theme-init.js" />
        {/* With credentials: behind dev's password, a manifest fetched without them makes Chrome ask again and again. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
      </head>
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <NextIntlClientProvider messages={publicMessages}>{children}</NextIntlClientProvider>
        <PageViewTracker />
      </body>
    </html>
  );
}
