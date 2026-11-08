"use client";

import type { ItemOpinions } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useLiveRefresh } from "@/lib/live-changes";
import { useLoveLevels } from "@/lib/profile-context";
import { fetchItemOpinions } from "@/lib/wardrobe-client";
import { FriendOpinions } from "./friend-opinions";

type Lists = ItemOpinions["lists"];

/**
 * « Avis des amies » on one of her items (spec §4.3): the opinions given on every shared list holding it, read-only.
 * The list's name shows (small, muted) only when several lists have opinions. Nothing at all while loading, when there
 * is no opinion, or when the load fails (a secondary section: no alert). Follows the changes stamp.
 */
export function ItemOpinionsSection({ itemId }: { itemId: string }) {
  const t = useTranslations("Lists.opinions");
  const levels = useLoveLevels();
  const titleId = useId();
  const [lists, setLists] = useState<Lists>([]);

  // Only the latest request may set state: a slow answer for a previous item (or an older refresh) is dropped.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const result = await fetchItemOpinions(itemId);
      // A failed refresh keeps what is shown; the first load failing leaves nothing.
      if (mine === latest.current && result.ok) setLists(result.lists);
    } catch {
      // Secondary section: stays quiet.
    }
  }, [itemId]);

  useEffect(() => {
    setLists([]);
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  if (lists.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2">
      <h3 id={titleId} className="text-sm font-strong">
        {t("listLabel")}
      </h3>
      {lists.map((list) => (
        <div key={list.wishlistId} className="flex flex-col gap-space-1">
          {lists.length > 1 && <p className="text-xs text-ink-muted">{list.wishlistName}</p>}
          <FriendOpinions opinions={list.opinions} levels={levels} />
        </div>
      ))}
    </section>
  );
}
