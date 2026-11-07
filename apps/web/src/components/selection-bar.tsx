"use client";

import {
  type ItemBulk,
  type ItemStage,
  itemStageSchema,
  type LoveLevel,
  type TagView,
  type WishlistView,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { levelOf } from "@/lib/love-levels";
import { useLoveLevels, useProfiles } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { bulkItems, fetchTags, fetchWishlists, undoWith } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass } from "./ui";

type Choice = "level" | "priority" | "stage" | "list" | "profile" | "tag";
/** What the view does once an action is done: the items left it, stay as they are, or may have changed place. */
type After = "leave" | "stay" | "reload";
/** Highest first, as in the menu of a card. */
const LEVELS: readonly LoveLevel[] = [4, 3, 2, 1];
const touch = "min-h-touch-target";
const action = `${buttonClass} ${touch} shrink-0 whitespace-nowrap`;

type Props = {
  /** The stage this view shows: moving to it would change nothing. */
  currentStage: ItemStage;
  ids: readonly string[];
  onClear: () => void;
  onSelectAll: () => void;
  /** These items left the view (stage, profile or trash changed). */
  onGone: (ids: readonly string[]) => void;
  /** Re-reads the view (after an undo, or a level or priority that may change the filters and the order). */
  reload: () => Promise<void>;
};

/**
 * Actions on the selected items (spec §3.4): level, priority, stage, list, profile, tag, delete: all through
 * `/items/bulk`, each with « Annuler ».
 */
