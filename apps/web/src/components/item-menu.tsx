"use client";

import {
  type ItemStage,
  type ItemView,
  type LoveLevel,
  MAX_WHY,
  type TagView,
  type WishlistView,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { StageDialog } from "@/app/(app)/produits/[id]/stage-dialog";
import { levelOf, MENU_STAGES } from "@/lib/love-levels";
import { useLoveLevels, useProfiles } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { bulkItems, fetchTags, fetchWishlists, moveItem, patchItem, trashItem, undoWith } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, focusRing, inputClass, primaryButtonClass } from "./ui";

type Choice = "why" | "list" | "profile" | "tags";
const touch = "min-h-touch-target";
const entryClass = `flex ${touch} w-full items-center gap-space-2 rounded-button px-space-3 text-left text-sm text-ink hover:bg-surface-strong disabled:opacity-60 ${focusRing}`;
const levelClass = `flex ${touch} items-center justify-center gap-space-1 rounded-button border border-line px-space-2 text-sm text-ink hover:bg-surface-strong aria-pressed:border-accent aria-pressed:bg-surface-strong aria-pressed:font-strong ${focusRing}`;

type Props = {
  item: ItemView;
  /** The API returned the item changed (level, priority, opinion, stage, profile, lists, tags). */
  onChanged: (item: ItemView) => void;
  /** The item went to the trash. */
  onTrashed: (id: string) => void;
  /** Re-reads what changed (after « Annuler »). */
  reload: () => Promise<void>;
};

/**
 * The « … » of a card (spec §3.3): a sheet from the bottom on a phone, a small menu from a tablet up. Levels,
 * « Prioritaire », « Mon avis », stage, list, profile, tags, trash; each action with its « … · Annuler ».
 */
