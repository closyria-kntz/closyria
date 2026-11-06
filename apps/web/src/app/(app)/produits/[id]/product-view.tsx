"use client";

import type { CaptureView, ItemView, ProductView as Product } from "@closyria/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoViewer } from "@/components/photo-viewer";
import { buttonClass, primaryButtonClass } from "@/components/ui";
import { pollCapture, pollUntil } from "@/lib/capture-poll";
import { fetchCaptureView, fetchProduct } from "@/lib/catalog-client";
import { formatOptionalPrice, formatPrice } from "@/lib/price";
import { useCurrentProfile, useProfiles } from "@/lib/profile-context";
import { fetchItemForProduct } from "@/lib/wardrobe-client";
import { ItemPanel } from "./item-panel";
import { ItemSummary } from "./item-summary";
import { KeepActions } from "./keep-actions";
import { ManualForm } from "./manual-form";
import { PhotoManager, PhotoPlaceholder } from "./photo-manager";
import { ProductDescription } from "./product-description";
import { ProductDetails } from "./product-details";
import { ProductTraits } from "./product-traits";

type Load = "loading" | "ready" | "not_found" | "error";
type CaptureState = { status: CaptureView["status"]; errorCode: CaptureView["errorCode"] };

const FAILURE_KEYS = {
  not_a_product: "not_a_product",
  timeout: "timeout",
  blocked: "blocked",
  robots_disallowed: "robots_disallowed",
} as const;

/** The loading placeholder: photo and text side by side from 48rem in landscape and on desktop. */
const TWO_COLUMNS = "grid grid-cols-1 md:landscape:grid-cols-2 md:landscape:gap-space-6 lg:grid-cols-2 lg:gap-space-6";

