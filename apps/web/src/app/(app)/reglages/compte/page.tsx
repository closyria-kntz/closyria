import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccountSettings } from "@/components/account-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.account");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <AccountSettings />;
}
