import { getTranslations } from "next-intl/server";
import { CaptureForm } from "@/components/capture-form";

export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <main className="mx-auto flex min-h-dvh max-w-narrow flex-col items-center justify-center gap-space-4 px-space-5 text-center">
      <h1 className="font-display text-display font-strong">{t("title")}</h1>
      <p className="text-lead text-ink-muted">{t("tagline")}</p>
      <CaptureForm />
    </main>
  );
}
