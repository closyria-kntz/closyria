"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Tick } from "@/components/tick";
import { buttonClass, primaryButtonClass, toggleButtonClass } from "@/components/ui";
import { COPIED_FEEDBACK_MS } from "@/lib/timing";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";

const touch = "min-h-touch-target";

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * The sheet's buttons (spec §6), on one row: « Je le prends » (her wish only: ticks it in « Ma commande », with
 * « Annuler »), « Voir chez {boutique} » (always, even while the capture runs or failed: she needs the shop's page to
 * fill the form), « Partager » (once the sheet is read). The sheet itself needs an account, so « Partager » gives the
 * SHOP's address: the phone's share menu when there is one, else the clipboard (« Lien de la boutique copié »).
 */
export function ProductActions({
  shop,
  url,
  title,
  item,
  onChange,
  reload,
}: {
  shop: string;
  /** The shop's page. */
  url: string;
  /** The product's name, for the share menu; null while the sheet is not read (no « Partager »). */
  title: string | null;
  item: ItemView | null;
  onChange: (item: ItemView) => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Capture.product");
  const tItem = useTranslations("Item");
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<{ ok: true } | { ok: false; url: string } | null>(null);
  const clear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clear.current), []);

  async function take(current: ItemView) {
    setBusy(true);
    const result = await patchItem(current.id, { inOrderDraft: !current.inOrderDraft });
    setBusy(false);
    if (!result.ok) return pushUndo(tItem(`errors.${result.error}` as "errors.failed"), null);
    onChange(result.item);
    pushUndo(tItem(result.item.inOrderDraft ? "toast.taken" : "toast.untaken"), undoWith(result.undo, reload));
  }

  async function share(name: string) {
    clearTimeout(clear.current);
    setShared(null);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: name, url });
        return;
      } catch (error) {
        // She closed the share menu: nothing to say.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShared({ ok: true });
      clear.current = setTimeout(() => setShared(null), COPIED_FEEDBACK_MS);
    } catch {
      setShared({ ok: false, url });
    }
  }

  return (
    <div data-testid="product-actions" className="flex flex-col gap-space-2">
      {/* One row under the blocks: « Je le prends », « Voir chez {boutique} », « Partager » (it wraps on a narrow phone). */}
      <div className="flex flex-wrap items-center gap-space-2">
        {item && item.stage === "spotted" && (
          <button
            type="button"
            disabled={busy}
            aria-pressed={item.inOrderDraft}
            onClick={() => void take(item)}
            className={`${toggleButtonClass} justify-center px-space-5`}
          >
            {item.inOrderDraft && <Tick draw />}
            {t("take")}
          </button>
        )}
        {isHttpUrl(url) && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryButtonClass} ${touch} px-space-5`}
          >
            {t("viewAt", { shop })}
          </a>
        )}
        {title !== null && isHttpUrl(url) && (
          <button
            type="button"
            onClick={() => void share(title)}
            className={`${buttonClass} ${touch} justify-center px-space-5`}
          >
            {t("share")}
          </button>
        )}
      </div>
      <p role="status" className="min-h-space-5 text-sm text-ink-muted">
        {shared?.ok ? (
          t("copied")
        ) : shared ? (
          <span className="break-all">{t("copyFailed", { url: shared.url })}</span>
        ) : null}
      </p>
    </div>
  );
}
