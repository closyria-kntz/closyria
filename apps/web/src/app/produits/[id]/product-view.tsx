"use client";

import type { CaptureView, ProductView as Product } from "@closyria/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { buttonClass, primaryButtonClass } from "@/components/ui";
import { pollCapture } from "@/lib/capture-poll";
import { fetchCaptureView, fetchProduct } from "@/lib/catalog-client";
import { formatPrice } from "@/lib/price";
import { ManualForm } from "./manual-form";

type Load = "loading" | "ready" | "not_found" | "error";
type CaptureState = { status: CaptureView["status"]; errorCode: CaptureView["errorCode"] };

const FAILURE_KEYS = {
  not_a_product: "not_a_product",
  timeout: "timeout",
  blocked: "blocked",
  robots_disallowed: "robots_disallowed",
} as const;

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
  const locale = useLocale();
  const format = useFormatter();
  const [product, setProduct] = useState<Product | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [attempt, setAttempt] = useState(0);
  const [capture, setCapture] = useState<CaptureState | null>(null);
  const [slow, setSlow] = useState(false);

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
    return pollCapture(captureId, (id) => fetchCaptureView(id), {
      onUpdate: (view) => {
        setCapture({ status: view.status, errorCode: view.errorCode });
        if (view.product) {
          setProduct(view.product);
          setLoad("ready");
        }
      },
      onSoftTimeout: () => setSlow(true),
    });
  }, [captureId]);

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
      <div role="status" aria-busy="true" className="flex flex-col gap-space-4">
        <span className="sr-only">{t("busy")}</span>
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="h-space-6 w-3/4" />
        <Skeleton className="h-space-5 w-1/3" />
      </div>
    );
  }

  const shop = product.shop.name;
  const hasName = product.name !== null;
  const capturing =
    captureId !== null && (capture === null || capture.status === "queued" || capture.status === "running");
  const reloadedPending = captureId === null && product.captureStatus === "pending" && !hasName;
  const waiting = !hasName && (capturing || reloadedPending);
  const failed = capture ? capture.status === "failed" : product.captureStatus === "failed";
  const manualShop = capture ? capture.status === "skipped_manual" : product.captureStatus === "manual";
  const failureKey = capture?.errorCode
    ? (FAILURE_KEYS[capture.errorCode as keyof typeof FAILURE_KEYS] ?? "other")
    : "other";
  const showForm = !hasName && (failed || manualShop || (slow && capturing));
  const currency = product.currency ?? "EUR";
  const noPhotoYet = product.images.length === 0 && (capturing || reloadedPending);

  return (
    <article className="flex flex-col gap-space-5" aria-busy={capturing || undefined}>
      {product.images.length > 0 ? (
        <div className="grid grid-cols-2 gap-space-2">
          {product.images.map((image, index) => (
            // biome-ignore lint/performance/noImgElement: photos come from our own /api/catalog-images, sized by the API.
            <img
              key={image.id}
              src={image.url}
              width={image.width}
              height={image.height}
              alt={product.name ?? ""}
              loading={index === 0 ? "eager" : "lazy"}
              className={`h-auto w-full rounded-card bg-media-backdrop object-cover ${index === 0 ? "col-span-2" : ""}`}
            />
          ))}
        </div>
      ) : noPhotoYet ? (
        <Skeleton className="aspect-square w-full" />
      ) : null}

      <header className="flex flex-col gap-space-2">
        <p className="text-sm text-ink-muted">
          {waiting ? <span role="status">{t("product.loading", { shop })}</span> : shop}
        </p>
        {hasName ? (
          <>
            {product.brand && <p className="text-sm font-strong uppercase text-ink-muted">{product.brand}</p>}
            <h1 className="font-display text-title font-strong">{product.name}</h1>
          </>
        ) : waiting ? (
          <Skeleton className="h-space-6 w-3/4" />
        ) : (
          <h1 className="font-display text-title font-strong">{shop}</h1>
        )}
      </header>

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

      {product.sizes.length > 0 && (
        <section aria-labelledby="sizes-title" className="flex flex-col gap-space-2">
          <h2 id="sizes-title" className="text-sm font-strong">
            {t("product.sizes")}
          </h2>
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
      {waiting && <Skeleton className="h-space-6 w-1/2" />}

      {!hasName && (failed || manualShop) && (
        <p role="status" className="text-ink-muted">
          {manualShop ? t("product.manualShop", { shop }) : t(`product.failure.${failureKey}`)}
        </p>
      )}
      {!hasName && slow && capturing && (
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
          }}
        />
      )}

      <footer className="flex flex-col items-start gap-space-3">
        {isHttpUrl(product.canonicalUrl) && (
          <a href={product.canonicalUrl} target="_blank" rel="noopener noreferrer" className={primaryButtonClass}>
            {t("product.viewAt", { shop })}
          </a>
        )}
        {product.lastCapturedAt && (
          <p className="text-sm text-ink-muted">
            <time dateTime={product.lastCapturedAt}>
              {t("product.updatedAt", {
                date: format.dateTime(new Date(product.lastCapturedAt), { dateStyle: "long" }),
              })}
            </time>
          </p>
        )}
      </footer>
    </article>
  );
}
