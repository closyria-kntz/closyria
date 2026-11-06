"use client";

import {
  type Audience,
  audienceSchema,
  type ChildDetail,
  childDetailSchema,
  MAX_PROFILE_NAME,
  type ProfileColor,
  type ProfileInput,
  type ProfileView,
  profileColorSchema,
} from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState } from "react";
import { useProfiles, useProfilesReady, useRefreshProfiles } from "@/lib/profile-context";
import { moveId } from "@/lib/reorder";
import { pushUndo } from "@/lib/undo";
import { createProfile, deleteProfile, patchProfile, reorderProfiles } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { focusMoved, MoveButtons, type MoveDirection } from "./move-buttons";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

/** The fields of a profile: used to change one and to add one. */
function ProfileForm({
  initial,
  label,
  submitLabel,
  onSubmit,
  children,
}: {
  initial: { name: string; audience: Audience; childDetail: ChildDetail | null; color: ProfileColor };
  label: string;
  submitLabel: string;
  onSubmit: (input: ProfileInput) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const t = useTranslations("Settings");
  const base = useId();
  const [name, setName] = useState(initial.name);
  const [audience, setAudience] = useState<Audience>(initial.audience);
  const [childDetail, setChildDetail] = useState<ChildDetail | "">(initial.childDetail ?? "");
  const [color, setColor] = useState<ProfileColor>(initial.color);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit({
      name: name.trim(),
      audience,
      childDetail: audience === "child" && childDetail ? childDetail : null,
      color,
    });
    setBusy(false);
    if (ok && !children) setName("");
  }

  const field = "flex flex-col gap-space-1";
  return (
    <form onSubmit={submit} aria-label={label} className="grid gap-space-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className={field}>
        <label htmlFor={`${base}-name`} className="text-sm font-strong">
          {t("profiles.name")}
        </label>
        <input
          id={`${base}-name`}
          value={name}
          maxLength={MAX_PROFILE_NAME}
          required
          onChange={(event) => setName(event.target.value)}
          className={`${inputClass} ${touch}`}
        />
      </div>
      <div className={field}>
        <label htmlFor={`${base}-audience`} className="text-sm font-strong">
          {t("profiles.audience")}
        </label>
        <select
          id={`${base}-audience`}
          value={audience}
          onChange={(event) => setAudience(event.target.value as Audience)}
          className={`${inputClass} ${touch}`}
        >
          {audienceSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`profiles.audienceOptions.${option}`)}
            </option>
          ))}
        </select>
      </div>
      {audience === "child" && (
        <div className={field}>
          <label htmlFor={`${base}-child`} className="text-sm font-strong">
            {t("profiles.childDetail")}
          </label>
          <select
            id={`${base}-child`}
            value={childDetail}
            onChange={(event) => setChildDetail(event.target.value as ChildDetail | "")}
            className={`${inputClass} ${touch}`}
          >
            <option value="">{t("profiles.childNone")}</option>
            {childDetailSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`profiles.childOptions.${option}`)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={field}>
        <label htmlFor={`${base}-color`} className="text-sm font-strong">
          {t("profiles.color")}
        </label>
        <select
          id={`${base}-color`}
          value={color}
          onChange={(event) => setColor(event.target.value as ProfileColor)}
          className={`${inputClass} ${touch}`}
        >
          {profileColorSchema.options.map((option) => (
            <option key={option} value={option}>
              {t(`colors.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-end gap-space-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" disabled={busy} className={`${primaryButtonClass} ${touch}`}>
          {submitLabel}
        </button>
        {children}
      </div>
    </form>
  );
}

/** « Réglages › Profils »: name, public, colour, order and deletion (only an empty profile). */
export function ProfilesSettings() {
  const t = useTranslations("Settings");
  const profiles = useProfiles();
  const ready = useProfilesReady();
  const refresh = useRefreshProfiles();
  const [rowError, setRowError] = useState<{ id: string | null; text: string } | null>(null);
  const [removing, setRemoving] = useState<ProfileView | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function save(profile: ProfileView, input: ProfileInput): Promise<boolean> {
    const result = await patchProfile(profile.id, input);
    if (!result.ok) {
      setRowError({ id: profile.id, text: t("failed") });
      return false;
    }
    setRowError(null);
    await refresh();
    pushUndo(t("profiles.saved", { name: result.name }), null);
    return true;
  }

  async function add(input: ProfileInput): Promise<boolean> {
    const result = await createProfile(input);
    if (!result.ok) {
      setRowError({ id: null, text: t("failed") });
      return false;
    }
    setRowError(null);
    setFormKey((value) => value + 1);
    await refresh();
    pushUndo(t("profiles.added", { name: result.name }), null);
    return true;
  }

  async function move(id: string, direction: MoveDirection) {
    const ids = moveId(
      profiles.map((profile) => profile.id),
      id,
      direction,
    );
    if (!ids) return;
    const result = await reorderProfiles(ids);
    if (!result.ok) return setRowError({ id, text: t("failed") });
    setRowError(null);
    await refresh();
    const moved = profiles.find((profile) => profile.id === id);
    pushUndo(t("profiles.moved", { name: moved?.name ?? "", position: ids.indexOf(id) + 1, count: ids.length }), null);
    focusMoved(id, direction);
  }

  async function destroy() {
    const profile = removing;
    if (!profile) return;
    setRemoving(null);
    const result = await deleteProfile(profile.id);
    if (!result.ok) {
      return setRowError({
        id: profile.id,
        text: result.error === "profile_not_empty" ? t("profiles.notEmpty") : t("failed"),
      });
    }
    setRowError(null);
    await refresh();
    pushUndo(t("profiles.deleted", { name: profile.name }), null);
  }

  return (
    <section className="flex flex-col gap-space-5">
      <div className="flex max-w-measure flex-col gap-space-2">
        <h2 className="font-display text-lead font-strong">{t("profiles.title")}</h2>
        <p className="text-ink-muted">{t("profiles.intro")}</p>
      </div>
      {!ready && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}
      <ul aria-label={t("profiles.listLabel")} className="flex flex-col gap-space-4">
        {profiles.map((profile, index) => (
          <li
            key={profile.id}
            data-testid="profile-row"
            className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-space-3">
              <p className="text-sm text-ink-muted">{t("profiles.itemCount", { count: profile.itemCount ?? 0 })}</p>
              <MoveButtons
                id={profile.id}
                index={index}
                count={profiles.length}
                upLabel={t("profiles.moveUp", { name: profile.name })}
                downLabel={t("profiles.moveDown", { name: profile.name })}
                onMove={move}
              />
            </div>
            <ProfileForm
              initial={{
                name: profile.name,
                audience: profile.audience,
                childDetail: profile.childDetail,
                color: profile.color,
              }}
              label={t("profiles.groupLabel", { name: profile.name })}
              submitLabel={t("profiles.save")}
              onSubmit={(input) => save(profile, input)}
            >
              <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setRemoving(profile)}>
                {t("profiles.delete")}
                <span className="sr-only"> {profile.name}</span>
              </button>
            </ProfileForm>
            {rowError?.id === profile.id && (
              <p role="alert" className="text-sm text-danger">
                {rowError.text}
              </p>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-raised p-space-4">
        <h3 className="font-display text-lead font-strong">{t("profiles.addTitle")}</h3>
        <ProfileForm
          key={formKey}
          initial={{ name: "", audience: "women", childDetail: null, color: "rose" }}
          label={t("profiles.addTitle")}
          submitLabel={t("profiles.add")}
          onSubmit={add}
        />
        {rowError?.id === null && (
          <p role="alert" className="text-sm text-danger">
            {rowError.text}
          </p>
        )}
      </div>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("profiles.deleteTitle", { name: removing?.name ?? "" })}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("profiles.deleteBody")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={() => void destroy()}>
            {t("profiles.deleteConfirm")}
          </button>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setRemoving(null)}>
            {t("cancel")}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
