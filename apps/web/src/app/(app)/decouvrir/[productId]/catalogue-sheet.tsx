"use client";

import {
  type CatalogDetail,
  isHttpUrl,
  isOneSize,
  type ReportReason,
  reportReasonSchema,
  sizeMatches,
} from "@closyria/shared";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { AddToListDialog } from "@/components/add-to-list-dialog";
import { CatalogueCard, HeartIcon, useWant } from "@/components/catalogue-card";
import { Dialog } from "@/components/dialog";
import { sectionTitleClass } from "@/components/home-news";
import { GRID_CLASS } from "@/components/item-grid";
import { ShareSheet } from "@/components/share-sheet";
import {
  blockClass,
  blockTitleClass,
  buttonClass,
  focusRing,
  moreButtonClass,
  primaryButtonClass,
} from "@/components/ui";
import { formatAmount } from "@/lib/budget";
import { DISCOVER_PATH, fetchCatalogueDetail, readLastDiscoverHref, reportArticle } from "@/lib/catalogue-client";
import { formatPrice, priceDropCents } from "@/lib/price";
import { profileHref, useCurrentProfile, useProfilesReady } from "@/lib/profile-context";
import { actionClass, LOOK } from "../../produits/[id]/product-actions";
import { ProductGallery } from "../../produits/[id]/product-gallery";
import { TWO_COLUMNS } from "../../produits/[id]/product-view";

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "not_found" }
  | { status: "ready"; sheet: CatalogDetail };

const touch = "min-h-touch-target";
/** The photos' nominal size (3:4): the API resizes them, the frame keeps the shape. */
const PHOTO_SIZE = { width: 600, height: 800 } as const;
/**
 * « Stocks frais »: while the API reads the article again at the shop, the sheet reads itself again 3 s then 8 s after
 * it opened, and stops as soon as the article was read (its `checkedAt` moved).
 */
const REFRESH_POLLS_MS = [3000, 8000] as const;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * « Vérification du stock… » while the article is read again, then « Vérifié à l’instant » / « Stock vérifié il y a
 * N min » (or N h, or the day): discreet, under the price, announced politely when it changes.
 */
