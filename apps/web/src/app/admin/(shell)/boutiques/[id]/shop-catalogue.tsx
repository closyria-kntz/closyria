"use client";

import { type AdminShopDetail, type ShopValue, shopValueSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, catalogErrorKey, importErrorMessage, parisClock } from "@/lib/admin-catalog";
import { buttonClass, primaryButtonClass } from "../../../ui";

/** While an import is queued or running, the page reads its progress again this often. */
export const IMPORT_REFRESH_MS = 3000;

/**
 * The shop in « Découvrir »: its values (filters), « Importer tout le catalogue » for a Shopify shop, and its import
 * with « Importer maintenant »: « En attente », then « Import en cours : page n, x articles lus » (read again every
 * 3 s), then « Terminé à HH h MM : … » or the error in plain words; the date of the last import and the articles on
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
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setValues(shop.values);
    setImportEnabled(shop.importEnabled);
  }, [shop]);

  // The progress of an import under way, read again until it is over.
  const importing = shop.importState !== null;
  useEffect(() => {
    if (!importing) return;
    const timer = setInterval(() => router.refresh(), IMPORT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [importing, router]);

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
    // « En attente » at once, then the progress.
    router.refresh();
  };

  const lastError = (() => {
    if (!shop.lastImportError) return null;
    const message = importErrorMessage(shop.lastImportError);
    if ("raw" in message) return message.raw;
    return t(`importErrors.${message.key}`, { status: message.status === null ? "none" : String(message.status) });
  })();

  const importLine = (() => {
    if (shop.importState === "queued") return t("state.queued");
    if (shop.importState === "running") {
      return shop.importPages > 0
        ? t("state.running", { pages: shop.importPages, seen: shop.importSeen })
        : t("state.starting");
    }
    if (lastError !== null) return lastError;
    if (!shop.lastImportAt) return t("state.none");
    const clock = parisClock(shop.lastImportAt);
    return shop.lastImportCreated === null || shop.lastImportRemoved === null
      ? t("state.doneShort", clock)
      : t("state.done", {
          ...clock,
          total: shop.importSeen,
          created: shop.lastImportCreated,
          removed: shop.lastImportRemoved,
        });
  })();

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
                  role="status"
                  data-testid="import-state"
                  className={`tabular-nums ${!importing && lastError !== null ? "text-danger" : importing ? "font-strong" : ""}`}
                >
                  {importLine}
                </p>
              </dd>
            </div>
            <div className="flex flex-col gap-space-1">
              <dt className="text-ink-muted">{t("lastImport")}</dt>
              <dd className="tabular-nums">
                {shop.lastImportAt ? (
                  <time dateTime={shop.lastImportAt}>
                    {/* Paris time, like « Terminé à … » above. */}
                    {format.dateTime(new Date(shop.lastImportAt), {
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
