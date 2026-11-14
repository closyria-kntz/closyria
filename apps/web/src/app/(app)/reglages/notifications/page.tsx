import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationSettings } from "@/components/notification-settings";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Notifications");
  return { title: t("metadata"), robots: { index: false, follow: false } };
}

export default function Page() {
  return <NotificationSettings />;
}
