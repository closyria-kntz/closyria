"use client";

import type { ReferenceEntry, ReferenceKind } from "@closyria/shared";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { adminRequest, referenceErrorKey } from "@/lib/admin-catalog";
import {
  buildCategoryTree,
  type CategoryNode,
  categoryChoices,
  keywordsFromText,
  keywordsToText,
  slugify,
} from "@/lib/admin-reference";
import { buttonClass, inputClass, primaryButtonClass } from "../../ui";

type Draft = { name: string; slug: string; keywords: string; hex: string; parentId: string };

const emptyDraft: Draft = { name: "", slug: "", keywords: "", hex: "", parentId: "" };

const draftOf = (entry: ReferenceEntry): Draft => ({
  name: entry.name,
  slug: entry.slug,
  keywords: keywordsToText(entry.keywords),
  hex: entry.hex ?? "",
  parentId: entry.parentId ?? "",
});

/** The body to send for a draft; categories carry their parent, colours their hex. */
function bodyOf(kind: ReferenceKind, draft: Draft, creating: boolean) {
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim() || (creating ? slugify(draft.name) : ""),
    keywords: keywordsFromText(draft.keywords),
    ...(kind === "colors" ? { hex: draft.hex.trim() } : {}),
    ...(kind === "categories" ? { parentId: draft.parentId || null } : {}),
  };
}

type Ops = {
  kind: ReferenceKind;
  entries: readonly ReferenceEntry[];
  /** Runs a request, then reports its outcome next to the entry. */
  run: (key: string, request: () => ReturnType<typeof adminRequest>, done: string) => Promise<boolean>;
};

function EntryForm({
  ops,
  draft,
  onChange,
  excludeId,
}: {
  ops: Ops;
  draft: Draft;
  onChange: (draft: Draft) => void;
  excludeId?: string | undefined;
}) {
  const t = useTranslations("Admin.reference");
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const parents = categoryChoices(ops.entries, " › ").filter((c) => c.id !== excludeId);
  return (
    <div className="grid gap-space-3 md:grid-cols-2">
      <label className="flex flex-col gap-space-1 text-sm">
        {t("name")}
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} className={inputClass} />
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

function EntryRow({ ops, entry, childCount }: { ops: Ops; entry: ReferenceEntry; childCount: number }) {
  const t = useTranslations("Admin.reference");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry));

  const save = async () => {
    const ok = await ops.run(
      entry.id,
      () => adminRequest("PATCH", `/api/admin/reference/${ops.kind}/${entry.id}`, bodyOf(ops.kind, draft, false)),
      t("saved"),
    );
    if (ok) setEditing(false);
  };
  const remove = async () => {
    await ops.run(entry.id, () => adminRequest("DELETE", `/api/admin/reference/${ops.kind}/${entry.id}`), t("deleted"));
    setConfirming(false);
  };

  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex flex-wrap items-center gap-space-3">
        <span className="font-strong">{entry.name}</span>
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
          type="button"
          className={buttonClass}
          aria-expanded={editing}
          aria-label={t("editLabel", { name: entry.name })}
          onClick={() => {
            setDraft(draftOf(entry));
            setEditing((v) => !v);
          }}
        >
          {t("edit")}
        </button>
        <button
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
          aria-labelledby={`confirm-${entry.id}`}
          className="flex flex-col gap-space-2 rounded-card border border-line bg-surface-sunken p-space-3"
          onKeyDown={(e) => {
            if (e.key === "Escape") setConfirming(false);
          }}
        >
          <p id={`confirm-${entry.id}`}>{t("deleteConfirm", { name: entry.name })}</p>
          <div className="flex flex-wrap gap-space-2">
            <button type="button" ref={(el) => el?.focus()} className={primaryButtonClass} onClick={remove}>
              {t("confirmDelete")}
            </button>
            <button type="button" className={buttonClass} onClick={() => setConfirming(false)}>
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
          <EntryForm ops={ops} draft={draft} onChange={setDraft} excludeId={entry.id} />
          <div className="flex flex-wrap gap-space-2">
            <button type="submit" className={primaryButtonClass}>
              {t("save")}
            </button>
            <button type="button" className={buttonClass} onClick={() => setEditing(false)}>
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
          <EntryRow ops={ops} entry={node.entry} childCount={node.children.length} />
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

  const ops: Ops = {
    kind,
    entries,
    run: async (key, request, done) => {
      setBusy(true);
      setMessage(null);
      const res = await request();
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
    if (busy) return;
    const ok = await ops.run(
      "new",
      () => adminRequest("POST", `/api/admin/reference/${kind}`, bodyOf(kind, draft, true)),
      t("added"),
    );
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
              <EntryRow ops={ops} entry={entry} childCount={0} />
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
