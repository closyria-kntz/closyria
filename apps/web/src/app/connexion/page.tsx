import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { safeNext } from "@/lib/sign-in";
import { SignInForm } from "./sign-in-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("SignIn");
  return { title: t("metadataTitle"), robots: { index: false, follow: false } };
}

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/**
 * Minimal sign-in (ruling R19): e-mail, then the 6-digit code it receives. If the visitor already has an
 * anonymous session, Better Auth links it to the account (her data follows, `onLinkAccount`).
 */
export default async function SignInPage({ searchParams }: Props) {
  const t = await getTranslations("SignIn");
  const next = safeNext((await searchParams).next);
  return (
    <main className="mx-auto flex min-h-dvh max-w-narrow flex-col justify-center gap-space-4 px-space-5 py-space-7">
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <SignInForm next={next} />
    </main>
  );
}
