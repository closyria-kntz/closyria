"use client";

import { type ItemBulk, type ItemStage, itemStageSchema, type TagView, type WishlistView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useProfiles } from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { bulkItems, fetchTags, fetchWishlists, undoWith } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, primaryButtonClass } from "./ui";

type Choice = "stage" | "list" | "profile" | "tag";
const touch = "min-h-touch-target";

type Props = {
  ids: readonly string[];
  onClear: () => void;
  onSelectAll: () => void;
  /** These items left the view (stage, profile or trash changed). */
  onGone: (ids: readonly string[]) => void;
  /** Re-reads the view (after an undo). */
  reload: () => Promise<void>;
};

/** Actions on the selected items: stage, list, profile, tag, delete: all through `/items/bulk`, each with « Annuler ». */
export function SelectionBar({ ids, onClear, onSelectAll, onGone, reload }: Props) {
  const t = useTranslations("Views.selection");
  const tStage = useTranslations("Item.stage");
  const tErrors = useTranslations("Item.errors");
  const profiles = useProfiles();
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

  async function run(body: ItemBulk, label: (changed: number) => string, leaves: boolean) {
    setBusy(true);
    setError(null);
    const result = await bulkItems(body);
    setBusy(false);
    if (!result.ok) {
      setError(tErrors(result.error as "failed"));
      return;
    }
    setChoice(null);
    if (leaves) onGone(result.itemIds);
    onClear();
    pushUndo(label(result.itemIds.length), undoWith(result.undo, reload));
  }

  const count = ids.length;
  const list = [...ids];
  const stage = (target: ItemStage) =>
    run(
      { op: "stage", ids: list, stage: target, at: new Date().toISOString() },
      (n) => t("toast.stage", { count: n, stage: tStage(target) }),
      true,
    );

  return (
    <section
      aria-label={t("bar")}
      className="selection-bar-offset sticky z-20 flex flex-wrap items-center gap-space-2 rounded-card border border-line bg-surface-raised p-space-3 shadow-lifted"
    >
      <p role="status" className="mr-space-2 text-sm font-strong">
        {t("count", { count })}
      </p>
      {(["stage", "list", "profile", "tag"] as const).map((name) => (
        <button key={name} type="button" className={`${buttonClass} ${touch}`} onClick={() => setChoice(name)}>
          {t(name)}
        </button>
      ))}
      <button
        type="button"
        className={`${buttonClass} ${touch}`}
        disabled={busy}
        onClick={() => run({ op: "delete", ids: list }, (n) => t("toast.delete", { count: n }), true)}
      >
        {t("delete")}
      </button>
      <button type="button" className={`${buttonClass} ${touch}`} onClick={onSelectAll}>
        {t("all")}
      </button>
      <button type="button" className={`${buttonClass} ${touch}`} onClick={onClear}>
        {t("none")}
      </button>
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
        {choice === "stage" && (
          <ul className="flex flex-col gap-space-2">
            {itemStageSchema.options.map((target) => (
              <li key={target} className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
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
                      true,
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
                        false,
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
                    className={`${primaryButtonClass} ${touch} justify-start`}
                    onClick={() =>
                      run(
                        { op: "addTag", ids: list, tagId: tag.id },
                        (n) => t("toast.tag", { count: n || count, name: tag.name }),
                        false,
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