export function ItemMenu({ item, onChanged, onTrashed, reload }: Props) {
  const t = useTranslations("Views.menu");
  const tItem = useTranslations("Item");
  const levels = useLoveLevels();
  const profiles = useProfiles();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [stage, setStage] = useState<ItemStage | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const name = item.name?.trim() || item.product.name || "";
  const fail = (code: string) => pushUndo(tItem(`errors.${code}` as "errors.failed"), null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  // Open: the focus goes to the first entry; Escape closes and gives it back to « … ».
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  /** Runs an action from the panel: the panel closes, the focus goes back to « … ». */
  async function act(action: () => Promise<void>) {
    close(true);
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  /** Opens a dialog from the panel; « … » holds the focus first so the dialog gives it back there. */
  const openChoice = (next: Choice) => {
    close(true);
    setChoice(next);
  };

  const setLevel = (level: LoveLevel) =>
    act(async () => {
      const cleared = item.loveLevel === level;
      const result = await patchItem(item.id, { loveLevel: cleared ? null : level });
      if (!result.ok) return fail(result.error);
      onChanged(result.item);
      pushUndo(
        cleared ? t("toast.levelCleared") : t("toast.level", { label: levelOf(levels, level).label }),
        undoWith(result.undo, reload),
      );
    });

  const togglePriority = () =>
    act(async () => {
      const result = await patchItem(item.id, { priority: !item.priority });
      if (!result.ok) return fail(result.error);
      onChanged(result.item);
      pushUndo(t(item.priority ? "toast.priorityOff" : "toast.priorityOn"), undoWith(result.undo, reload));
    });

  const trash = () =>
    act(async () => {
      const result = await trashItem(item.id);
      if (!result.ok) return fail(result.error);
      onTrashed(item.id);
      pushUndo(tItem(item.stage === "spotted" ? "toast.wishRemoved" : "toast.deleted"), undoWith(result.undo, reload));
    });

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("open")}
        aria-expanded={open}
        aria-controls={panelId}
        aria-busy={busy || undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
        className={`absolute top-space-0 right-space-0 z-10 flex min-h-touch-target min-w-touch-target items-center justify-center rounded-card p-space-2 ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className="flex size-space-6 items-center justify-center rounded-full bg-surface-raised/85 text-sm font-strong text-ink shadow-soft"
        >
          …
        </span>
      </button>

      {open && (
        <>
          {/* A tap outside closes; Escape is the keyboard way. */}
          <div
            aria-hidden="true"
            onClick={() => close(false)}
            className="fixed inset-space-0 z-30 bg-ink/40 md:bg-transparent"
          />
          <section
            ref={panel}
            id={panelId}
            aria-label={t("panel", { name })}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && !panel.current?.contains(next) && next !== button.current) close(false);
            }}
            className="fixed inset-x-space-0 bottom-space-0 z-30 flex max-h-dvh flex-col gap-space-3 overflow-y-auto rounded-t-card border border-line bg-surface-raised p-space-4 pb-space-6 shadow-lifted md:absolute md:top-touch-target md:bottom-auto md:max-h-none md:rounded-card md:p-space-2"
          >
            <fieldset className="flex flex-col gap-space-2">
              <legend className="px-space-1 pb-space-2 text-sm font-strong">{t("levels")}</legend>
              <div className="grid grid-cols-2 gap-space-2 lg:grid-cols-1">
                {levels.map((level) => (
                  <button
                    key={level.level}
                    type="button"
                    aria-pressed={item.loveLevel === level.level}
                    onClick={() => void setLevel(level.level)}
                    className={levelClass}
                  >
                    <span aria-hidden="true">{level.emoji}</span>
                    <span className="min-w-space-0 truncate">{level.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <ul className="flex flex-col border-t border-line pt-space-2">
              <Entry onClick={() => void togglePriority()}>{t(item.priority ? "priorityOff" : "priorityOn")}</Entry>
              <Entry onClick={() => openChoice("why")}>{t("why")}</Entry>
              {MENU_STAGES[item.stage].map((target) => (
                <Entry
                  key={target}
                  onClick={() => {
                    close(true);
                    setStage(target);
                  }}
                >
                  {t(`toStage.${target}`)}
                </Entry>
              ))}
              <Entry onClick={() => openChoice("list")}>{t("list")}</Entry>
              {profiles.length > 1 && <Entry onClick={() => openChoice("profile")}>{t("profile")}</Entry>}
              <Entry onClick={() => openChoice("tags")}>{t("tags")}</Entry>
              <Entry danger onClick={() => void trash()}>
                {t(item.stage === "spotted" ? "removeWish" : "delete")}
              </Entry>
            </ul>
          </section>
        </>
      )}

      <StageDialog item={item} stage={stage} onClose={() => setStage(null)} onDone={onChanged} reload={reload} />
      <Dialog
        open={choice !== null}
        onClose={() => setChoice(null)}
        title={choice ? t(choice === "why" ? "whyTitle" : choice) : ""}
        closeLabel={t("close")}
      >
        {choice === "why" && <WhyForm item={item} onDone={onChanged} onClose={() => setChoice(null)} reload={reload} />}
        {(choice === "list" || choice === "tags" || choice === "profile") && (
          <Choices choice={choice} item={item} onChanged={onChanged} onClose={() => setChoice(null)} reload={reload} />
        )}
      </Dialog>
    </>
  );
}

function Entry({ onClick, danger = false, children }: { onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <li className="flex flex-col">
      <button type="button" onClick={onClick} className={`${entryClass} ${danger ? "text-danger" : ""}`}>
        {children}
      </button>
    </li>
  );
}

/** « Mon avis »: her short « Pourquoi ? », shown on the card. */
function WhyForm({
  item,
  onDone,
  onClose,
  reload,
}: {
  item: ItemView;
  onDone: (item: ItemView) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Views.menu");
  const tItem = useTranslations("Item");
  const [why, setWhy] = useState(item.why ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const hintId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await patchItem(item.id, { why: why.trim() || null });
    setBusy(false);
    if (!result.ok) return setError(tItem(`errors.${result.error}` as "errors.failed"));
    onDone(result.item);
    onClose();
    pushUndo(t("toast.why"), undoWith(result.undo, reload));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-space-3">
      <label htmlFor={fieldId} className="text-sm font-strong">
        {t("whyLabel")}
      </label>
      <textarea
        id={fieldId}
        rows={3}
        maxLength={MAX_WHY}
        value={why}
        aria-describedby={hintId}
        onChange={(event) => setWhy(event.target.value)}
        className={inputClass}
      />
      <p id={hintId} className="text-sm text-ink-muted">
        {t("whyHint")}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
        {t("whySave")}
      </button>
    </form>
  );
}

/** Lists and tags (each a toggle), or the profile to move to. */
function Choices({
  choice,
  item,
  onChanged,
  onClose,
  reload,
}: {
  choice: "list" | "tags" | "profile";
  item: ItemView;
  onChanged: (item: ItemView) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const t = useTranslations("Views.menu");
  const tItem = useTranslations("Item");
  const profiles = useProfiles();
  const [lists, setLists] = useState<WishlistView[] | null>(null);
  const [tags, setTags] = useState<TagView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (choice === "profile") return;
    let alive = true;
    const load = choice === "list" ? fetchWishlists().then(setLists) : fetchTags().then(setTags);
    load.catch(() => alive && setError(t("loadFailed")));
    return () => {
      alive = false;
    };
  }, [choice, t]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }
  const fail = (code: string) => setError(tItem(`errors.${code}` as "errors.failed"));

  const toggleList = (list: WishlistView) =>
    run(async () => {
      const inside = item.wishlistIds.includes(list.id);
      const result = await bulkItems({
        op: inside ? "removeFromList" : "addToList",
        ids: [item.id],
        wishlistId: list.id,
      });
      if (!result.ok) return fail(result.error);
      onChanged({
        ...item,
        wishlistIds: inside ? item.wishlistIds.filter((id) => id !== list.id) : [...item.wishlistIds, list.id],
      });
      pushUndo(
        tItem(inside ? "toast.listRemoved" : "toast.listAdded", { name: list.name }),
        undoWith(result.undo, reload),
      );
    });

  const toggleTag = (tag: TagView) =>
    run(async () => {
      const inside = item.tags.some((x) => x.id === tag.id);
      const result = await bulkItems({ op: inside ? "removeTag" : "addTag", ids: [item.id], tagId: tag.id });
      if (!result.ok) return fail(result.error);
      onChanged({ ...item, tags: inside ? item.tags.filter((x) => x.id !== tag.id) : [...item.tags, tag] });
      pushUndo(
        tItem(inside ? "toast.tagRemoved" : "toast.tagAdded", { name: tag.name }),
        undoWith(result.undo, reload),
      );
    });

  const move = (profileId: string, profileName: string) =>
    run(async () => {
      const result = await moveItem(item.id, profileId);
      if (!result.ok) return fail(result.error);
      onClose();
      onChanged(result.item);
      pushUndo(tItem("toast.moved", { name: profileName }), undoWith(result.undo, reload));
    });

  const pressable = `${buttonClass} ${touch} justify-start aria-pressed:bg-surface-strong aria-pressed:font-strong`;
  const others = profiles.filter((profile) => profile.id !== item.profileId);

  return (
    <div className="flex flex-col gap-space-3" aria-busy={busy || undefined}>
      {choice === "profile" &&
        (others.length === 0 ? (
          <p className="text-ink-muted">{t("noProfiles")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {others.map((profile) => (
              <li key={profile.id} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  className={pressable}
                  onClick={() => move(profile.id, profile.name)}
                >
                  {profile.name}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {choice === "list" &&
        (lists === null ? (
          error ? null : (
            <p role="status">{t("loading")}</p>
          )
        ) : lists.length === 0 ? (
          <p className="text-ink-muted">{t("noLists")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {lists.map((list) => (
              <li key={list.id} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={item.wishlistIds.includes(list.id)}
                  className={pressable}
                  onClick={() => toggleList(list)}
                >
                  {list.name}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {choice === "tags" &&
        (tags === null ? (
          error ? null : (
            <p role="status">{t("loading")}</p>
          )
        ) : tags.length === 0 ? (
          <p className="text-ink-muted">{t("noTags")}</p>
        ) : (
          <ul className="flex flex-col gap-space-2">
            {tags.map((tag) => (
              <li key={tag.id} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={item.tags.some((x) => x.id === tag.id)}
                  className={pressable}
                  onClick={() => toggleTag(tag)}
                >
                  {tag.name}
                </button>
              </li>
            ))}
          </ul>
        ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
