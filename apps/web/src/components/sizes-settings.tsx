"use client";

import {
  MAX_PROFILE_SIZE,
  type ProfileSizes,
  type ProfileView,
  SIZE_SUGGESTIONS,
  type SizeKind,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useContext, useId, useState } from "react";
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
import { inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";
/** The select's value for « Une autre taille… »; no real size can be this long. */
const OTHER = "__other";

const KINDS = [
  { kind: "top", field: "sizeTop" },
  { kind: "bottom", field: "sizeBottom" },
  { kind: "shoes", field: "sizeShoes" },
] as const satisfies readonly { kind: SizeKind; field: keyof ProfileSizes }[];

type Draft = Record<SizeKind, { choice: string; other: string }>;

/** What the select shows for a saved size: itself when suggested, « Une autre taille… » (and its text) otherwise. */
function draftOf(profile: ProfileView): Draft {
  const one = (kind: SizeKind, saved: string | null) => {
    if (!saved) return { choice: "", other: "" };
    return SIZE_SUGGESTIONS[kind].includes(saved) ? { choice: saved, other: "" } : { choice: OTHER, other: saved };
  };
  return {
    top: one("top", profile.sizeTop),
    bottom: one("bottom", profile.sizeBottom),
    shoes: one("shoes", profile.sizeShoes),
  };
}

/** The size to send: null (never an empty text, the API refuses it) when the field is emptied. */
function sizeOf(entry: Draft[SizeKind]): string | null {
  const value = (entry.choice === OTHER ? entry.other : entry.choice).trim();
  return value === "" ? null : value;
}

function SizesForm({ profile, name }: { profile: ProfileView; name: string }) {
  const t = useTranslations("Settings");
  const base = useId();
  const refresh = useRefreshProfiles();
  const [draft, setDraft] = useState<Draft>(() => draftOf(profile));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const change = (kind: SizeKind, next: Partial<Draft[SizeKind]>) =>
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...next } }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const result = await patchProfile(profile.id, {
      sizeTop: sizeOf(draft.top),
      sizeBottom: sizeOf(draft.bottom),
      sizeShoes: sizeOf(draft.shoes),
    });
    setBusy(false);
    setFailed(!result.ok);
    if (!result.ok) return;
    await refresh();
    pushUndo(t("sizes.saved"), null);
  }

  return (
    <form onSubmit={submit} aria-label={t("sizes.forProfile", { name })} className="grid gap-space-3 sm:grid-cols-3">
      {KINDS.map(({ kind }) => {
        const id = `${base}-${kind}`;
        const label = t(`sizes.${kind}`);
        return (
          <div key={kind} className="flex flex-col gap-space-1">
            <label htmlFor={id} className="text-sm font-strong">
              {label}
            </label>
            <select
              id={id}
              value={draft[kind].choice}
              onChange={(event) => change(kind, { choice: event.target.value })}
              className={`${inputClass} ${touch}`}
            >
              <option value="">{t("sizes.none")}</option>
              {SIZE_SUGGESTIONS[kind].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
              <option value={OTHER}>{t("sizes.other")}</option>
            </select>
            {draft[kind].choice === OTHER && (
              <input
                aria-label={t("sizes.otherLabel", { kind: label })}
                value={draft[kind].other}
                maxLength={MAX_PROFILE_SIZE}
                onChange={(event) => change(kind, { other: event.target.value })}
                className={`${inputClass} ${touch}`}
              />
            )}
          </div>
        );
      })}
      <div className="flex flex-col gap-space-2 sm:col-span-3">
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
 * « Mes tailles » (catalogue « Découvrir », spec §3.3): hauts, bas and chaussures of the chosen profile, each one
 * optional, from the suggested values or a few characters of her own. They are what « Ma taille en stock » compares.
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
