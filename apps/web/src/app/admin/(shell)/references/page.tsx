import { type ReferenceKind, referenceListSchema } from "@closyria/shared";
import { getTranslations } from "next-intl/server";
import { adminRead, requireAdminPage } from "../../server";
import { ReferenceSection } from "./reference-section";

const KINDS = ["categories", "colors", "materials", "patterns"] as const satisfies readonly ReferenceKind[];

/** The reference lists: category tree, colours, materials and patterns, each with its keywords. */
export default async function AdminReferencePage() {
  await requireAdminPage();
  const t = await getTranslations("Admin.reference");
  const lists = await Promise.all(KINDS.map((kind) => adminRead(`/api/admin/reference/${kind}`, referenceListSchema)));
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
