import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("Settings");
  return (
    <div className="flex flex-col gap-space-4 pb-space-6">
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <SettingsNav />
      {children}
    </div>
  );
}
