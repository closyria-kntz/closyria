"use client";

import {
  containsWebAddress,
  GROUP_ORDER_MANUAL_NAME_MAX,
  GROUP_ORDER_MAX_QUANTITY,
  GROUP_ORDER_SIZE_LABEL_MAX,
  opinionNameKey,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { inputClass, primaryButtonClass } from "@/components/ui";
import type { FriendDevice } from "@/lib/friend-device";
import { parsePriceCents } from "@/lib/price";
import { addGroupLine, type GroupLineError, type GroupLineResult, patchGroupLine } from "@/lib/shared-list";
import { cleanName, clip, FriendNameStep, NameTakenQuestion, nameFits } from "./friend-name";

/** What the sheet is for: an item of the list, a link of the shop, or one of her lines. */
export type GroupLineTarget =
  | { kind: "item"; itemId: string; name: string }
  | { kind: "link" }
  | {
      kind: "edit";
      lineId: string;
      name: string;
      /** The name her lines are under (the device may know another one now). */
      buyerName: string;
      sizeLabel: string | null;
      quantity: number;
      /** A link read without a price: she types its name and price. */
      manual: { name: string; priceCents: number | null } | null;
    };

const QUANTITIES = Array.from({ length: GROUP_ORDER_MAX_QUANTITY }, (_, i) => i + 1);
const isHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value);

/** The words of a refusal (everything but `name_taken`, which asks « C'est toi ? »). */
export function groupErrorKey(
  error: GroupLineError,
): "locked" | "tooMany" | "notEligible" | "currency" | "rateLimited" | "failed" {
  switch (error) {
    case "locked":
      return "locked";
    case "too_many":
      return "tooMany";
    case "not_eligible":
      return "notEligible";
    case "currency":
      return "currency";
    case "rate_limited":
      return "rateLimited";
    default:
      return "failed";
  }
}

/**
 * « Je le prends aussi : {article} », « Ajouter un autre article » or « Modifier : {article} » (spec §3.2, §3.3):
 * size (free, optional), quantity (1 to 5), and her first name when this device does not know it yet.
 */
