import { getTranslations } from "next-intl/server";
import { CaptureForm } from "@/components/capture-form";
import { RecentProducts } from "@/components/recent-products";

/** The paste field; the recents send the focus back to it when their last card goes. */
const CAPTURE_FIELD_ID = "capture-url";

export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <div className="flex flex-col items-center gap-space-4 py-space-5 text-center md:gap-space-5">
      <h1 className="font-display text-display font-strong">{t("title")}</h1>
      <p className="max-w-measure text-lead text-ink-muted">{t("tagline")}</p>
      <div className="w-full max-w-measure">
        <CaptureForm fieldId={CAPTURE_FIELD_ID} />
      </div>
      <RecentProducts emptyFocusId={CAPTURE_FIELD_ID} />
    </div>
  );
}
