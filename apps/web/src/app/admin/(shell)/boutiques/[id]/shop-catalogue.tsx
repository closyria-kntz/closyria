"use client";

import { type AdminShopDetail, type AdminShopImportStatus, type ShopValue, shopValueSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, catalogErrorKey, importErrorMessage, parisClock } from "@/lib/admin-catalog";
import { readImportStatus, startImportPolling } from "@/lib/import-progress";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * The shop in « Découvrir »: its values (filters), « Importer tout le catalogue » for a Shopify shop, and its import
 * with « Importer maintenant »: « En attente », then « Import en cours : page n, x articles lus » (read again every
 * 3 s by a light call, without reloading the page), then « Terminé à HH h MM : … » or the error in plain words; the date of the last import and the articles on
 * sale.
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
  const shopify = shop.platform === "shopify";

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
      ...(shopify ? { importEnabled } : {}),
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
    // « En attente » at once, then the progress (read by the polling above, no page reload).
    setStatus((current) => ({
      ...current,
      importState: "queued",
      importStartedAt: new Date().toISOString(),
      importPages: 0,
      importSeen: 0,
    }));
  };

  const lastError = (() => {
    if (!status.lastImportError) return null;
    const message = importErrorMessage(status.lastImportError);
    if ("raw" in message) return message.raw;
    return t(`importErrors.${message.key}`, { status: message.status === null ? "none" : String(message.status) });
  })();

  const importLine = (() => {
    if (status.importState === "queued") return t("state.queued");
    if (status.importState === "running") {
      return status.importPages > 0
        ? t("state.running", { pages: status.importPages, seen: status.importSeen })
        : t("state.starting");
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
        {shopify ? (
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

      {shopify ? (
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
  };
}