export function GroupLineSheet({
  open,
  onClose,
  token,
  target,
  shopName,
  currency,
  knownNames,
  device,
  onDone,
  onFailed,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  target: GroupLineTarget;
  shopName: string;
  currency: string;
  /** Names already used on the list, as written there (« Une Léa… »). */
  knownNames: readonly string[];
  device: FriendDevice;
  onDone: (outcome: { name: string; lineId: string }) => void;
  /** The page reads the list again: something changed (the order closed, the item gone). */
  onFailed: (error: GroupLineError) => void;
}) {
  const t = useTranslations("SharedList.groupOrder");
  const tGifts = useTranslations("SharedList.gifts");
  const tFriend = useTranslations("SharedList.friend");
  const titleId = useId();
  const nameId = useId();
  const sizeId = useId();
  const quantityId = useId();
  const linkId = useId();
  const manualNameId = useId();
  const manualPriceId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const manualNameInput = useRef<HTMLInputElement>(null);
  const manualPriceInput = useRef<HTMLInputElement>(null);
  const editing = target.kind === "edit";
  const [askName, setAskName] = useState(!editing && device.name === null);
  const [name, setName] = useState("");
  // Her own size (never the owner's): empty for a new line.
  const [size, setSize] = useState(target.kind === "edit" ? (target.sizeLabel ?? "") : "");
  const [quantity, setQuantity] = useState(target.kind === "edit" ? target.quantity : 1);
  const [link, setLink] = useState("");
  const [manualName, setManualName] = useState(target.kind === "edit" ? (target.manual?.name ?? "") : "");
  const [manualPrice, setManualPrice] = useState(
    target.kind === "edit" && target.manual?.priceCents != null
      ? (target.manual.priceCents / 100).toFixed(2).replace(".", ",")
      : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title =
    target.kind === "item"
      ? t("sheet.takeTitle", { name: target.name })
      : target.kind === "link"
        ? t("sheet.addTitle")
        : t("sheet.editTitle", { name: target.name });
  const action = target.kind === "item" ? t("take") : target.kind === "link" ? t("sheet.add") : t("sheet.save");

  const focus = (input: { current: HTMLInputElement | null }) => requestAnimationFrame(() => input.current?.focus());

  async function send(claim: boolean) {
    const chosen = editing ? target.buyerName : cleanName(askName ? name : (device.name ?? ""));
    if (!editing) {
      if (!nameFits(chosen)) {
        setError(tGifts("errors.name"));
        if (askName) focus(nameInput);
        return;
      }
      if (containsWebAddress(chosen)) return setError(tGifts("errors.webAddress"));
    }
    const url = link.trim();
    if (target.kind === "link" && !isHttpUrl(url)) {
      setError(t("errors.link"));
      focus(linkInput);
      return;
    }
    let manual: { manualName: string; manualPriceCents: number } | null = null;
    if (target.kind === "edit" && target.manual) {
      const typedName = manualName.trim();
      const price = parsePriceCents(manualPrice);
      if (typedName === "") {
        setError(t("errors.manualName"));
        focus(manualNameInput);
        return;
      }
      if (!price.ok || price.cents === undefined) {
        setError(t("errors.manualPrice"));
        focus(manualPriceInput);
        return;
      }
      manual = { manualName: typedName, manualPriceCents: price.cents };
    }
    setError(null);
    setBusy(true);
    const common = {
      sizeLabel: size.trim() === "" ? null : size.trim(),
      quantity,
      name: chosen,
      deviceKey: device.key,
    };
    let result: GroupLineResult;
    if (target.kind === "edit") result = await patchGroupLine(token, target.lineId, { ...common, ...manual });
    else
      result = await addGroupLine(token, {
        ...common,
        ...(target.kind === "item" ? { source: "item", itemId: target.itemId } : { source: "url", url }),
        ...(claim ? { claim: true } : {}),
      });
    setBusy(false);
    if (result.ok) {
      if (!editing) device.setName(chosen);
      onDone({ name: chosen, lineId: result.lineId });
      return;
    }
    if (result.error === "name_taken") {
      setTaken(knownNames.find((known) => opinionNameKey(known) === opinionNameKey(chosen)) ?? chosen);
      return;
    }
    if (result.error === "not_in_shop") {
      setError(t("errors.notInShop", { shop: result.shopName || shopName }));
      focus(linkInput);
      return;
    }
    setError(t(`errors.${groupErrorKey(result.error)}`));
    onFailed(result.error);
  }

  function notHer() {
    if (!taken) return;
    setName(`${taken} M.`);
    setAskName(true);
    setTaken(null);
    focus(nameInput);
  }

  function notMe() {
    setAskName(true);
    setName("");
    setError(null);
    focus(nameInput);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeLabel={tGifts("close")}
      hint={tGifts("closeHint")}
      footer={
        <div className="flex flex-col gap-space-2 border-t border-line p-space-4">
          {taken ? (
            <NameTakenQuestion
              id={`${titleId}-taken`}
              question={tFriend("nameTaken", { name: taken })}
              busy={busy}
              onItsMe={() => void send(true)}
              onNotHer={notHer}
            />
          ) : (
            <>
              <button
                type="submit"
                form={`${titleId}-form`}
                disabled={busy}
                aria-busy={busy || undefined}
                className={`${primaryButtonClass} min-h-touch-target w-full`}
              >
                {action}
              </button>
              <p className="text-center text-caption text-ink-muted">{t("sheet.note")}</p>
            </>
          )}
        </div>
      }
    >
      <h2 id={titleId} className="font-display text-lead font-strong break-words">
        {title}
      </h2>
      <form
        id={`${titleId}-form`}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
        className="flex flex-col gap-space-4"
      >
        {target.kind === "link" && (
          <div className="flex flex-col gap-space-1">
            <label htmlFor={linkId} className="text-sm text-ink-muted">
              {t("sheet.link", { shop: shopName })}
            </label>
            <input
              ref={linkInput}
              id={linkId}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              className={`${inputClass} min-h-touch-target`}
            />
          </div>
        )}
        {target.kind === "edit" && target.manual && (
          <>
            <div className="flex flex-col gap-space-1">
              <label htmlFor={manualNameId} className="text-sm text-ink-muted">
                {t("sheet.manualName")}
              </label>
              <input
                ref={manualNameInput}
                id={manualNameId}
                type="text"
                value={manualName}
                onChange={(event) => setManualName(clip(event.target.value, GROUP_ORDER_MANUAL_NAME_MAX))}
                className={`${inputClass} min-h-touch-target`}
              />
            </div>
            <div className="flex flex-col gap-space-1">
              <label htmlFor={manualPriceId} className="text-sm text-ink-muted">
                {t("sheet.manualPrice", { currency })}
              </label>
              <input
                ref={manualPriceInput}
                id={manualPriceId}
                type="text"
                inputMode="decimal"
                value={manualPrice}
                onChange={(event) => setManualPrice(event.target.value)}
                className={`${inputClass} min-h-touch-target tabular-nums`}
              />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-space-3">
          <div className="flex flex-col gap-space-1">
            <label htmlFor={sizeId} className="text-sm text-ink-muted">
              {t("sheet.size")}
            </label>
            <input
              id={sizeId}
              type="text"
              autoComplete="off"
              value={size}
              onChange={(event) => setSize(clip(event.target.value, GROUP_ORDER_SIZE_LABEL_MAX))}
              className={`${inputClass} min-h-touch-target`}
            />
          </div>
          <div className="flex flex-col gap-space-1">
            <label htmlFor={quantityId} className="text-sm text-ink-muted">
              {t("sheet.quantity")}
            </label>
            <select
              id={quantityId}
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              className={`${inputClass} min-h-touch-target tabular-nums`}
            >
              {QUANTITIES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!editing && (
          <FriendNameStep
            askName={askName}
            knownName={device.name}
            name={name}
            onNameChange={(value) => {
              setName(value);
              setTaken(null);
            }}
            onNotMe={notMe}
            inputId={nameId}
            inputRef={nameInput}
          />
        )}
        <p role="alert" className="text-sm font-strong text-danger empty:hidden">
          {error}
        </p>
      </form>
    </Sheet>
  );
}