export function SelectionBar({ currentStage, ids, onClear, onSelectAll, onGone, reload }: Props) {
  const t = useTranslations("Views.selection");
  const tStage = useTranslations("Item.stage");
  const tErrors = useTranslations("Item.errors");
  const profiles = useProfiles();
  const levels = useLoveLevels();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [lists, setLists] = useState<WishlistView[] | null>(null);
  const [tags, setTags] = useState<TagView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (choice !== "list" && choice !== "tag") return;
    let alive = true;
    setError(null);
    const load = choice === "list" ? fetchWishlists().then(setLists) : fetchTags().then(setTags);
    load.catch(() => alive && setError(t("choiceFailed")));
    return () => {
      alive = false;
    };
  }, [choice, t]);

  async function run(body: ItemBulk, label: (changed: number) => string, after: After) {
    setBusy(true);
    setError(null);
    const result = await bulkItems(body);
    setBusy(false);
    if (!result.ok) {
      setError(tErrors(result.error as "failed"));
      return;
    }
    setChoice(null);
    if (after === "leave") onGone(result.itemIds);
    onClear();
    if (after === "reload") void reload();
    pushUndo(label(result.itemIds.length), undoWith(result.undo, reload));
  }

  const count = ids.length;
  const list = [...ids];
  const stage = (target: ItemStage) =>
    run(
      { op: "stage", ids: list, stage: target, at: new Date().toISOString() },
      (n) => t("toast.stage", { count: n, stage: tStage(target) }),
      "leave",
    );
  const setLevel = (level: LoveLevel | null) =>
    run(
      { op: "setFields", ids: list, fields: { loveLevel: level } },
      (n) =>
        level === null
          ? t("toast.levelCleared", { count: n })
          : t("toast.level", { count: n, label: levelOf(levels, level).label }),
      "reload",
    );
  const setPriority = (priority: boolean) =>
    run(
      { op: "setFields", ids: list, fields: { priority } },
      (n) => t(priority ? "toast.priorityOn" : "toast.priorityOff", { count: n }),
      "reload",
    );

  return (
    <section
      aria-label={t("bar")}
      className="selection-bar-offset sticky z-20 flex flex-col gap-space-2 rounded-card border border-line bg-surface-raised p-space-3 shadow-lifted md:flex-row md:flex-wrap md:items-center"
    >
      <p role="status" className="mr-space-2 text-sm font-strong">
        {t("count", { count })}
      </p>
      {/* One row that scrolls sideways on a phone (the bar stays short above the toast), wrapped from a tablet up. */}
      <div className="flex gap-space-2 overflow-x-auto pb-space-1 md:flex-wrap md:overflow-visible md:pb-space-0">
        {(["level", "priority", "stage", "list", "profile", "tag"] as const).map((name) => (
          <button key={name} type="button" className={action} onClick={() => setChoice(name)}>
            {t(name)}
          </button>
        ))}
        <button
          type="button"
          className={action}
          disabled={busy}
          onClick={() => run({ op: "delete", ids: list }, (n) => t("toast.delete", { count: n }), "leave")}
        >
          {t("delete")}
        </button>
        <button type="button" className={action} onClick={onSelectAll}>
          {t("all")}
        </button>
        <button type="button" className={action} onClick={onClear}>
          {t("none")}
        </button>
      </div>
      {error && choice === null && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}

      <Dialog
        open={choice !== null}
        onClose={() => setChoice(null)}
        title={choice ? t(`${choice}Title`) : ""}
        closeLabel={t("close")}
      >
        {choice === "level" && (
          <ul className="flex flex-col gap-space-2">
            {LEVELS.map((level) => {
              const { emoji, label } = levelOf(levels, level);
              return (
                <li key={level} className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${buttonClass} ${touch} justify-start gap-space-2`}
                    onClick={() => setLevel(level)}
                  >
                    <span aria-hidden="true">{emoji}</span>
                    {label}
                  </button>
                </li>
              );
            })}
            <li className="flex flex-col">
              <button
                type="button"
                disabled={busy}
                className={`${buttonClass} ${touch} justify-start`}
                onClick={() => setLevel(null)}
              >
                {t("levelNone")}
              </button>
            </li>
          </ul>
        )}
        {choice === "priority" && (
          <ul className="flex flex-col gap-space-2">
            {([true, false] as const).map((value) => (
              <li key={String(value)} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  className={`${buttonClass} ${touch} justify-start`}
                  onClick={() => setPriority(value)}
                >
                  {t(value ? "priorityOn" : "priorityOff")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {choice === "stage" && (
          <ul className="flex flex-col gap-space-2">
            {itemStageSchema.options.map((target) => (
              <li key={target} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy || target === currentStage}
                  className={`${buttonClass} ${touch} justify-start`}
                  onClick={() => stage(target)}
                >
                  {tStage(target)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {choice === "profile" && (
          <ul className="flex flex-col gap-space-2">
            {profiles.map((profile) => (
              <li key={profile.id} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  className={`${buttonClass} ${touch} justify-start`}
                  onClick={() =>
                    run(
                      { op: "move", ids: list, profileId: profile.id },
                      (n) => t("toast.profile", { count: n, name: profile.name }),
                      "leave",
                    )
                  }
                >
                  {profile.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {choice === "list" &&
          (lists === null ? (
            error ? null : (
              <p role="status">{t("loading")}</p>
            )
          ) : lists.length === 0 ? (
            <p className="text-ink-muted">{t("noLists")}</p>
          ) : (
            <ul className="flex flex-col gap-space-2">
              {lists.map((wishlist) => (
                <li key={wishlist.id} className="flex flex-col">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${buttonClass} ${touch} justify-start`}
                    onClick={() =>
                      run(
                        { op: "addToList", ids: list, wishlistId: wishlist.id },
                        (n) => t("toast.list", { count: n || count, name: wishlist.name }),
                        "stay",
                      )
                    }
                  >
                    {wishlist.name}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        {choice === "tag" &&
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
                    className={`${buttonClass} ${touch} justify-start`}
                    onClick={() =>
                      run(
                        { op: "addTag", ids: list, tagId: tag.id },
                        (n) => t("toast.tag", { count: n || count, name: tag.name }),
                        "stay",
                      )
                    }
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
      </Dialog>
    </section>
  );
}
