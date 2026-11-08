"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Tick } from "@/components/tick";
import { buttonClass, primaryButtonClass, toggleButtonClass } from "@/components/ui";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";

const touch = "min-h-touch-target";
const COPIED_MS = 3000;

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * The sheet's buttons (spec §6): « Voir chez {boutique} », « Je le prends » (her wish only: ticks it in « Ma commande »,
 * with « Annuler »), « Partager » (copies the sheet's address, « Lien copié »). No item has a share link of its own:
 * only lists are shared, so « Partager » gives the page's address.
 */
export function ProductActions({
  shop,
  url,
  item,
  onChange,
  reload,
}: {
  shop: string;
  /** The shop's page. */
  url: string;
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

  async function share() {
    const address = `${window.location.origin}${window.location.pathname}`;
    clearTimeout(clear.current);
    try {
      await navigator.clipboard.writeText(address);
      setShared({ ok: true });
      clear.current = setTimeout(() => setShared(null), COPIED_MS);
    } catch {
      setShared({ ok: false, url: address });
    }
  }

  return (
    <div data-testid="product-actions" className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-center gap-space-2">
        {isHttpUrl(url) && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryButtonClass} ${touch} flex-1 basis-full sm:basis-auto`}
          >
            {t("viewAt", { shop })}
          </a>
        )}
        {item && item.stage === "spotted" && (
          <button
            type="button"
            disabled={busy}
            aria-pressed={item.inOrderDraft}
            onClick={() => void take(item)}
            className={`${toggleButtonClass} flex-1 justify-center`}
          >
            {item.inOrderDraft && <Tick draw />}
            {t("take")}
          </button>
        )}
        <button type="button" onClick={() => void share()} className={`${buttonClass} ${touch} flex-1 justify-center`}>
          {t("share")}
        </button>
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
