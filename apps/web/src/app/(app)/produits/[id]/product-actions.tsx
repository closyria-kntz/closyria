"use client";

import type { ItemView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Tick } from "@/components/tick";
import { focusRing } from "@/components/ui";
import { confirmUnlessReserved } from "@/lib/gift-check";
import { COPIED_FEEDBACK_MS } from "@/lib/timing";
import { pushUndo } from "@/lib/undo";
import { patchItem, undoWith } from "@/lib/wardrobe-client";

/** The sheet's buttons (mockup .actions .clay): 54 px with 16 px text, a finger tall on a phone. */
const actionClass = `inline-flex h-touch-target items-center justify-center gap-space-2 rounded-button px-space-5 text-sm font-strong sm:h-control-2xl sm:text-control ${focusRing}`;
/** The light ones (mockup .clay.light): the raised surface with a fine line. */
const lightClass = "border border-line bg-surface-raised text-ink hover:bg-surface-strong";

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
    // Taking it (not putting it back) asks first whether a friend plans to give it.
    if (!current.inOrderDraft && !(await confirmUnlessReserved([current.id], "take"))) return setBusy(false);
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
            className={`${actionClass} ${lightClass} aria-pressed:border-accent aria-pressed:bg-hint`}
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
            className={`${actionClass} bg-button-bg text-button-ink disabled:opacity-60`}
          >
            {t("viewAt", { shop })}
          </a>
        )}
        {title !== null && isHttpUrl(url) && (
          <button type="button" onClick={() => void share(title)} className={`${actionClass} ${lightClass}`}>
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
