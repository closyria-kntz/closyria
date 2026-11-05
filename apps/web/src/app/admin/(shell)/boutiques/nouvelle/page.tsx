import { getTranslations } from "next-intl/server";
import { requireAdminPage } from "../../../server";
import { NewShopForm } from "./new-shop-form";

/** Add a shop from a product URL: draft shop, test capture, then explicit suggestions. */
export default async function NewShopPage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.shops.new");
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <NewShopForm />
    </>
  );
}
