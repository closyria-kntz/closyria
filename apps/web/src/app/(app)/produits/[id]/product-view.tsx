"use client";

import type { CaptureView, ItemView, PriceHistory, ProductView as Product } from "@closyria/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PriceCurve } from "@/components/price-curve";
import { blockClass, buttonClass } from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { pollCapture, pollUntil } from "@/lib/capture-poll";
import { fetchCaptureView, fetchProduct } from "@/lib/catalog-client";
import { formatOptionalPrice, formatPrice } from "@/lib/price";
import { dropMention } from "@/lib/price-history";
import { useCurrentProfile, useProfiles } from "@/lib/profile-context";
import { fetchItemForProduct, fetchPriceHistory } from "@/lib/wardrobe-client";
import { ItemPanel } from "./item-panel";
import { KeepActions } from "./keep-actions";
import { ManualForm } from "./manual-form";
import { PhotoManager, PhotoPlaceholder } from "./photo-manager";
import { ProductActions } from "./product-actions";
import { ProductDescription } from "./product-description";
import { ProductDetails } from "./product-details";
import { ProductGallery } from "./product-gallery";
import { ProductTraits } from "./product-traits";

type Load = "loading" | "ready" | "not_found" | "error";
type CaptureState = { status: CaptureView["status"]; errorCode: CaptureView["errorCode"] };

const FAILURE_KEYS = {
  not_a_product: "not_a_product",
  timeout: "timeout",
  blocked: "blocked",
  robots_disallowed: "robots_disallowed",
} as const;

