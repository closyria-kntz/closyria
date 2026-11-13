"use client";

import {
  MAX_PROFILE_SIZE,
  MAX_PROFILE_SIZES,
  type ProfileSizes,
  type ProfileView,
  SIZE_SUGGESTIONS,
  type SizeKind,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, type KeyboardEvent, useContext, useId, useState } from "react";
import {
  ProfilesContext,
  profileLabel,
  useCurrentProfile,
  useProfiles,
  useProfilesReady,
  useRefreshProfiles,
} from "@/lib/profile-context";
import { pushUndo } from "@/lib/undo";
import { patchProfile } from "@/lib/wardrobe-client";
import { ChipCheck, chipClass } from "./filters-bar";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

const KINDS = [
  { kind: "top", field: "sizesTop" },
  { kind: "bottom", field: "sizesBottom" },
  { kind: "shoes", field: "sizesShoes" },
] as const satisfies readonly { kind: SizeKind; field: keyof ProfileSizes }[];

type Draft = Record<SizeKind, string[]>;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A saved size as the chip that shows it: the suggestion it is (« m » is « M »), else itself. */
const asChip = (kind: SizeKind, size: string) => SIZE_SUGGESTIONS[kind].find((s) => same(s, size)) ?? size.trim();

function draftOf(profile: ProfileView): Draft {
  return {
    top: profile.sizesTop.map((size) => asChip("top", size)),
    bottom: profile.sizesBottom.map((size) => asChip("bottom", size)),
    shoes: profile.sizesShoes.map((size) => asChip("shoes", size)),
  };
}

/** One kind of « Mes tailles »: the suggested sizes and hers as chips to tick, and « Une autre taille… ». */
function KindChips({
  kind,
  label,
  selected,
  onChange,
}: {
  kind: SizeKind;
  label: string;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("Settings");
  const base = useId();
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState("");
  const full = selected.length >= MAX_PROFILE_SIZES;
  // Her own sizes (not suggested) are chips too, after the suggestions, while they are ticked.
  const chips = [...SIZE_SUGGESTIONS[kind], ...selected.filter((size) => !SIZE_SUGGESTIONS[kind].includes(size))];

  const toggle = (size: string) =>
    onChange(selected.includes(size) ? selected.filter((s) => s !== size) : [...selected, size]);

  const add = () => {
    const size = asChip(kind, other);
    if (size === "") return;
    if (!selected.some((s) => same(s, size)) && !full) onChange([...selected, size]);
    setOther("");
    setAdding(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    } else if (event.key === "Escape") {
      setAdding(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-space-2" aria-describedby={full ? `${base}-full` : undefined}>
      <legend className="mb-space-2 text-sm font-strong">{label}</legend>
      <div className="flex flex-wrap gap-x-space-2 gap-y-space-2-5 sm:gap-space-2-5">
        {chips.map((size) => {
          const on = selected.includes(size);
          return (
            <button
              key={size}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(size)}
              className={`${chipClass} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-strong`}
            >
              {on && <ChipCheck />}
              {size}
            </button>
          );
        })}
        <button
          type="button"
          aria-expanded={adding}
          aria-controls={`${base}-other`}
          disabled={full}
          onClick={() => setAdding((open) => !open)}
          className={`${chipClass} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-strong`}
        >
          {t("sizes.other")}
        </button>
      </div>
      <div id={`${base}-other`} hidden={!adding} className="flex flex-wrap items-center gap-space-2">
        {adding && (
          <>
            <input
              aria-label={t("sizes.otherLabel", { kind: label })}
              value={other}
              maxLength={MAX_PROFILE_SIZE}
              // biome-ignore lint/a11y/noAutofocus: opened on purpose by « Une autre taille… », to type at once.
              autoFocus
              onChange={(event) => setOther(event.target.value)}
              onKeyDown={onKeyDown}
              className={`${inputClass} ${touch} min-w-space-0 flex-1`}
            />
            <button type="button" onClick={add} className={`${buttonClass} ${touch}`}>
              {t("sizes.add")}
            </button>
          </>
        )}
      </div>
      {full && (
        <p id={`${base}-full`} className="text-sm text-ink-muted">
          {t("sizes.full", { max: MAX_PROFILE_SIZES })}
        </p>
      )}
    </fieldset>
  );
}

function SizesForm({ profile, name }: { profile: ProfileView; name: string }) {
  const t = useTranslations("Settings");
  const refresh = useRefreshProfiles();
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    // Every kind is sent: an emptied one is an empty list.
    const result = await patchProfile(profile.id, {
      sizesTop: draft.top,
      sizesBottom: draft.bottom,
      sizesShoes: draft.shoes,
    });
    setBusy(false);
    setFailed(!result.ok);
    if (!result.ok) return;
    await refresh();
    pushUndo(t("sizes.saved"), null);
  }

  return (
    <form onSubmit={submit} aria-label={t("sizes.forProfile", { name })} className="flex flex-col gap-space-5">
      {KINDS.map(({ kind }) => (
        <KindChips
          key={kind}
          kind={kind}
          label={t(`sizes.${kind}`)}
          selected={draft[kind]}
          onChange={(next) => setDraft((current) => ({ ...current, [kind]: next }))}
        />
      ))}
      <div className="flex flex-col gap-space-2">
        {failed && <p role="alert">{t("failed")}</p>}
        <div className="flex">
          <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
            {t("sizes.save")}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * « Mes tailles » (catalogue « Découvrir », spec §3.3): hauts, bas and chaussures of the chosen profile, several of
 * each (up to 8), each kind optional, ticked among the suggested sizes or typed (« Une autre taille… »). They are what
 * « Ma taille en stock » compares.
 */
export function SizesSettings() {
  const t = useTranslations("Settings");
  const ready = useProfilesReady();
  const profiles = useProfiles();
  const { profile } = useCurrentProfile();
  const firstName = useContext(ProfilesContext).account?.firstName ?? null;
  const name = profile
    ? profileLabel(
        profile,
        profiles.findIndex((p) => p.id === profile.id),
        firstName,
      )
    : "";

  return (
    <section className="flex max-w-measure flex-col gap-space-4">
      <h2 className="font-display text-lead font-strong">{t("sizes.title")}</h2>
      <p className="text-ink-muted">{t("sizes.intro")}</p>
      {profile ? (
        <>
          {profiles.length > 1 && <p className="font-strong">{t("sizes.forProfile", { name })}</p>}
          <SizesForm key={profile.id} profile={profile} name={name} />
        </>
      ) : (
        <p role={ready ? "alert" : "status"}>{ready ? t("loadError") : t("loading")}</p>
      )}
    </section>
  );
}
