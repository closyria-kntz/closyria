"use client";

import type { ReferenceEntry, ReferenceKind } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ColorSwatch } from "@/components/color-swatch";
import { adminRequest, referenceErrorKey } from "@/lib/admin-catalog";
import {
  buildCategoryTree,
  type CategoryNode,
  categoryChoices,
  descendantIds,
  keywordsToText,
  type ReferenceDraft,
  referenceBody,
  slugify,
} from "@/lib/admin-reference";
import { trapTab } from "../../keyboard";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";

type Draft = ReferenceDraft;

const emptyDraft: Draft = { name: "", slug: "", keywords: "", hex: "", parentId: "" };

const draftOf = (entry: ReferenceEntry): Draft => ({
  name: entry.name,
  slug: entry.slug,
  keywords: keywordsToText(entry.keywords),
  hex: entry.hex ?? "",
  parentId: entry.parentId ?? "",
});

type Ops = {
  kind: ReferenceKind;
  entries: readonly ReferenceEntry[];
  /** Runs a request, then reports its outcome next to the entry. */
  run: (key: string, request: () => ReturnType<typeof adminRequest>, done: string) => Promise<boolean>;
  /** Reports a refusal found before sending anything. */
  fail: (key: string) => false;
  busy: boolean;
};

function EntryForm({
  ops,
  draft,
  onChange,
  excludeId,
  nameRef,
}: {
  ops: Ops;
  draft: Draft;
  onChange: (draft: Draft) => void;
  excludeId?: string | undefined;
  nameRef?: React.Ref<HTMLInputElement>;
}) {
  const t = useTranslations("Admin.reference");
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  // A category cannot move under itself or under one of its own sub-categories.
  const blocked = excludeId ? new Set([excludeId, ...descendantIds(ops.entries, excludeId)]) : new Set<string>();
  const parents = categoryChoices(ops.entries, " › ").filter((c) => !blocked.has(c.id));
  return (
    <div className="grid gap-space-3 md:grid-cols-2">
      <label className="flex flex-col gap-space-1 text-sm">
        {t("name")}
        <input
          ref={nameRef}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-space-1 text-sm">
        {t("slug")}
        <input
          value={draft.slug}
          onChange={(e) => set({ slug: e.target.value })}
          placeholder={slugify(draft.name)}
          className={inputClass}
        />
        <span className="text-ink-muted">{t("slugHint")}</span>
      </label>
      {ops.kind === "colors" ? (
        <label className="flex flex-col gap-space-1 text-sm">
          {t("hex")}
          <input value={draft.hex} onChange={(e) => set({ hex: e.target.value })} className={inputClass} />
        </label>
      ) : null}
      {ops.kind === "categories" ? (
        <label className="flex flex-col gap-space-1 text-sm">
          {t("parent")}
          <select value={draft.parentId} onChange={(e) => set({ parentId: e.target.value })} className={inputClass}>
            <option value="">{t("root")}</option>
            {parents.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-space-1 text-sm md:col-span-2">
        {t("keywords")}
        <input value={draft.keywords} onChange={(e) => set({ keywords: e.target.value })} className={inputClass} />
        <span className="text-ink-muted">{t("keywordsHint")}</span>
      </label>
    </div>
  );
}

function EntryRow({
  ops,
  entry,
  childCount,
  inCycle,
}: {
  ops: Ops;
  entry: ReferenceEntry;
  childCount: number;
  inCycle: boolean;
}) {
  const t = useTranslations("Admin.reference");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus goes into the form or the confirmation when it opens, and back to its trigger when it closes.
  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);
  const closeEdit = () => {
    setEditing(false);
    editRef.current?.focus();
  };
  const closeConfirm = () => {
    setConfirming(false);
    deleteRef.current?.focus();
  };

  const save = async () => {
    const built = referenceBody(ops.kind, draft, false);
    if (!built.ok) return ops.fail(entry.id);
    const ok = await ops.run(
      entry.id,
      () => adminRequest("PATCH", `/api/admin/reference/${ops.kind}/${entry.id}`, built.body),
      t("saved"),
    );
    if (ok) closeEdit();
  };
  const remove = async () => {
    await ops.run(entry.id, () => adminRequest("DELETE", `/api/admin/reference/${ops.kind}/${entry.id}`), t("deleted"));
    closeConfirm();
  };

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-center gap-space-3">
        {ops.kind === "colors" ? <ColorSwatch hex={entry.hex} /> : null}
        <span className="font-strong">{entry.name}</span>
        {inCycle ? (
          <span
            className="rounded-button bg-surface-sunken px-space-2 py-space-1 text-sm font-strong text-danger"
            title={t("cycleHint")}
          >
            {t("cycle")}
          </span>
        ) : null}
        {ops.kind === "colors" && entry.hex ? (
          <span className="text-sm text-ink-muted tabular-nums">{t("hexText", { hex: entry.hex })}</span>
        ) : null}
        <span className="text-sm text-ink-muted">
          {entry.keywords.length > 0 ? entry.keywords.join(", ") : t("noKeywords")}
        </span>
        {ops.kind === "categories" ? (
          <span className="text-sm text-ink-muted">{t("subCategories", { count: childCount })}</span>
        ) : null}
        <button
          ref={editRef}
          type="button"
          className={buttonClass}
          aria-expanded={editing}
          aria-label={t("editLabel", { name: entry.name })}
          onClick={() => {
            if (editing) return closeEdit();
            setDraft(draftOf(entry));
            setEditing(true);
          }}
        >
          {t("edit")}
        </button>
        <button
          ref={deleteRef}
          type="button"
          className={buttonClass}
          aria-label={t("deleteLabel", { name: entry.name })}
          onClick={() => setConfirming(true)}
        >
          {t("delete")}
        </button>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`confirm-${entry.id}`}
          className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-sunken p-space-3"
          onKeyDown={(e) => {
            if (e.key === "Escape" && !ops.busy) return closeConfirm();
            trapTab(e);
          }}
        >
          <p id={`confirm-${entry.id}`}>{t("deleteConfirm", { name: entry.name })}</p>
          <div className="flex flex-wrap gap-space-2">
            <button
              type="button"
              ref={confirmRef}
              className={`${primaryButtonClass} aria-disabled:opacity-60`}
              aria-disabled={ops.busy}
              onClick={remove}
            >
              {t("confirmDelete")}
            </button>
            <button
              type="button"
              className={`${buttonClass} aria-disabled:opacity-60`}
              aria-disabled={ops.busy}
              onClick={() => !ops.busy && closeConfirm()}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <form
          aria-label={t("editLabel", { name: entry.name })}
          className="flex flex-col gap-space-3 rounded-card border border-line bg-surface-sunken p-space-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <EntryForm ops={ops} draft={draft} onChange={setDraft} excludeId={entry.id} nameRef={nameRef} />
          <div className="flex flex-wrap gap-space-2">
            <button type="submit" className={`${primaryButtonClass} aria-disabled:opacity-60`} aria-disabled={ops.busy}>
              {t("save")}
            </button>
            <button type="button" className={buttonClass} onClick={closeEdit}>
              {t("close")}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function Tree({ ops, nodes }: { ops: Ops; nodes: CategoryNode[] }) {
  return (
    <ul className="flex flex-col gap-space-3">
      {nodes.map((node) => (
        <li key={node.entry.id} className="flex flex-col gap-space-3">
          <EntryRow ops={ops} entry={node.entry} childCount={node.children.length} inCycle={node.inCycle} />
          {node.children.length > 0 ? (
            <div className="border-l border-line pl-space-4">
              <Tree ops={ops} nodes={node.children} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** One reference list (the categories as a tree), with add, edit and delete; every change refreshes the page. */
export function ReferenceSection({ kind, entries }: { kind: ReferenceKind; entries: ReferenceEntry[] }) {
  const t = useTranslations("Admin.reference");
  const errors = useTranslations("Admin.common.errors");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [message, setMessage] = useState<{ key: string; text: string; failed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const busyRef = useRef(false);
  const ops: Ops = {
    kind,
    entries,
    busy,
    fail: (key) => {
      setMessage({ key, text: errors("invalidEntry"), failed: true });
      return false;
    },
    run: async (key, request, done) => {
      // One request at a time: a second click while one is running does nothing.
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      const res = await request();
      busyRef.current = false;
      setBusy(false);
      if (!res.ok) {
        setMessage({ key, text: errors(referenceErrorKey(res.status, res.body)), failed: true });
        return false;
      }
      setMessage({ key, text: done, failed: false });
      router.refresh();
      return true;
    },
  };

  const add = async () => {
    const built = referenceBody(kind, draft, true);
    if (!built.ok) return void ops.fail("new");
    const ok = await ops.run("new", () => adminRequest("POST", `/api/admin/reference/${kind}`, built.body), t("added"));
    if (ok) setDraft(emptyDraft);
  };

  const titleId = `reference-${kind}-title`;
  const heading = {
    categories: "categoriesTitle",
    colors: "colorsTitle",
    materials: "materialsTitle",
    patterns: "patternsTitle",
  } as const;
  const addLabel = {
    categories: "addCategory",
    colors: "addColor",
    materials: "addMaterial",
    patterns: "addPattern",
  } as const;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-space-4 rounded-card border border-card-border bg-card-bg p-space-4"
    >
      <h2 id={titleId} className="font-display text-lead font-strong">
        {t(heading[kind])}
      </h2>
      {entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : kind === "categories" ? (
        <Tree ops={ops} nodes={buildCategoryTree(entries)} />
      ) : (
        <ul className="flex flex-col gap-space-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <EntryRow ops={ops} entry={entry} childCount={0} inCycle={false} />
            </li>
          ))}
        </ul>
      )}
      <form
        aria-label={t(addLabel[kind])}
        className="flex flex-col gap-space-3 border-t border-line pt-space-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <h3 className="font-strong">{t(addLabel[kind])}</h3>
        <EntryForm ops={ops} draft={draft} onChange={setDraft} />
        <div className="flex flex-wrap items-center gap-space-3">
          <button type="submit" className={`${primaryButtonClass} aria-disabled:opacity-60`} aria-disabled={busy}>
            {busy ? t("adding") : t("add")}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" className={message?.failed ? "text-danger" : "text-success"}>
        {message?.text}
      </p>
    </section>
  );
}
