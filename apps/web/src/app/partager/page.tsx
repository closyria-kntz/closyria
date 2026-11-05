import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CaptureForm } from "@/components/capture-form";
import { extractSharedUrl } from "@/lib/shared-url";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Capture");
  return { title: t("share.title"), robots: { index: false, follow: false } };
}

type Param = string | string[] | undefined;
type Props = { searchParams: Promise<{ url?: Param; text?: Param; title?: Param }> };
const first = (value: Param) => (Array.isArray(value) ? value[0] : value);

/** Web Share Target of the installed PWA (GET /partager?title&text&url): adds the shared link, or asks for one. */
export default async function SharePage({ searchParams }: Props) {
  const t = await getTranslations("Capture");
  const params = await searchParams;
  const url = extractSharedUrl({ url: first(params.url), text: first(params.text), title: first(params.title) });
  return (
    <main className="mx-auto flex min-h-dvh max-w-narrow flex-col justify-center gap-space-4 px-space-5 py-space-7">
      <h1 className="font-display text-title font-strong">{t("share.title")}</h1>
      {url ? (
        <CaptureForm initialUrl={url} autoSubmit />
      ) : (
        <>
          <p role="status" className="text-ink-muted">
            {t("share.noLink")}
          </p>
          <CaptureForm />
        </>
      )}
    </main>
  );
}