const touch = "min-h-touch-target";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-card ${className}`} />;
}

/**
 * The product sheet. It loads the sheet as it is, and follows the capture (`captureId`) when there is one:
 * the text shows as soon as `dataReady`, the photos when they arrive, and the manual form takes over on failure,
 * for hand-captured shops, and after 15 s.
 */
export function ProductView({ productId, captureId }: { productId: string; captureId: string | null }) {
  const t = useTranslations("Capture");
  const tItem = useTranslations("Item");
  const tMedia = useTranslations("Media");
  const [viewing, setViewing] = useState<number | null>(null);
  const locale = useLocale();
  const format = useFormatter();
  const [product, setProduct] = useState<Product | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [attempt, setAttempt] = useState(0);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [slow, setSlow] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [focusHeading, setFocusHeading] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = useCurrentProfile();
  const profiles = useProfiles();
  const [item, setItem] = useState<ItemView | null>(null);
  const [itemLoad, setItemLoad] = useState<"loading" | "error" | "ready">("loading");

  /** Reads her item for this sheet. The keep actions only show once this succeeded (never on a failed read). */
  const reloadItem = useCallback(async () => {
    setItemLoad("loading");
    try {
      setItem(await fetchItemForProduct(productId));
      setItemLoad("ready");
    } catch {
      setItem(null);
      setItemLoad("error");
    }
  }, [productId]);
  useEffect(() => {
    void reloadItem();
  }, [reloadItem]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on « Réessayer ».
  useEffect(() => {
    let alive = true;
    setLoad("loading");
    fetchProduct(productId).then(
      (result) => {
        if (!alive) return;
        if (result === "not_found") return setLoad("not_found");
        // A capture update that already arrived is newer than this first read.
        setProduct((current) => current ?? result);
        setLoad("ready");
      },
      () => alive && setLoad("error"),
    );
    return () => {
      alive = false;
    };
  }, [productId, attempt]);

  useEffect(() => {
    if (!captureId) return;
    return pollCapture(captureId, (id, signal) => fetchCaptureView(id, undefined, signal), {
      onUpdate: (view) => {
        setCapture({ status: view.status, errorCode: view.errorCode });
        if (view.product) {
          setProduct(view.product);
          setLoad("ready");
        }
      },
      onSoftTimeout: () => setSlow(true),
      onGiveUp: () => setGaveUp(true),
    });
  }, [captureId]);

  // A reload without ?capture= of a sheet whose capture is still pending: re-read the sheet on the same schedule.
  const rereadPending = captureId === null && product?.captureStatus === "pending" && product.name === null;
  useEffect(() => {
    if (!rereadPending) return;
    return pollUntil(
      (signal) => fetchProduct(productId, undefined, signal),
      (result) => result === "not_found" || result.captureStatus !== "pending",
      {
        onUpdate: (result) => {
          if (result === "not_found") return setLoad("not_found");
          setProduct(result);
        },
        onSoftTimeout: () => setSlow(true),
        onGiveUp: () => setGaveUp(true),
      },
    );
  }, [rereadPending, productId]);

  // After a manual save the form disappears: the focus goes to the sheet's heading.
  useEffect(() => {
    if (focusHeading && product?.name) {
      heading.current?.focus();
      setFocusHeading(false);
    }
  }, [focusHeading, product]);

  if (load === "not_found") return <p role="alert">{t("product.notFound")}</p>;
  if (load === "error" && !product) {
    return (
      <div className="flex flex-col items-start gap-space-3">
        <p role="alert">{t("product.loadFailed")}</p>
        <button type="button" className={buttonClass} onClick={() => setAttempt((n) => n + 1)}>
          {t("product.retry")}
        </button>
      </div>
    );
  }
  if (!product) {
    return (
      <div role="status" aria-busy="true" className={`${TWO_COLUMNS} gap-space-4`}>
        <h1 className="sr-only">{t("busy")}</h1>
        <Skeleton className="aspect-3/4 w-full" />
        <div className="flex flex-col gap-space-4">
          <Skeleton className="h-space-6 w-3/4" />
          <Skeleton className="h-space-5 w-1/3" />
        </div>
      </div>
    );
  }

  const shop = product.shop.name;
  const hasName = product.name !== null;
  const capturing =
    !gaveUp && captureId !== null && (capture === null || capture.status === "queued" || capture.status === "running");
  const reloadedPending = !gaveUp && rereadPending;
  const waiting = !hasName && (capturing || reloadedPending);
  const failed = gaveUp || (capture ? capture.status === "failed" : product.captureStatus === "failed");
  const manualShop = capture ? capture.status === "skipped_manual" : product.captureStatus === "manual";
  const failureKey = capture?.errorCode
    ? (FAILURE_KEYS[capture.errorCode as keyof typeof FAILURE_KEYS] ?? "other")
    : "other";
  const showForm = !hasName && (failed || manualShop || (slow && (capturing || reloadedPending)));
  const currency = product.currency ?? "EUR";
  const noPhotoYet = product.images.length === 0 && (capturing || reloadedPending);

  const shopSheet =
    hasName || product.sizes.length > 0 ? (
      <section aria-labelledby="shop-title" className="flex flex-col gap-space-4">
        <h2 id="shop-title" className="font-display text-lead font-strong">
          {tItem("sections.shop")}
        </h2>
        {product.sizes.length > 0 && (
          <section aria-labelledby="sizes-title" className="flex flex-col gap-space-2">
            <h3 id="sizes-title" className="text-sm font-strong">
              {t("product.sizes")}
            </h3>
            <ul className="flex flex-wrap gap-space-2">
              {product.sizes.map((size) => (
                <li
                  key={size.label}
                  className={`rounded-button border border-line px-space-3 py-space-1 text-sm ${size.available ? "bg-surface-raised" : "text-ink-muted line-through"}`}
                >
                  {size.label}
                  {!size.available && <span className="sr-only"> ({t("product.unavailable")})</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {hasName && <ProductTraits traits={product.traits} />}
        {hasName && product.description && <ProductDescription text={product.description} />}
        {hasName && <ProductDetails details={product.details} />}
        {product.lastCapturedAt && (
          <p className="text-sm text-ink-muted">
            <time dateTime={product.lastCapturedAt}>
              {t("product.updatedAt", {
                date: format.dateTime(new Date(product.lastCapturedAt), { dateStyle: "long" }),
              })}
            </time>
          </p>
        )}
      </section>
    ) : null;

  // Passe design §3. From 1280 px: the main column (header, photos, the shop's sheet) and a side panel that scrolls
  // on its own (« Mon article » and « Autres actions », or the keep buttons). Below: one column, photos first; the
  // keep buttons right after the header, her item after the shop's sheet. Only photos and header swap from 1280 px.
  const kept = Boolean(hasName && itemLoad !== "error" && item);
  // The side panel only when it has something to show: her item, its loading, or the keep buttons.
  const withPanel = hasName && itemLoad !== "error";
  // In the DOM in the one-column order (keyboard and screen readers follow it); from 1280 px the grid places it.
  const shopPart = shopSheet && <div className="min-w-space-0 xl:col-start-1 xl:row-start-2">{shopSheet}</div>;
  return (
    <article
      className={`flex flex-col gap-space-5 ${withPanel ? "xl:sheet-grid xl:grid xl:items-start" : ""}`}
      aria-busy={capturing || reloadedPending || undefined}
    >
      <div data-testid="product-main" className="flex min-w-space-0 flex-col gap-space-5 xl:col-start-1 xl:row-start-1">
        <div data-testid="product-gallery" className="xl:order-2">
          {item && itemLoad !== "error" ? (
            <PhotoManager item={item} onChange={setItem} reload={reloadItem} />
          ) : product.images.length > 0 ? (
            <div className="grid grid-cols-2 gap-space-2 xl:grid-cols-4">
              {product.images.map((image, index) => (
                // The whole photo in a 3:4 frame on the media backdrop, never cropped (visual direction §6).
                <button
                  type="button"
                  key={image.id}
                  aria-label={tMedia("viewer.open", { n: index + 1 })}
                  onClick={() => setViewing(index)}
                  className={`aspect-3/4 overflow-hidden rounded-card bg-media-backdrop focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:outline-solid ${index === 0 && product.images.length === 1 ? "col-span-2" : index === 0 ? "col-span-2 xl:row-span-2" : ""}`}
                >
                  {/* biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images, sized by the API. */}
                  <img
                    src={image.url}
                    width={image.width}
                    height={image.height}
                    alt={product.name ?? ""}
                    loading={index === 0 ? "eager" : "lazy"}
                    className="size-full object-contain"
                  />
                </button>
              ))}
              <PhotoViewer
                photos={product.images}
                index={viewing}
                alt={product.name ?? ""}
                onClose={() => setViewing(null)}
              />
            </div>
          ) : noPhotoYet ? (
            <Skeleton className="aspect-3/4 w-full" />
          ) : !waiting ? (
            <PhotoPlaceholder label={t("product.noPhoto")} />
          ) : null}
        </div>

        <header data-testid="product-header" className="flex flex-col gap-space-2 xl:order-1">
          <p className="text-sm text-ink-muted">
            {waiting ? <span role="status">{t("product.loading", { shop })}</span> : shop}
          </p>
          {hasName && product.brand && <p className="text-sm font-strong uppercase text-ink-muted">{product.brand}</p>}
          <h1
            ref={heading}
            tabIndex={-1}
            className={waiting ? "sr-only" : "font-display text-title font-strong focus:outline-none"}
          >
            {product.name ?? shop}
          </h1>
          {waiting && <Skeleton className="h-space-6 w-3/4" />}
          {hasName && product.priceCents === null && (
            <p className="text-ink-muted">{formatOptionalPrice(locale, null, currency, t("product.priceMissing"))}</p>
          )}
          {hasName && product.priceCents !== null && (
            <p className="flex items-baseline gap-space-3 tabular-nums">
              <span className="text-lead font-strong">{formatPrice(locale, product.priceCents, currency)}</span>
              {product.compareAtCents !== null && product.compareAtCents > product.priceCents && (
                <s className="text-ink-muted">
                  <span className="sr-only">{t("product.comparePrice")} </span>
                  {formatPrice(locale, product.compareAtCents, currency)}
                </s>
              )}
            </p>
          )}
          {waiting && <Skeleton className="h-space-5 w-1/3" />}
          {hasName && item && itemLoad !== "error" && <ItemSummary item={item} />}
          {isHttpUrl(product.canonicalUrl) && (
            <a
              href={product.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${primaryButtonClass} ${touch} mt-space-2 self-start`}
            >
              {t("product.viewAt", { shop })}
            </a>
          )}
        </header>
        {/* Notices and the manual form: under the header at every width. */}
        <div className="flex flex-col gap-space-5 empty:hidden xl:order-3">
          {waiting && <Skeleton className="h-space-6 w-1/2" />}
          {hasName && item && current.id && item.profileId !== current.id && (
            <p role="status" className="rounded-card border border-line bg-hint px-space-3 py-space-2 text-sm">
              {tItem("keep.alreadyIn", { name: profiles.find((p) => p.id === item.profileId)?.name ?? "" })}
            </p>
          )}
          {hasName && itemLoad === "error" && (
            <div className="flex flex-col items-start gap-space-2">
              <p role="alert" className="text-sm text-danger">
                {tItem("errors.itemLoad")}
              </p>
              <button type="button" className={`${buttonClass} min-h-touch-target`} onClick={() => void reloadItem()}>
                {t("product.retry")}
              </button>
            </div>
          )}

          {!hasName && (failed || manualShop) && (
            <p role="status" className="text-ink-muted">
              {manualShop ? t("product.manualShop", { shop }) : t(`product.failure.${failureKey}`)}
            </p>
          )}
          {!hasName && slow && (capturing || reloadedPending) && (
            <p role="status" className="text-ink-muted">
              {t("product.slow")}
            </p>
          )}
          {showForm && (
            <ManualForm
              productId={product.id}
              canonicalUrl={product.canonicalUrl}
              onSaved={(saved) => {
                setProduct(saved);
                setLoad("ready");
                setFocusHeading(true);
              }}
            />
          )}
        </div>
      </div>
      {kept ? shopPart : null}
      {withPanel && (
        <div
          data-testid="product-side"
          className="flex flex-col gap-space-5 xl:sticky xl:top-space-0 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:max-h-panel-max xl:overflow-y-auto"
        >
          {item && <ItemPanel item={item} onChange={setItem} onGone={() => setItem(null)} reload={reloadItem} />}
          {hasName && itemLoad === "loading" && !item && (
            <p role="status" className="text-sm text-ink-muted">
              {tItem("keep.working")}
            </p>
          )}
          {hasName && itemLoad === "ready" && !item && (
            <KeepActions product={product} profileId={current.id} onKept={setItem} reload={reloadItem} />
          )}
        </div>
      )}
      {kept ? null : shopPart}
    </article>
  );
}
