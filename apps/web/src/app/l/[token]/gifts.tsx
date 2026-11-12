"use client";

import {
  containsWebAddress,
  type GiftIntent,
  type GiftRole,
  opinionNameKey,
  type SharedGiftState,
  type SharedGifts,
} from "@closyria/shared";
import { useLocale, useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { blockTitleClass, cardPrimaryClass, cardSoftClass, focusRing, primaryButtonClass } from "@/components/ui";
import type { FriendDevice } from "@/lib/friend-device";
import { type GiftError, giveGift } from "@/lib/shared-list";
import { cleanName, FriendNameStep, NameTakenQuestion, nameFits } from "./friend-name";

/** « 12 mars »: the day of her occasion (a calendar date, read in UTC so it never shifts a day). */
export function occasionDay(locale: string, date: string): string {
  // A no-break space: « 12 mars » never splits over two lines.
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`))
    .replace(/ /g, "\u00a0");
}

/** « Léa et Inès », « Léa, Inès et Zoé ». */
export const namesOf = (locale: string, names: readonly string[]) =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format(names);

/**
 * « Pour {occasion} de {prénom}, le {date} 🎁 » and its variants (spec §3): without an occasion the date alone,
 * without a date the occasion alone, neither: « Tu peux offrir un article de cette liste 🎁 ». Her name only when
 * she shows it.
 */
export function GiftBanner({
  gifts,
  ownerName,
  viewerIsOwner,
}: {
  gifts: SharedGifts;
  ownerName: string | null;
  /** Her own link: no word about the surprise (she must not see who gives). */
  viewerIsOwner: boolean;
}) {
  const t = useTranslations("SharedList.gifts");
  const locale = useLocale();
  if (!gifts.open) return null;
  const occasion = gifts.occasion?.trim() || null;
  const date = gifts.date ? occasionDay(locale, gifts.date) : null;
  const name = ownerName;
  let text: string;
  if (occasion && date)
    text = name ? t("occasionDateName", { occasion, name, date }) : t("occasionDate", { occasion, date });
  else if (occasion) text = name ? t("occasionName", { occasion, name }) : t("occasion", { occasion });
  else if (date) text = name ? t("dateName", { name, date }) : t("date", { date });
  else text = t("none");
  // Boudoir's powder-pink box (mockup .gift): the occasion as its kicker, then that it stays a surprise.
  return (
    <div className="flex flex-col gap-space-1-5 rounded-card bg-une p-space-3-5 text-ink">
      <p data-testid="gift-banner" className={`${blockTitleClass} text-une-ink break-words`}>
        {text}
      </p>
      {!viewerIsOwner && <p className="text-sm">{name ? t("surprise", { name }) : t("surpriseHidden")}</p>}
    </div>
  );
}

const linkButtonClass = `hit-area relative rounded-button text-chip font-bold underline underline-offset-2 disabled:opacity-60 ${focusRing}`;
const actionButtonClass = `${primaryButtonClass} min-h-touch-target w-full`;

/**
 * Who gives a reserved item, for the ochre tag on its photo (mockup .tag « Réservé par Inès »): « Réservé par
 * {prénom} », or « Offert par {prénoms} » once others joined. Null otherwise (the other states are said in the card).
 */
export function giftTagOf(
  gift: SharedGiftState | null,
  locale: string,
  t: (key: "reservedBy" | "givenBy", values: Record<string, string>) => string,
): string | null {
  if (gift?.state !== "reserved") return null;
  return gift.contributors.length === 0
    ? t("reservedBy", { name: gift.reserver })
    : t("givenBy", { names: namesOf(locale, [gift.reserver, ...gift.contributors]) });
}

/**
 * The gift part of an item on the link (spec §3): her size, who gives it (never seen by the owner), and « Je lui
 * offre » / « Je participe » / « Me retirer » as fits. Nothing when the list is closed to gifts (`gift` null).
 */
export function GiftActions({
  itemName,
  gift,
  size,
  ownerName,
  blockId,
  checked,
  busy,
  onGive,
  onLeave,
}: {
  itemName: string;
  gift: SharedGiftState | null;
  size: string | null;
  ownerName: string | null;
  /** Where the page puts the focus back after a gift changes (her next step is in it). */
  blockId: string;
  /**
   * Whether the page read the list with her device key: until then it cannot tell her gifts from the others', so
   * every button waits (`pending`); `failed` says so instead of showing a state that may be wrong.
   */
  checked: "pending" | "ok" | "failed";
  busy: boolean;
  onGive: (intent: GiftIntent) => void;
  onLeave: () => void;
}) {
  const t = useTranslations("SharedList.gifts");
  if (!gift) return null;
  const hidden = ownerName === null;
  // `hidden`: the server's paint, before the browser's re-read says what is what.
  const mine = "mine" in gift ? (gift.mine?.role ?? null) : null;
  const disabled = busy || checked !== "ok";
  // Who reserved it is on the photo's tag (giftTagOf); the other states are said here.
  let who: string | null = null;
  if (gift.state === "owner_took") who = hidden ? t("ownerTookHidden") : t("ownerTook", { name: ownerName });
  else if (gift.state === "removed") who = hidden ? t("removedHidden") : t("removed", { name: ownerName });

  const mineLabel =
    mine === "reserver"
      ? t(hidden ? "mineReserverHidden" : "mineReserver")
      : mine === "contributor"
        ? t("mineContributor")
        : null;
  const forItem = <span className="sr-only"> {t("forItem", { name: itemName })}</span>;

  return (
    <div
      id={blockId}
      tabIndex={-1}
      aria-busy={checked === "pending" || undefined}
      className={`flex flex-col gap-space-1-5 rounded-md ${focusRing}`}
    >
      <div
        data-testid="gift"
        className={`flex flex-col gap-space-0-5 rounded-md px-space-2-5 py-space-1-5 text-chip ${
          mine ? "bg-une" : "bg-surface-sunken"
        }`}
      >
        {gift.state !== "removed" && <p className="text-ink-muted">{size ? t("size", { size }) : t("noSize")}</p>}
        {who && <p className="font-bold break-words">{who}</p>}
        {mineLabel && (
          <p className="flex flex-wrap items-center justify-between gap-x-space-3 gap-y-space-1">
            <span className="font-bold text-une-ink">{mineLabel}</span>
            <button type="button" disabled={disabled} onClick={onLeave} className={linkButtonClass}>
              {t("leave")}
              {forItem}
            </button>
          </p>
        )}
      </div>
      {gift.state === "free" && (
        <button type="button" disabled={disabled} onClick={() => onGive("reserve")} className={cardPrimaryClass}>
          {t(hidden ? "giveHidden" : "give")}
          {forItem}
        </button>
      )}
      {gift.state === "reserved" && !mine && (
        <button type="button" disabled={disabled} onClick={() => onGive("join")} className={cardSoftClass}>
          {t("join")}
          {forItem}
        </button>
      )}
      {checked === "failed" && <p className="text-chip text-danger">{t("errors.unchecked")}</p>}
    </div>
  );
}

const errorKey: Record<
  GiftError,
  "webAddress" | "rateLimited" | "closed" | "ownerTook" | "gone" | "noGift" | "failed"
> = {
  web_address: "webAddress",
  rate_limited: "rateLimited",
  gifts_closed: "closed",
  owner_took: "ownerTook",
  not_found: "gone",
  name_taken: "failed",
  forbidden: "failed",
  no_gift: "noGift",
  failed: "failed",
};

/**
 * « Je lui offre : {article} » / « Je participe : {article} »: her first name (asked once per device, the same as for
 * the opinions), then the confirmation. When another friend reserved just before, it says so and offers « Je
 * participe » instead.
 */
export function GiftSheet({
  open,
  onClose,
  token,
  item,
  intent: initialIntent,
  ownerName,
  knownNames,
  device,
  onDone,
  onFailed,
}: {
  open: boolean;
  onClose: () => void;
  token: string;
  item: { itemId: string; name: string };
  intent: GiftIntent;
  ownerName: string | null;
  /** Names already used on the list, as written there (« Une Léa… »). */
  knownNames: readonly string[];
  device: FriendDevice;
  onDone: (outcome: { name: string; role: GiftRole }) => void;
  /** The page reads the list again: something changed (a race, the list closed, the item gone). */
  onFailed: (error: GiftError | "already_reserved") => void;
}) {
  const t = useTranslations("SharedList.gifts");
  const tFriend = useTranslations("SharedList.friend");
  const titleId = useId();
  const nameId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [intent, setIntent] = useState(initialIntent);
  const [askName, setAskName] = useState(device.name === null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // « Inès vient de le réserver »: news, not a mistake.
  const [isNews, setIsNews] = useState(false);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hidden = ownerName === null;
  const action = intent === "join" ? t("join") : t(hidden ? "giveHidden" : "give");

  function focusName() {
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  async function send(claim: boolean) {
    const chosen = cleanName(askName ? name : (device.name ?? ""));
    if (!nameFits(chosen)) {
      setError(t("errors.name"));
      if (askName) focusName();
      return;
    }
    if (containsWebAddress(chosen)) return setError(t("errors.webAddress"));
    setError(null);
    setIsNews(false);
    setBusy(true);
    const result = await giveGift(token, item.itemId, {
      name: chosen,
      deviceKey: device.key,
      intent,
      ...(claim ? { claim: true } : {}),
    });
    setBusy(false);
    if (result.ok) {
      device.setName(chosen);
      onDone({ name: chosen, role: result.role });
      return;
    }
    if (result.error === "already_reserved") {
      setTaken(null);
      setIntent("join");
      setError(t("justReserved", { name: result.reserver }));
      setIsNews(true);
      onFailed("already_reserved");
      return;
    }
    if (result.error === "name_taken") {
      setTaken(knownNames.find((known) => opinionNameKey(known) === opinionNameKey(chosen)) ?? chosen);
      return;
    }
    setError(t(`errors.${errorKey[result.error]}`));
    onFailed(result.error);
  }

  function notHer() {
    if (!taken) return;
    setName(`${taken} M.`);
    setAskName(true);
    setTaken(null);
    focusName();
  }

  function notMe() {
    setAskName(true);
    setName("");
    setError(null);
    setIsNews(false);
    focusName();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      closeLabel={t("close")}
      hint={t("closeHint")}
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
                className={actionButtonClass}
              >
                {action}
              </button>
              <p className="text-center text-caption text-ink-muted">
                {hidden ? t("visibleHidden") : t("visible", { name: ownerName })}
              </p>
            </>
          )}
        </div>
      }
    >
      <h2 id={titleId} className="font-title text-heading break-words">
        {t("sheetTitle", { action, name: item.name })}
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
        <p role="alert" className={`text-sm font-strong empty:hidden ${isNews ? "text-ink" : "text-danger"}`}>
          {error}
        </p>
      </form>
    </Sheet>
  );
}
