"use client";

import { type ItemStage, type ItemView, MAX_ITEM_PHOTOS } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Dialog } from "@/components/dialog";
import { Choices } from "@/components/item-menu";
import { ShareSheet } from "@/components/share-sheet";
import { Tick } from "@/components/tick";
import { focusRing } from "@/components/ui";
import { canReceiveAsGift, confirmUnlessReserved } from "@/lib/gift-check";
import { pushUndo } from "@/lib/undo";
import { patchItem, receiveAsGift, undoWith } from "@/lib/wardrobe-client";
import { StageDialog } from "./stage-dialog";

/** A written button of « Que veux-tu faire ? » (mockup .acts .btn): a pill, a finger tall, 13.5 px bold. */
const actionClass = `inline-flex min-h-touch-target items-center justify-center gap-space-1-5 rounded-pill border-2 px-space-4 py-space-1-5 text-center text-menu font-bold leading-tight disabled:opacity-60 ${focusRing}`;
/** The main one (.btn.pri), the shop's link (.btn, outlined in ink), the others (.btn.soft). */
const LOOK = {
  primary: "border-button-bg bg-button-bg text-button-ink",
  outline: "border-ink bg-transparent text-ink hover:bg-surface-sunken",
  soft: "border-transparent bg-surface-sunken text-ink hover:bg-surface-strong",
} as const;

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

type Action =
  | { key: string; label: string; href: string }
  | { key: string; label: string; onClick: () => void; pressed?: boolean; tick?: boolean };

/**
 * « Que veux-tu faire ? » (refonte Boudoir, spec R8): what she can do with the article at its step, as written buttons,
 * the main one first, two by two. Envie: « Je l’ai commandé », « Voir chez … », « Ajouter à une liste », « Je le prends »,
 * « Partager ». Commandé: « Je l’ai reçu », « Voir chez … », « Je l’ai retourné », « Reçu en cadeau », « Partager ».
 * Reçu / Dans mon dressing: « Je le mets en vente », « Je l’ai retourné » (Reçu only), « Ajouter une photo »,
 * « Partager ». Each opens what the sheet already did (the stage window, which asks first when a friend plans to give
 * it). Not kept: « Voir chez … » and « Partager ». « Partager » opens the share window (task 9) with « {nom} chez
 * {boutique} » and the SHOP's address (the sheet needs an account).
 */
