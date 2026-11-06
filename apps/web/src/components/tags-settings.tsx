"use client";

import { MAX_TAG_NAME, type ProfileColor, profileColorSchema, type TagView } from "@closyria/shared";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { pushUndo } from "@/lib/undo";
import { createTag, deleteTag, fetchTags, patchTag } from "@/lib/wardrobe-client";
import { Dialog } from "./dialog";
import { buttonClass, inputClass, primaryButtonClass } from "./ui";

const touch = "min-h-touch-target";

function TagRow({
  tag,
  onSave,
  onDelete,
  error,
}: {
  tag: TagView;
  onSave: (tag: TagView, name: string, color: ProfileColor | null) => Promise<void>;
  onDelete: (tag: TagView) => void;
  error: string | null;
}) {
  const t = useTranslations("Settings");
  const base = useId();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState<ProfileColor | "">(tag.color ?? "");
  return (
    <li
      className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-raised p-space-3"
      data-testid="tag-row"
    >
      <form
        aria-label={t("tags.groupLabel", { name: tag.name })}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (name.trim()) void onSave(tag, name.trim(), color || null);
        }}
        className="grid gap-space-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="flex flex-col gap-space-1">
          <label htmlFor={`${base}-name`} className="text-sm font-strong">
            {t("tags.name")}
          </label>
          <input
            id={`${base}-name`}
            value={name}
            maxLength={MAX_TAG_NAME}
            required
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass} ${touch}`}
          />
        </div>
        <div className="flex flex-col gap-space-1">
          <label htmlFor={`${base}-color`} className="text-sm font-strong">
            {t("tags.color")}
          </label>
          <select
            id={`${base}-color`}
            value={color}
            onChange={(event) => setColor(event.target.value as ProfileColor | "")}
            className={`${inputClass} ${touch}`}
          >
            <option value="">{t("tags.noColor")}</option>
            {profileColorSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`colors.${option}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-space-2">
          <button type="submit" className={`${primaryButtonClass} ${touch}`}>
            {t("tags.save")}
          </button>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => onDelete(tag)}>
            {t("tags.delete")}
            <span className="sr-only"> {tag.name}</span>
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** « Réglages › Étiquettes »: create, rename, recolour and delete tags. */
export function TagsSettings() {
  const t = useTranslations("Settings");
  const [tags, setTags] = useState<TagView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [name, setName] = useState("");
  const [error, setError] = useState<{ id: string | null; text: string } | null>(null);
  const [removing, setRemoving] = useState<TagView | null>(null);
  const fieldId = useId();

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setTags(await fetchTags());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const failure = (code: string) =>
    code === "tag_exists" ? t("tags.exists") : code === "tag_limit" ? t("tags.limit") : t("failed");

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const result = await createTag(trimmed);
    if (!result.ok) return setError({ id: null, text: failure(result.error) });
    setError(null);
    setName("");
    await load();
    pushUndo(t("tags.created", { name: result.name }), null);
  }

  async function save(tag: TagView, newName: string, color: ProfileColor | null) {
    const result = await patchTag(tag.id, { name: newName, color });
    if (!result.ok) return setError({ id: tag.id, text: failure(result.error) });
    setError(null);
    await load();
    pushUndo(t("tags.saved", { name: result.name }), null);
  }

  async function destroy() {
    const tag = removing;
    if (!tag) return;
    setRemoving(null);
    const result = await deleteTag(tag.id);
    if (!result.ok) return setError({ id: tag.id, text: failure(result.error) });
    setError(null);
    await load();
    pushUndo(t("tags.deleted", { name: tag.name }), null);
  }

  return (
    <section className="flex flex-col gap-space-5">
      <div className="flex max-w-measure flex-col gap-space-2">
        <h2 className="font-display text-lead font-strong">{t("tags.title")}</h2>
        <p className="text-ink-muted">{t("tags.intro")}</p>
      </div>

      <form onSubmit={create} className="flex max-w-measure flex-col gap-space-2 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-space-1">
          <label htmlFor={fieldId} className="text-sm font-strong">
            {t("tags.newLabel")}
          </label>
          <input
            id={fieldId}
            value={name}
            maxLength={MAX_TAG_NAME}
            required
            onChange={(event) => setName(event.target.value)}
            className={`${inputClass} ${touch}`}
          />
        </div>
        <button type="submit" className={`${primaryButtonClass} ${touch}`}>
          {t("tags.create")}
        </button>
      </form>
      {error?.id === null && (
        <p role="alert" className="text-sm text-danger">
          {error.text}
        </p>
      )}

      {status === "loading" && (
        <p role="status" className="text-ink-muted">
          {t("loading")}
        </p>
      )}
      {status === "error" && (
        <div className="flex flex-col items-start gap-space-2">
          <p role="alert" className="text-sm text-danger">
            {t("loadError")}
          </p>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => void load()}>
            {t("retry")}
          </button>
        </div>
      )}
      {status === "ready" && tags.length === 0 && <p className="text-ink-muted">{t("tags.empty")}</p>}
      {tags.length > 0 && (
        <ul aria-label={t("tags.listLabel")} className="flex flex-col gap-space-3">
          {tags.map((tag) => (
            <TagRow
              key={`${tag.id}:${tag.name}:${tag.color}`}
              tag={tag}
              onSave={save}
              onDelete={setRemoving}
              error={error?.id === tag.id ? error.text : null}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t("tags.deleteTitle", { name: removing?.name ?? "" })}
        closeLabel={t("close")}
      >
        <p className="text-ink-muted">{t("tags.deleteBody")}</p>
        <div className="flex flex-wrap gap-space-2">
          <button type="button" className={`${primaryButtonClass} ${touch}`} onClick={() => void destroy()}>
            {t("tags.deleteConfirm")}
          </button>
          <button type="button" className={`${buttonClass} ${touch}`} onClick={() => setRemoving(null)}>
            {t("cancel")}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