function StockChecked({ checkedAt, refreshing }: { checkedAt: string | null; refreshing: boolean }) {
  const t = useTranslations("Discover.sheet");
  const format = useFormatter();
  let text: string | null = null;
  if (refreshing) text = t("checking");
  else if (checkedAt) {
    const age = Math.max(0, Date.now() - new Date(checkedAt).getTime());
    if (age < MINUTE_MS) text = t("checkedNow");
    else if (age < HOUR_MS) text = t("checkedMinutes", { minutes: Math.floor(age / MINUTE_MS) });
    else if (age < 24 * HOUR_MS) text = t("checkedHours", { hours: Math.floor(age / HOUR_MS) });
    else text = t("checkedOn", { date: format.dateTime(new Date(checkedAt), { day: "numeric", month: "long" }) });
  }
  if (!text) return null;
  return (
    <p data-testid="stock-checked" aria-live="polite" className="text-meta text-ink-muted">
      {text}
    </p>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-card ${className}`} />;
}

/**
 * The sheet of a catalogue article (spec §3.2), laid out like her product sheet: the gallery, then the shop (a link to
 * its other articles), the name, the price and its drop, « Ta taille en stock », « Aimé par N personnes » (from 3,
 * never who), the sizes (hers filled, sold out struck through) and « Que veux-tu faire ? » as written buttons: « Je le
 * veux », « Voir chez … », « Ajouter à une liste », « Partager ». Already hers: « Dans tes envies » (or its step) and
 * « Voir ma fiche ». Then her close pieces, the same shop, the same style, and a quiet « Signaler ».
 */
export function CatalogueSheet({ productId }: { productId: string }) {
  const t = useTranslations("Discover.sheet");
  const tCard = useTranslations("Discover.card");
  const tProduct = useTranslations("Capture.product");
  const tItem = useTranslations("Item");
  const tStage = useTranslations("Item.stage");
  const tShare = useTranslations("Share");
  const locale = useLocale();
  const ready = useProfilesReady();
  const current = useCurrentProfile();
  const want = useWant();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [backHref, setBackHref] = useState(DISCOVER_PATH);

  useEffect(() => setBackHref(readLastDiscoverHref()), []);

  const reload = useCallback(async () => {
    try {
      const found = await fetchCatalogueDetail(productId, current.id);
      setLoad(found === "not_found" ? { status: "not_found" } : { status: "ready", sheet: found });
    } catch {
      // Kept as it is.
    }
  }, [productId, current.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on « Réessayer ».
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchCatalogueDetail(productId, current.id, undefined, controller.signal).then(
      (found) => setLoad(found === "not_found" ? { status: "not_found" } : { status: "ready", sheet: found }),
      () => !controller.signal.aborted && setLoad({ status: "error" }),
    );
    return () => controller.abort();
  }, [productId, current.id, ready, attempt]);

  // « Stocks frais »: the article is being read again at the shop. Its sizes and price are put in place quietly,
  // everything else (her choices on the sheet) stays as it is.
  const refreshing = load.status === "ready" && load.sheet.refreshing;
  const checkedAt = load.status === "ready" ? load.sheet.checkedAt : null;
  useEffect(() => {
    if (!refreshing) return;
    const controller = new AbortController();
    const settle = (found: CatalogDetail | null) =>
      setLoad((previous) => {
        if (previous.status !== "ready") return previous;
        const fresh = found
          ? {
              priceCents: found.priceCents,
              previousPriceCents: found.previousPriceCents,
              currency: found.currency,
              sizes: found.sizes,
              sizeInStock: found.sizeInStock,
              checkedAt: found.checkedAt,
            }
          : {};
        return { status: "ready", sheet: { ...previous.sheet, ...fresh, refreshing: false } };
      });
    const poll = async (last: boolean) => {
      let found: CatalogDetail | "not_found" | null = null;
      try {
        found = await fetchCatalogueDetail(productId, current.id, undefined, controller.signal);
      } catch {
        // Kept as it is.
      }
      if (controller.signal.aborted) return;
      const sheet = found === "not_found" ? null : found;
      // Read: put in place (this effect then ends). Not yet: wait for the last try, then keep what was read.
      if (sheet && (sheet.checkedAt !== checkedAt || !sheet.refreshing)) settle(sheet);
      else if (last) settle(sheet);
    };
    const timers = REFRESH_POLLS_MS.map((ms, index) =>
      setTimeout(() => void poll(index === REFRESH_POLLS_MS.length - 1), ms),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
      controller.abort();
    };
  }, [refreshing, checkedAt, productId, current.id]);

  const back = (
    <Link
      href={backHref}
      className={`inline-flex min-h-touch-target items-center self-start rounded-pill text-menu font-bold text-ink lg:hidden ${focusRing}`}
    >
      {t("back")}
    </Link>
  );

  if (load.status === "not_found") {
    return (
      <div className="flex flex-col items-start gap-space-3">
        <h1 className="font-display text-page-title leading-none">{t("notFound")}</h1>
        <Link href={backHref} className={`${primaryButtonClass} ${touch}`}>
          {t("back")}
        </Link>
      </div>
    );
  }
  if (load.status === "error") {
    return (
      <div className="flex flex-col items-start gap-space-3">
        <p role="alert">{t("loadError")}</p>
        <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setAttempt((n) => n + 1)}>
          {t("retry")}
        </button>
      </div>
    );
  }
  if (load.status === "loading") {
    return (
      <div role="status" aria-busy="true" className={`${TWO_COLUMNS} gap-space-4`}>
        <h1 className="sr-only">{t("loading")}</h1>
        <Skeleton className="aspect-3/4 w-full" />
        <div className="flex flex-col gap-space-4">
          <Skeleton className="h-space-6 w-3/4" />
          <Skeleton className="h-space-5 w-1/3" />
        </div>
      </div>
    );
  }

  const { sheet } = load;
  const shop = sheet.shop.name;
  const drop = priceDropCents(sheet.priceCents, sheet.previousPriceCents);
  const mine = sheet.myItem;
  const myItemHref = profileHref(`/produits/${sheet.productId}`, current.id, current.isDefault);
  const shopHref = profileHref(`${DISCOVER_PATH}?boutique=${sheet.shop.id}`, current.id, current.isDefault);
  const setSheet = (patch: Partial<CatalogDetail>) =>
    setLoad((previous) =>
      previous.status === "ready" ? { status: "ready", sheet: { ...previous.sheet, ...patch } } : previous,
    );
  const setWanted = (productIdOf: string, wanted: boolean) =>
    setLoad((previous) => {
      if (previous.status !== "ready") return previous;
      const mark = (cards: CatalogDetail["sameShop"]) =>
        cards.map((card) => (card.productId === productIdOf ? { ...card, wanted } : card));
      return {
        status: "ready",
        sheet: {
          ...previous.sheet,
          sameShop: mark(previous.sheet.sameShop),
          sameStyle: mark(previous.sheet.sameStyle),
        },
      };
    });

  async function onWant() {
    setBusy(true);
    const item = await want(sheet.productId, reload);
    setBusy(false);
    if (item) setSheet({ wanted: true, myItem: { itemId: item.id, stage: item.stage } });
  }

  // What makes « Ta taille en stock » true for an article in « taille unique » only (`sizeInStock` in the API).
  const availableLabels = sheet.sizes.filter((s) => s.available).map((s) => s.label);
  const oneSizeOnly =
    sheet.sizeInStock === true && availableLabels.length > 0 && availableLabels.every((label) => isOneSize(label));

  const sizesBlock =
    sheet.sizes.length > 0 ? (
      <section aria-labelledby="sizes-title" className="flex flex-col gap-space-2">
        <h2 id="sizes-title" className="text-meta font-bold tracking-wide text-ink uppercase">
          {tProduct("sizes")}
        </h2>
        <ul className="flex flex-wrap gap-space-2">
          {sheet.sizes.map((size) => {
            // Every one of her sizes; « taille unique » only when every available size is (the card's rule).
            const isMine =
              sizeMatches(sheet.mySizes, [size.label]) === true ||
              (oneSizeOnly && size.available && isOneSize(size.label));
            return (
              <li
                key={size.label}
                data-mine={isMine || undefined}
                className={`flex min-w-size-chip items-center justify-center rounded-pill px-space-3 py-space-2 text-chip font-strong ${isMine ? "bg-ink text-surface" : size.available ? "bg-surface-strong text-ink" : "bg-surface-strong text-ink-muted"} ${size.available ? "" : "line-through"}`}
              >
                {size.label}
                {!size.available && <span className="sr-only"> ({tProduct("unavailable")})</span>}
                {isMine && <span className="sr-only"> ({tProduct("yourSize")})</span>}
              </li>
            );
          })}
        </ul>
      </section>
    ) : null;

  const actions = (
    <section aria-labelledby="todo-title" aria-busy={busy || undefined} className="flex flex-col gap-space-2">
      <h2 id="todo-title" className="text-meta font-bold tracking-wide text-ink uppercase">
        {t("actions")}
      </h2>
      <div className="grid grid-cols-2 gap-space-2">
        {mine ? (
          <Link href={myItemHref} data-primary="true" className={`${actionClass} ${LOOK.primary}`}>
            {t("mine")}
          </Link>
        ) : (
          <button
            type="button"
            disabled={busy}
            data-primary="true"
            onClick={() => void onWant()}
            className={`${actionClass} ${LOOK.primary}`}
          >
            <HeartIcon filled={false} />
            {t("want")}
          </button>
        )}
        {/* Never a `javascript:` or other address as a link (the schema also requires http(s)). */}
        {isHttpUrl(sheet.url) ? (
          <a href={sheet.url} target="_blank" rel="noopener noreferrer" className={`${actionClass} ${LOOK.outline}`}>
            {tProduct("viewAt", { shop })}
          </a>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => setListsOpen(true)}
          className={`${actionClass} ${LOOK.soft}`}
        >
          {t("addToList")}
        </button>
        {isHttpUrl(sheet.url) ? (
          <button type="button" onClick={() => setSharing(true)} className={`${actionClass} ${LOOK.soft}`}>
            {tProduct("share")}
          </button>
        ) : null}
      </div>
    </section>
  );

  return (
    <div className="flex flex-col gap-space-6 pb-space-6">
      <div className="flex flex-col gap-space-2">
        {back}
        <article className={`${TWO_COLUMNS} gap-space-5`}>
          <div data-testid="product-gallery" className="lg:sticky lg:top-space-0 lg:self-start">
            <ProductGallery
              photos={sheet.images.map((url) => ({ id: url, url, ...PHOTO_SIZE, group: "product" as const }))}
              alt={sheet.name}
              thumbAlt={(n) => tItem("photos.alt", { n, name: sheet.name })}
              groupLabels={{ product: tItem("photos.title") }}
            />
          </div>
          <div data-testid="product-info" className="flex min-w-space-0 flex-col gap-space-3-5">
            <header className="flex flex-col gap-space-3-5">
              <Link
                href={shopHref}
                className={`self-start text-meta text-ink-muted underline underline-offset-3 hover:text-ink ${focusRing}`}
              >
                <span className="sr-only">{t("shopLink", { shop })} : </span>
                <span aria-hidden="true">{shop}</span>
              </Link>
              <h1 className="font-display text-page-title leading-none text-balance">{sheet.name}</h1>
              <div className="flex flex-wrap items-center gap-x-space-3 gap-y-space-2">
                <p className="flex flex-wrap items-baseline gap-x-space-2 text-body tabular-nums">
                  <span className="font-bold">{formatPrice(locale, sheet.priceCents, sheet.currency)}</span>
                  {drop !== null && sheet.previousPriceCents !== null && (
                    <s className="text-ink-muted">
                      <span className="sr-only">{tProduct("comparePrice")} </span>
                      {formatPrice(locale, sheet.previousPriceCents, sheet.currency)}
                    </s>
                  )}
                </p>
                {drop !== null && (
                  <span className="rounded-full bg-success-soft px-space-3 py-space-1-5 text-caption font-strong text-success tabular-nums">
                    −{formatAmount(locale, drop, sheet.currency)}
                  </span>
                )}
              </div>
              <StockChecked checkedAt={sheet.checkedAt} refreshing={sheet.refreshing} />
              {(sheet.sizeInStock === true || sheet.likes !== null) && (
                <div className="flex flex-wrap items-center gap-x-space-3 gap-y-space-2">
                  {sheet.sizeInStock === true && <span className="clothing-tag">{tCard("mySize")}</span>}
                  {sheet.likes !== null && (
                    <span data-testid="likes" className="inline-flex items-center gap-space-1-5 text-sm text-ink-muted">
                      <HeartIcon filled className="size-space-4 text-accent" />
                      {t("likes", { count: sheet.likes })}
                    </span>
                  )}
                </div>
              )}
            </header>
            {mine && (
              <p
                role="status"
                className="flex flex-wrap items-center gap-space-2 rounded-card border border-accent bg-hint px-space-3 py-space-2 text-sm font-strong"
              >
                <HeartIcon filled />
                {mine.stage === "spotted" ? t("wanted") : t("stage", { stage: tStage(mine.stage) })}
              </p>
            )}
            {sizesBlock}
            {actions}
            {sheet.close.length > 0 && (
              <section aria-labelledby="close-title" data-block className={blockClass}>
                <h2 id="close-title" className={blockTitleClass}>
                  {t("close")}
                </h2>
                <ul className="grid grid-cols-3 gap-space-2-5">
                  {sheet.close.map((piece) => {
                    const inner = (
                      <>
                        <span className="block aspect-3/4 overflow-hidden rounded-card bg-media-backdrop">
                          {piece.imageUrl && (
                            // biome-ignore lint/performance/noImgElement: photos come from our own API, already resized.
                            <img src={piece.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
                          )}
                        </span>
                        <span className="truncate text-meta font-strong">{piece.name}</span>
                        <span className="truncate text-meta text-ink-muted">{tStage(piece.stage)}</span>
                      </>
                    );
                    return (
                      <li key={piece.itemId} className="flex min-w-space-0">
                        {piece.productId ? (
                          <Link
                            href={profileHref(`/produits/${piece.productId}`, current.id, current.isDefault)}
                            className={`flex w-full min-w-space-0 flex-col gap-space-1 rounded-card ${focusRing}`}
                          >
                            {inner}
                          </Link>
                        ) : (
                          <span className="flex w-full min-w-space-0 flex-col gap-space-1">{inner}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <button type="button" onClick={() => setReporting(true)} className={`${moreButtonClass} text-ink-muted`}>
              {t("report")}
            </button>
          </div>
        </article>
      </div>

      {sheet.sameShop.length > 0 && (
        <section aria-labelledby="same-shop-title" className="flex flex-col gap-space-2-5">
          <h2 id="same-shop-title" className={sectionTitleClass}>
            {t("sameShop")}
          </h2>
          <ul aria-labelledby="same-shop-title" className={GRID_CLASS}>
            {sheet.sameShop.map((card) => (
              <CatalogueCard key={card.productId} card={card} onWanted={setWanted} />
            ))}
          </ul>
        </section>
      )}
      {sheet.sameStyle.length > 0 && (
        <section aria-labelledby="same-style-title" className="flex flex-col gap-space-2-5">
          <h2 id="same-style-title" className={sectionTitleClass}>
            {t("sameStyle")}
          </h2>
          <ul aria-labelledby="same-style-title" className={GRID_CLASS}>
            {sheet.sameStyle.map((card) => (
              <CatalogueCard key={card.productId} card={card} onWanted={setWanted} />
            ))}
          </ul>
        </section>
      )}

      <AddToListDialog
        open={listsOpen}
        onClose={() => setListsOpen(false)}
        productId={sheet.productId}
        profileId={current.id}
        onKept={(item) => setSheet({ wanted: true, myItem: { itemId: item.id, stage: item.stage } })}
        reload={reload}
      />
      <ShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        title={sheet.name}
        text={tShare("productText", { name: sheet.name, shop })}
        url={sheet.url}
      />
      <ReportDialog productId={sheet.productId} open={reporting} onClose={() => setReporting(false)} />
    </div>
  );
}

/** « Signaler »: a reason (« Pas de la mode », « Contenu choquant », « Autre »), then « Merci, on regarde. », every time. */
function ReportDialog({ productId, open, onClose }: { productId: string; open: boolean; onClose: () => void }) {
  const t = useTranslations("Discover.sheet");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const name = useId();

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setState("idle");
  }, [open]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setState("sending");
    setState((await reportArticle(productId, reason)) ? "done" : "failed");
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("reportTitle")} closeLabel={t("reportCancel")}>
      {state === "done" ? (
        <p role="status" className="text-lead">
          {t("reportDone")}
        </p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-space-3">
          <fieldset className="flex flex-col gap-space-2">
            <legend className="mb-space-2 text-sm font-strong">{t("reportReason")}</legend>
            {reportReasonSchema.options.map((option) => (
              <label
                key={option}
                className="flex min-h-touch-target cursor-pointer items-center gap-space-3 rounded-button border border-line bg-surface-raised px-space-3 has-checked:border-accent has-checked:bg-hint"
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={reason === option}
                  onChange={() => setReason(option)}
                  className="size-space-4 accent-accent"
                />
                {t(`reasons.${option}`)}
              </label>
            ))}
          </fieldset>
          {state === "failed" && (
            <p role="alert" className="text-sm text-danger">
              {t("reportFailed")}
            </p>
          )}
          <button type="submit" disabled={!reason || state === "sending"} className={`${primaryButtonClass} ${touch}`}>
            {t("reportSend")}
          </button>
        </form>
      )}
    </Dialog>
  );
}
