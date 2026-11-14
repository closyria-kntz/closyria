import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { DevAccessForm } from "./dev-access-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("DevAccess");
  return { title: t("metadataTitle"), robots: { index: false, follow: false } };
}

/**
 * « Accès au site de test » (dev.closyria.com only): the dev password, asked once per device, instead of the browser's
 * password window, which a home-screen web app on iPhone never shows. Caddy sends here every page opened without the
 * access cookie (deploy/caddy/dev.closyria.com.caddy). Outside the app shell, no session: nothing here calls
 * /api/me/*, which Caddy refuses until the cookie exists.
 */
export default async function DevAccessPage() {
  // Read at request time (not at build time): prod's web server has APP_ENV=prod, and prod has no such page.
  await connection();
  if (process.env.APP_ENV === "prod") notFound();
  const t = await getTranslations("DevAccess");
  const tShell = await getTranslations("Shell");
  return (
    <>
      {/* Boudoir's burgundy band with the logo, as on the shared list. Not a link: the site is closed until access. */}
      <header className="bg-band text-band-ink">
        <div className="mx-auto flex w-full max-w-app items-center px-space-4 py-space-3 md:px-space-5 lg:px-space-6">
          <span className="font-title text-logo leading-none">{tShell("brand")}</span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-narrow flex-col gap-space-4 px-space-4 pt-space-7 pb-space-7 md:px-space-5">
        <h1 className="font-title text-page-title leading-tight font-regular">{t("title")}</h1>
        <p className="text-ink-muted">{t("intro")}</p>
        <DevAccessForm />
      </main>
    </>
  );
}
