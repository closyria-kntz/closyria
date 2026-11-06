import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CaptureForm } from "@/components/capture-form";
import { HomeSummary } from "@/components/home-summary";
import { RecentProducts } from "@/components/recent-products";

/** The paste field; the recents send the focus back to it when their last card goes. */
const CAPTURE_FIELD_ID = "capture-url";

/** Passe design §4: the question, the paste field, her wardrobe at a glance, then the recent links. Left aligned. */
export default async function Home() {
  const t = await getTranslations("Home");
  return (
    <div className="flex flex-col gap-space-5 py-space-4">
      <h1 className="font-display text-display font-strong">{t("title")}</h1>
      <div className="w-full max-w-paste">
        <CaptureForm fieldId={CAPTURE_FIELD_ID} />
      </div>
      <Suspense>
        <HomeSummary />
      </Suspense>
      <RecentProducts emptyFocusId={CAPTURE_FIELD_ID} />
    </div>
  );
}
