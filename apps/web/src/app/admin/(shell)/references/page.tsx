import type { ReferenceKind } from "@closyria/shared";
import { getTranslations } from "next-intl/server";
import { fetchAdminReference } from "@/lib/admin-api";
import { adminCallOrThrow, requireAdminPage } from "../../server";
import { ReferenceSection } from "./reference-section";

const KINDS = ["categories", "colors", "materials", "patterns"] as const satisfies readonly ReferenceKind[];

/**
 * The reference lists: category tree, colours, materials and patterns, each with its keywords. A list that
 * cannot be read throws to the admin error page: the forms are never offered on a list that failed to load.
 */
export default async function AdminReferencePage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.reference");
  const lists = await Promise.all(
    KINDS.map((kind) => adminCallOrThrow(`The ${kind} list`, (api) => fetchAdminReference(api, kind))),
  );
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="max-w-prose text-ink-muted">{t("intro")}</p>
      {KINDS.map((kind, index) => (
        <ReferenceSection key={kind} kind={kind} entries={lists[index]?.entries ?? []} />
      ))}
    </>
  );
}