/** One column on a phone and in portrait (the gallery, then the blocks); side by side from 48rem in landscape and on desktop. */
const TWO_COLUMNS = "grid grid-cols-1 md:landscape:grid-cols-2 md:landscape:gap-space-6 lg:grid-cols-2 lg:gap-space-7";

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
  const [history, setHistory] = useState<PriceHistory | null>(null);

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

  // The price over 3 months, once the sheet is read and again after each capture; none for a hand-captured shop.
  const historyKey =
    product && product.name !== null && product.captureStatus !== "manual" ? (product.lastCapturedAt ?? "") : null;
  useEffect(() => {
    if (historyKey === null) return setHistory(null);
    let alive = true;
    fetchPriceHistory(productId).then(
      (found) => alive && setHistory(found),
      () => alive && setHistory(null),
    );
    return () => {
      alive = false;
    };
  }, [productId, historyKey]);

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

  const mention = history && hasName ? dropMention(history, new Date()) : null;
  const sinceText = (since: NonNullable<typeof mention>["since"]) =>
    since.kind === "today"
      ? t("product.sinceToday")
      : since.kind === "yesterday"
        ? t("product.sinceYesterday")
        : since.kind === "weekday"
          ? format.dateTime(since.date, { weekday: "long", timeZone: "UTC" })
          : t("product.sinceDate", {
              date: format.dateTime(since.date, { day: "numeric", month: "long", timeZone: "UTC" }),
            });
  const kept = hasName && itemLoad !== "error" && item !== null;

  // « Mis à jour le … »: at the end of the shop's sheet, or under the sizes when the sheet has no name yet (no shop
  // sheet then), as before the overhaul.
  const updatedLine = product.lastCapturedAt ? (
    <p className="text-sm text-ink-muted">
      <time dateTime={product.lastCapturedAt}>
        {t("product.updatedAt", {
          date: format.dateTime(new Date(product.lastCapturedAt), { dateStyle: "long" }),
        })}
      </time>
    </p>
  ) : null;

  const sizesBlock =
    product.sizes.length > 0 ? (
      <section aria-labelledby="sizes-title" data-block className={blockClass}>
        <h2 id="sizes-title" className="font-display text-lead">
          {t("product.sizes")}
        </h2>
        {manualShop && <p className="text-sm text-ink-muted">{t("product.manualSizes")}</p>}
        <ul className="flex flex-wrap gap-space-2">
          {product.sizes.map((size) => (
            <li
              key={size.label}
              className={`flex min-h-touch-target min-w-touch-target items-center justify-center rounded-button border border-line px-space-3 text-sm font-strong ${size.available ? "bg-surface-raised" : "text-ink-muted line-through"}`}
            >
              {size.label}
              {!size.available && <span className="sr-only"> ({t("product.unavailable")})</span>}
            </li>
          ))}
        </ul>
        {!hasName && updatedLine}
      </section>
    ) : null;

  const actions = (
    <ProductActions
      shop={shop}
      url={product.canonicalUrl}
      title={hasName ? product.name : null}
      item={kept ? item : null}
      onChange={setItem}
      reload={reloadItem}
    />
  );

  const shopSheet = hasName ? (
    <section aria-labelledby="shop-title" data-block className={blockClass}>
      <h2 id="shop-title" className="font-display text-lead">
        {tItem("sections.shop")}
      </h2>
      <ProductTraits traits={product.traits} />
      {product.description && <ProductDescription text={product.description} />}
      <ProductDetails details={product.details} />
      {updatedLine}
    </section>
  ) : null;

  return (
    <article className={`${TWO_COLUMNS} gap-space-5`} aria-busy={capturing || reloadedPending || undefined}>
      <div data-testid="product-gallery" className="lg:sticky lg:top-space-0 lg:self-start">
        {item && itemLoad !== "error" ? (
          <PhotoManager item={item} onChange={setItem} reload={reloadItem} />
        ) : product.images.length > 0 ? (
          <ProductGallery
            photos={product.images.map((image) => ({ ...image, group: "product" as const }))}
            alt={product.name ?? ""}
            thumbAlt={(n) => tItem("photos.alt", { n, name: product.name ?? shop })}
            groupLabels={{ product: tItem("photos.title") }}
          />
        ) : noPhotoYet ? (
          <Skeleton className="photo-shape aspect-3/4 w-full" />
        ) : !waiting ? (
          <PhotoPlaceholder label={t("product.noPhoto")} />
        ) : null}
      </div>

      <div data-testid="product-info" className="flex min-w-space-0 flex-col gap-space-4">
        <header data-testid="product-header" data-block className={blockClass}>
          <div className="flex flex-col gap-space-1">
            <p className="text-sm text-ink-muted">
              {waiting ? <span role="status">{t("product.loading", { shop })}</span> : shop}
            </p>
            {hasName && product.brand && (
              <p className="text-sm font-strong uppercase text-ink-muted">{product.brand}</p>
            )}
          </div>
          <h1
            ref={heading}
            tabIndex={-1}
            className={waiting ? "sr-only" : "font-display text-title text-balance focus:outline-none"}
          >
            {product.name ?? shop}
          </h1>
          {waiting && <Skeleton className="h-space-6 w-3/4" />}
          {hasName && product.priceCents === null && (
            <p className="text-ink-muted">{formatOptionalPrice(locale, null, currency, t("product.priceMissing"))}</p>
          )}
          {hasName && product.priceCents !== null && (
            <div className="flex flex-wrap items-center gap-x-space-4 gap-y-space-2">
              <p className="flex items-baseline gap-space-3 tabular-nums">
                <span className="font-display text-title">{formatPrice(locale, product.priceCents, currency)}</span>
                {product.compareAtCents !== null && product.compareAtCents > product.priceCents && (
                  <s className="text-lead text-ink-muted decoration-accent">
                    <span className="sr-only">{t("product.comparePrice")} </span>
                    {formatPrice(locale, product.compareAtCents, currency)}
                  </s>
                )}
              </p>
              {history && history.points.length >= 2 && (
                <div className="ml-auto">
                  <PriceCurve points={history.points} currency={currency} />
                </div>
              )}
            </div>
          )}
          {mention && (
            <p className="self-start rounded-full bg-success-soft px-space-3 py-space-1 text-sm font-strong text-success tabular-nums">
              {mention.months === null
                ? t("product.drop", {
                    amount: formatAmount(locale, mention.cents, currency),
                    since: sinceText(mention.since),
                  })
                : t("product.dropLowest", {
                    amount: formatAmount(locale, mention.cents, currency),
                    since: sinceText(mention.since),
                    months: mention.months,
                  })}
            </p>
          )}
          {waiting && <Skeleton className="h-space-5 w-1/3" />}
        </header>
        {waiting && <Skeleton className="h-space-6 w-1/2" />}
        {hasName && manualShop && (
          <p data-testid="manual-shop-note" data-block className={`${blockClass} text-sm`}>
            {t("product.manualNote", {
              shop,
              date: format.dateTime(new Date(product.updatedAt), { dateStyle: "long" }),
            })}
          </p>
        )}

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
        {kept && item ? (
          <ItemPanel
            item={item}
            onChange={setItem}
            onGone={() => setItem(null)}
            reload={reloadItem}
            middle={
              <>
                {sizesBlock}
                {actions}
              </>
            }
            shop={shopSheet}
          />
        ) : (
          <>
            {hasName && itemLoad === "loading" && !item && (
              <p role="status" className="text-sm text-ink-muted">
                {tItem("keep.working")}
              </p>
            )}
            {hasName && itemLoad === "ready" && !item && (
              <div data-block className={blockClass}>
                <KeepActions product={product} profileId={current.id} onKept={setItem} reload={reloadItem} />
              </div>
            )}
            {sizesBlock}
            {actions}
            {shopSheet}
          </>
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
    </article>
  );
}
