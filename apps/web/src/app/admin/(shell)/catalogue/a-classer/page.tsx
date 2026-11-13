import { adminUnclassifiedListSchema, type ReferenceKind } from "@closyria/shared";
import { getTranslations } from "next-intl/server";
import { fetchAdminJson, fetchAdminReference } from "@/lib/admin-api";
import { categoryChoices } from "@/lib/admin-reference";
import { adminCallOrThrow, requireAdminPage } from "../../../server";
import { ClassifyForm } from "./classify-form";

/** « À classer »: catalogue articles filed « Autres », without a type or a colour; each filed in two choices. */
export default async function AdminUnclassifiedPage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.unclassified");
  const reference = (kind: ReferenceKind) =>
    adminCallOrThrow(`The ${kind} list`, (api) => fetchAdminReference(api, kind));
  const [list, categories, colors] = await Promise.all([
    adminCallOrThrow("The unclassified list", (api) =>
      fetchAdminJson(api, "/api/admin/catalogue/unclassified", adminUnclassifiedListSchema),
    ),
    reference("categories"),
    reference("colors"),
  ]);
  const options = {
    categories: categoryChoices(categories.entries, " › "),
    colors: colors.entries.map((e) => ({ id: e.id, label: e.name })),
  };

  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <p role="status" className="font-strong">
        {t("count", { total: list.total })}
      </p>
      {list.products.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-space-3">
          {list.products.map((product) => (
            <li
              key={product.id}
              className="flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4 sm:flex-row"
            >
              <div className="aspect-3/4 w-space-8 shrink-0 overflow-hidden rounded-card bg-media-backdrop">
                {product.imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images.
                  <img src={product.imageUrl} alt="" loading="lazy" className="size-full object-contain" />
                ) : (
                  <span className="sr-only">{t("noPhoto")}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-space-2">
                <h2 className="font-strong break-words">{product.name}</h2>
                <p className="text-sm text-ink-muted">
                  {product.shopName}
                  {" · "}
                  {product.productType ? t("productType", { type: product.productType }) : t("noType")}
                </p>
                <ClassifyForm product={product} options={options} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.total > list.products.length ? (
        <p className="text-ink-muted">{t("more", { shown: list.products.length })}</p>
      ) : null}
    </>
  );
}
