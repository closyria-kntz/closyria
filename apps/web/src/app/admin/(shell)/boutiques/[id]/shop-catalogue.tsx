"use client";

import {
  type AdminShopDetail,
  type AdminShopImportStatus,
  canImportCatalogue,
  type ShopValue,
  shopValueSchema,
} from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, catalogErrorKey, importErrorMessage, parisClock } from "@/lib/admin-catalog";
import { importProgress, readImportStatus, startImportPolling, statusAfterImportRequest } from "@/lib/import-progress";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * The shop in « Découvrir »: its values (filters), « Importer tout le catalogue » for a Shopify or WooCommerce shop, and its import
 * with « Importer maintenant »: « En attente », then « Import en cours : page n, x articles lus » (read again every
 * 3 s by a light call, without reloading the page), then « Terminé à HH h MM : … » or the error in plain words; the date of the last import and the articles on
 * sale. While it is queued or running a bar shows how far it is: measured against the previous import's total
 * (« x / environ n articles »), indeterminate when there is none (« En attente », a first import).
 */
export function ShopCatalogue({ shop }: { shop: AdminShopDetail }) {
  const t = useTranslations("Admin.shops.catalogue");
  const errors = useTranslations("Admin.common.errors");
  const format = useFormatter();
  const router = useRouter();
  const [values, setValues] = useState<ShopValue[]>(shop.values);
  const [importEnabled, setImportEnabled] = useState(shop.importEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const [importMessage, setImportMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const importable = canImportCatalogue(shop.platform);

  // After a save the page is refreshed: show what the server kept.
  const resync = useRef(false);
  // The import fields live here, from the server props, then from the light status route: a failed read keeps them.
  const [status, setStatus] = useState<AdminShopImportStatus>(() => importFieldsOf(shop));
  useEffect(() => {
    setStatus(importFieldsOf(shop));
    if (!resync.current) return;
    resync.current = false;
    setValues(shop.values);
    setImportEnabled(shop.importEnabled);
  }, [shop]);

  // The progress of an import under way, read again until it is over; the page then refreshes once (counts).
  const importing = status.importState !== null;
  const shopId = shop.id;
  useEffect(() => {
    if (!importing) return;
    return startImportPolling({
      read: () => readImportStatus(shopId),
      onStatus: setStatus,
      onIdle: () => {
        try {
          router.refresh();
        } catch {
          // The panel already shows the end; the counts catch up on the next visit.
        }
      },
    });
  }, [importing, shopId, router]);

  const toggle = (value: ShopValue) =>
    setValues((list) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const res = await adminRequest("PATCH", `/api/admin/shops/${shop.id}`, {
      values: shopValueSchema.options.filter((v) => values.includes(v)),
      ...(importable ? { importEnabled } : {}),
    });
    setBusy(false);
    if (!res.ok) return setMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    setMessage({ text: t("saved"), failed: false });
    resync.current = true;
    router.refresh();
  };

  const importNow = async () => {
    if (busy) return;
    setBusy(true);
    setImportMessage(null);
    const res = await adminRequest("POST", `/api/admin/shops/${shop.id}/import`);
    setBusy(false);
    if (!res.ok) return setImportMessage({ text: errors(catalogErrorKey(res.status, res.body)), failed: true });
    const queued = (res.body as { queued?: unknown } | null)?.queued === true;
    setImportMessage({ text: t(queued ? "importQueued" : "importAlready"), failed: false });
    // « En attente » at once when queued; otherwise the current state stays until one read answers. The polling
    // above then follows it (no page reload).
    const next = await statusAfterImportRequest({ queued, current: status, read: () => readImportStatus(shop.id) });
    setStatus(next);
  };

  const lastError = (() => {
    if (!status.lastImportError) return null;
    const message = importErrorMessage(status.lastImportError);
    if ("raw" in message) return message.raw;
    return t(`importErrors.${message.key}`, { status: message.status === null ? "none" : String(message.status) });
  })();

  const progress = importProgress(status);
  const importLine = (() => {
    if (progress?.line === "queued") return t("state.queued");
    if (progress?.line === "starting") return t("state.starting");
    if (progress?.line === "running") return t("state.running", { pages: status.importPages, seen: progress.seen });
    if (progress?.line === "runningTotal") {
      return t("state.runningTotal", { seen: progress.seen, total: progress.total });
    }
    if (lastError !== null) return lastError;
    if (!status.lastImportAt) return t("state.none");
    const clock = parisClock(status.lastImportAt);
    return status.lastImportSeen === null || status.lastImportCreated === null || status.lastImportRemoved === null
      ? t("state.doneShort", clock)
      : t("state.done", {
          ...clock,
          total: status.lastImportSeen,
          created: status.lastImportCreated,
          removed: status.lastImportRemoved,
        });
  })();

  const announcement =
    status.importState === "queued"
      ? t("state.queued")
      : status.importState === "running"
        ? t("state.starting")
        : importLine;

  return (
    <section aria-labelledby="catalogue-title" className="flex flex-col gap-space-3">
      <h2 id="catalogue-title" className="font-display text-lead font-strong">
        {t("title")}
      </h2>
      <form onSubmit={save} aria-labelledby="catalogue-title" className="flex flex-col gap-space-3">
        <fieldset className="flex flex-col gap-space-2">
          <legend className="text-sm">{t("values")}</legend>
          <p className="text-sm text-ink-muted">{t("valuesHint")}</p>
          <div className="flex flex-wrap gap-x-space-4 gap-y-space-2">
            {shopValueSchema.options.map((value) => (
              <label key={value} className="flex min-h-touch-target items-center gap-space-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.includes(value)}
                  onChange={() => toggle(value)}
                  className="size-space-5 accent-accent"
                />
                {t(`valueLabels.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {importable ? (
          <label className="flex min-h-touch-target items-start gap-space-2 text-sm">
            <input
              type="checkbox"
              checked={importEnabled}
              onChange={(e) => setImportEnabled(e.target.checked)}
              aria-describedby="import-enabled-hint"
              className="mt-space-0-5 size-space-5 accent-accent"
            />
            <span className="flex flex-col gap-space-1">
              {t("importEnabled")}
              <span id="import-enabled-hint" className="text-ink-muted">
                {t("importEnabledHint")}
              </span>
            </span>
          </label>
        ) : null}
        <div>
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {t("save")}
          </button>
        </div>
        <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
          {message?.text}
        </p>
      </form>

      {importable ? (
        <>
          <dl className="flex flex-col gap-space-2 text-sm">
            <div className="flex flex-col gap-space-1">
              <dt className="text-ink-muted">{t("state.label")}</dt>
              <dd>
                <p
                  data-testid="import-state"
                  className={`tabular-nums ${!importing && lastError !== null ? "text-danger" : importing ? "font-strong" : ""}`}
                >
                  {importLine}
                </p>
                {progress ? (
                  // Native bar: determinate against the previous total, indeterminate (no value) otherwise. Its text
                  // is the line above; screen readers are told of the start and the end only (status below).
                  <progress
                    data-testid="import-progress"
                    className="import-progress mt-space-2"
                    aria-label={t("state.progress")}
                    aria-valuetext={importLine}
                    max={1}
                    {...(progress.value === null ? {} : { value: progress.value })}
                  />
                ) : null}
                {/* Read out on a change of state only (queued, started, over), never on each page read every 3 s. */}
                <p role="status" className="sr-only">
                  {announcement}
                </p>
              </dd>
            </div>
            <div className="flex flex-col gap-space-1">
              <dt className="text-ink-muted">{t("lastImport")}</dt>
              <dd className="tabular-nums">
                {status.lastImportAt ? (
                  <time dateTime={status.lastImportAt}>
                    {/* Paris time, like « Terminé à … » above. */}
                    {format.dateTime(new Date(status.lastImportAt), {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Europe/Paris",
                    })}
                  </time>
                ) : (
                  t("never")
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-space-1">
              <dt className="text-ink-muted">{t("products")}</dt>
              <dd className="tabular-nums">{format.number(shop.catalogueProducts)}</dd>
            </div>
          </dl>
          <div>
            <button
              type="button"
              onClick={() => void importNow()}
              disabled={busy || importing}
              className={`${buttonClass} min-h-touch-target`}
            >
              {t("importNow")}
            </button>
          </div>
          <p role="status" aria-live="polite" className={importMessage?.failed ? "text-danger" : "text-success"}>
            {importMessage?.text}
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">{t("notShopify")}</p>
      )}
    </section>
  );
}

function importFieldsOf(shop: AdminShopDetail): AdminShopImportStatus {
  return {
    importState: shop.importState,
    importStartedAt: shop.importStartedAt,
    importPages: shop.importPages,
    importSeen: shop.importSeen,
    lastImportAt: shop.lastImportAt,
    lastImportError: shop.lastImportError,
    lastImportSeen: shop.lastImportSeen,
    lastImportCreated: shop.lastImportCreated,
    lastImportRemoved: shop.lastImportRemoved,
    importExpected: shop.importExpected,
  };
}
