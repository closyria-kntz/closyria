import { getTranslations } from "next-intl/server";
import { CaptureForm } from "@/components/capture-form";
import { RecentProducts } from "@/components/recent-products";

export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <main className="mx-auto flex min-h-dvh max-w-wide flex-col items-center justify-center gap-space-4 px-space-5 py-space-7 text-center md:gap-space-5 lg:px-space-6">
      <h1 className="font-display text-display font-strong">{t("title")}</h1>
      <p className="max-w-measure text-lead text-ink-muted">{t("tagline")}</p>
      <div className="w-full max-w-measure">
        <CaptureForm />
      </div>
      <RecentProducts />
    </main>
  );
}
