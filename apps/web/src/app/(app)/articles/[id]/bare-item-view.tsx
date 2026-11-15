"use client";

import { type ItemView, isHttpUrl } from "@closyria/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ItemOrderBlock } from "@/components/item-order-block";
import { linkActionClass } from "@/components/order-parts";
import { buttonClass, focusRing } from "@/components/ui";
import { formatPrice } from "@/lib/price";
import { fetchItem } from "@/lib/wardrobe-client";
import { ItemPanel } from "../../produits/[id]/item-panel";
import { ItemProgress } from "../../produits/[id]/item-progress";
import { PhotoManager } from "../../produits/[id]/photo-manager";
import { ProductActions } from "../../produits/[id]/product-actions";
import { TWO_COLUMNS } from "../../produits/[id]/product-view";

type Load = { kind: "loading" } | { kind: "not_found" } | { kind: "failed" } | { kind: "ready"; item: ItemView };

/**
 * The sheet of an article without a product (« Après la commande »: born from an order line, or from an Instagram
 * link): her photos, her name and the shop or brand, what she paid, its step, what to do next, « Commande / colis »
 * and her own blocks. No shop page, no stock or price follow-up, no alert: nothing is read from any site. An article
 * with a product is sent to its product sheet.
 */
export function BareItemView({ itemId }: { itemId: string }) {
  const t = useTranslations("Orders.sheet");
  const tItem = useTranslations("Item");
  const locale = useLocale();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      const item = await fetchItem(itemId);
      if (item?.product) return router.replace(`/produits/${item.product.id}`);
      setLoad(item ? { kind: "ready", item } : { kind: "not_found" });
    } catch {
      setLoad((current) => (current.kind === "ready" ? current : { kind: "failed" }));
    }
  }, [itemId, router]);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className={`${TWO_COLUMNS} gap-space-4`}>
        <h1 className="sr-only">{tItem("keep.working")}</h1>
        <div aria-hidden="true" className="skeleton aspect-3/4 w-full rounded-card" />
      </div>
    );
  }
  if (load.kind === "not_found") return <p role="alert">{t("notFound")}</p>;
  if (load.kind === "failed") {
    return (
      <div className="flex flex-col items-start gap-space-3">
        <p role="alert">{t("loadFailed")}</p>
        <button type="button" className={`${buttonClass} min-h-touch-target`} onClick={() => void reload()}>
          {t("retry")}
        </button>
      </div>
    );
  }

  const { item } = load;
  const setItem = (next: ItemView) => setLoad({ kind: "ready", item: next });
  const shop = item.shopName ?? item.brand ?? "";
  const name = item.name?.trim() || shop;
  return (
    <div className="flex flex-col gap-space-2">
      <Link
        href="/articles"
        className={`inline-flex min-h-touch-target items-center self-start rounded-pill text-menu font-bold text-ink lg:hidden ${focusRing}`}
      >
        {tItem("back")}
      </Link>
      <article className={`${TWO_COLUMNS} gap-space-5`}>
        <div data-testid="product-gallery" className="lg:sticky lg:top-space-0 lg:self-start">
          <PhotoManager item={item} onChange={setItem} reload={reload} adding={adding} onAddingChange={setAdding} />
        </div>
        <div data-testid="product-info" className="flex min-w-space-0 flex-col gap-space-3-5">
          <header className="flex flex-col gap-space-3-5">
            <div className="flex flex-col gap-space-1">
              {shop && <p className="text-meta text-ink-muted">{shop}</p>}
              {item.brand && item.brand !== shop && (
                <p className="text-sm font-strong uppercase text-ink-muted">{item.brand}</p>
              )}
            </div>
            <h1 className="font-display text-page-title leading-none text-balance">{name}</h1>
            {item.pricePaidCents !== null && (
              <p className="text-body font-bold tabular-nums">
                {t("paid", { price: formatPrice(locale, item.pricePaidCents, "EUR") })}
              </p>
            )}
            {item.sourceUrl && isHttpUrl(item.sourceUrl) && (
              <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className={linkActionClass}>
                {t("instagram")}
              </a>
            )}
            <ItemProgress item={item} />
          </header>
          <ItemPanel
            item={item}
            onChange={setItem}
            onGone={() => router.push("/articles")}
            reload={reload}
            top={
              <>
                <ProductActions
                  shop={shop}
                  url=""
                  title={null}
                  item={item}
                  onChange={setItem}
                  reload={reload}
                  onAddPhoto={() => setAdding(true)}
                />
                <ItemOrderBlock item={item} />
              </>
            }
            shop={null}
          />
        </div>
      </article>
    </div>
  );
}