export function ProductActions({
  shop,
  url,
  title,
  item,
  onChange,
  reload,
  onAddPhoto,
}: {
  shop: string;
  /** The shop's page. */
  url: string;
  /** The product's name, for the share menu; null while the sheet is not read (no « Partager »). */
  title: string | null;
  item: ItemView | null;
  onChange: (item: ItemView) => void;
  reload: () => Promise<void>;
  /** Opens the gallery's « Ajouter une photo » window. */
  onAddPhoto?: () => void;
}) {
  const t = useTranslations("Capture.product");
  const tItem = useTranslations("Item");
  const tTodo = useTranslations("Item.todo");
  const tGifts = useTranslations("Gifts.received");
  const tMenu = useTranslations("Views.menu");
  const tShare = useTranslations("Share");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ItemStage | null>(null);
  const [listsOpen, setListsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fail = (code: string) => pushUndo(tItem(`errors.${code}` as "errors.failed"), null);

  async function take(current: ItemView) {
    setBusy(true);
    // Taking it (not putting it back) asks first whether a friend plans to give it.
    if (!current.inOrderDraft && !(await confirmUnlessReserved([current.id], "take"))) return setBusy(false);
    const result = await patchItem(current.id, { inOrderDraft: !current.inOrderDraft });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    onChange(result.item);
    pushUndo(tItem(result.item.inOrderDraft ? "toast.taken" : "toast.untaken"), undoWith(result.undo, reload));
  }

  // « Reçu en cadeau »: to « Reçu », « Offert par … » under the stages, « Annuler » for a few seconds.
  async function receive(current: ItemView) {
    setBusy(true);
    const result = await receiveAsGift(current.id);
    setBusy(false);
    if (!result.ok) return fail(result.error);
    onChange(result.item);
    pushUndo(tGifts("toast"), undoWith(result.undo, reload));
  }

  const viewAt: Action | null = isHttpUrl(url) ? { key: "shop", label: t("viewAt", { shop }), href: url } : null;
  const shareAction: Action | null =
    title !== null && isHttpUrl(url) ? { key: "share", label: t("share"), onClick: () => setSharing(true) } : null;
  const toStage = (key: string, label: string, target: ItemStage): Action => ({
    key,
    label,
    onClick: () => setStage(target),
  });
  const photo: Action | null =
    item && onAddPhoto && item.photos.filter((p) => p.source === "private").length < MAX_ITEM_PHOTOS
      ? { key: "photo", label: tTodo("addPhoto"), onClick: onAddPhoto }
      : null;

  /** By step, the main one first (« Voir chez … » stays reachable at every step). */
  function actionsAt(current: ItemView): (Action | null)[] {
    switch (current.stage) {
      case "spotted":
        return [
          toStage("ordered", tTodo("ordered"), "ordered"),
          viewAt,
          { key: "list", label: tTodo("addToList"), onClick: () => setListsOpen(true) },
          {
            key: "take",
            label: t("take"),
            onClick: () => void take(current),
            pressed: current.inOrderDraft,
            tick: current.inOrderDraft,
          },
          shareAction,
        ];
      case "ordered":
        return [
          toStage("received", tTodo("received"), "owned"),
          viewAt,
          toStage("returned", tTodo("returned"), "returned"),
          canReceiveAsGift(current)
            ? { key: "gift", label: tGifts("action"), onClick: () => void receive(current) }
            : null,
          shareAction,
        ];
      case "owned":
        return [
          toStage("forSale", tTodo("forSale"), "for_sale"),
          viewAt,
          current.received ? toStage("returned", tTodo("returned"), "returned") : null,
          photo,
          shareAction,
        ];
      case "for_sale":
        return [toStage("sold", tTodo("sold"), "sold"), viewAt, photo, shareAction];
      case "sold":
        return [shareAction, viewAt, photo];
      case "returned":
        return [viewAt, shareAction];
    }
  }

  const actions = item ? actionsAt(item) : [viewAt, shareAction];
  const shown = actions.filter((action): action is Action => action !== null);

  return (
    <>
      <section
        aria-labelledby="todo-title"
        aria-busy={busy || undefined}
        data-testid="product-actions"
        className="flex flex-col gap-space-2"
      >
        <h2 id="todo-title" className="text-meta font-bold tracking-wide text-ink uppercase">
          {tTodo("title")}
        </h2>
        <div className="grid grid-cols-2 gap-space-2">
          {shown.map((action, index) => {
            const look = index === 0 ? LOOK.primary : "href" in action ? LOOK.outline : LOOK.soft;
            const primary = index === 0 ? "true" : undefined;
            return "href" in action ? (
              <a
                key={action.key}
                href={action.href}
                target="_blank"
                rel="noopener noreferrer"
                data-primary={primary}
                className={`${actionClass} ${look}`}
              >
                {action.label}
              </a>
            ) : (
              <button
                key={action.key}
                type="button"
                disabled={busy}
                aria-pressed={action.pressed}
                data-primary={primary}
                onClick={action.onClick}
                className={`${actionClass} ${look} aria-pressed:border-selected-line aria-pressed:bg-hint`}
              >
                {action.tick && <Tick draw />}
                {action.label}
              </button>
            );
          })}
        </div>
        {item && (
          <>
            <StageDialog item={item} stage={stage} onClose={() => setStage(null)} onDone={onChange} reload={reload} />
            <Dialog
              open={listsOpen}
              onClose={() => setListsOpen(false)}
              title={tTodo("listsTitle")}
              closeLabel={tMenu("close")}
            >
              {listsOpen && (
                <Choices
                  choice="list"
                  item={item}
                  onChanged={onChange}
                  onClose={() => setListsOpen(false)}
                  reload={reload}
                />
              )}
            </Dialog>
          </>
        )}
      </section>
      {title !== null && isHttpUrl(url) && (
        <ShareSheet
          open={sharing}
          onClose={() => setSharing(false)}
          title={title}
          text={tShare("productText", { name: title, shop })}
          url={url}
        />
      )}
    </>
  );
}
