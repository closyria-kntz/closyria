"use client";

import { type AdminShopDetail, type ShopValue, shopValueSchema } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { adminRequest, catalogErrorKey, importErrorMessage } from "@/lib/admin-catalog";
import { buttonClass, primaryButtonClass } from "../../../ui";

/**
 * The shop in « Découvrir »: its values (filters), « Importer tout le catalogue » for a Shopify shop, and the state of
 * its last import (date, articles on sale, last error in plain words) with « Importer maintenant ».
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
  };

  const lastError = (() => {
    if (!shop.lastImportError) return t("noError");
    const message = importErrorMessage(shop.lastImportError);
    if ("raw" in message) return message.raw;
    return t(`importErrors.${message.key}`, { status: message.status === null ? "none" : String(message.status) });
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
              <dt className="text-ink-muted">{t("lastImport")}</dt>
              <dd className="tabular-nums">
                {shop.lastImportAt ? (
                  <time dateTime={shop.lastImportAt}>
                    {format.dateTime(new Date(shop.lastImportAt), {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "UTC",
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
            <div className="flex flex-col gap-space-1">
              <dt className="text-ink-muted">{t("lastError")}</dt>
              <dd className={shop.lastImportError ? "text-danger" : undefined}>{lastError}</dd>
            </div>
          </dl>
          <div>
            <button
              type="button"
              onClick={() => void importNow()}
              disabled={busy}
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
