import { adminUserKindSchema } from "@closyria/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { fetchAdminUsers, type UserFilters } from "@/lib/admin-api";
import { adminCall, requireAdminPage } from "../../server";
import { buttonClass, inputClass, primaryButtonClass, sheetLinkClass } from "../../ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined;

/**
 * « Utilisatrices » (spec §8, comptes visibles 2026-11-14): accounts and guests, newest first, 50 per page, with counts
 * only (never what is in a wardrobe). Search by e-mail, « Comptes » / « Sans compte ».
 */
export default async function AdminUsersPage({ searchParams }: Props) {
  await requireAdminPage();
  const query = await searchParams;
  const kind = adminUserKindSchema.safeParse(query.kind);
  const filters: UserFilters = { q: clean(query.q, 200), kind: kind.success ? kind.data : undefined };
  const cursor = clean(query.cursor, 300);
  const withFilters = (nextCursor: string | null) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, cursor: nextCursor ?? undefined })) {
      if (value) params.set(key, value);
    }
    const suffix = params.toString();
    return suffix ? `/admin/utilisatrices?${suffix}` : "/admin/utilisatrices";
  };
  const t = await getTranslations("Admin.users");
  const common = await getTranslations("Admin.common");
  const format = await getFormatter();
  const read = await adminCall((api) => fetchAdminUsers(api, { ...filters, cursor }));
  // A bad or stale cursor (400) goes back to the first page; any other refusal is an error, not an empty list.
  if (!read.ok && read.status === 400 && cursor) redirect(withFilters(null));
  if (!read.ok) throw new Error(`The admin people list answered ${read.status}`);
  const page = read.data;
  const nextHref = page.nextCursor ? withFilters(page.nextCursor) : null;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : t("never");

  const cell = "px-space-3 py-space-2 text-left align-top";
  return (
    <>
      <h1 className="font-display text-title font-strong">{t("title")}</h1>
      <p className="text-ink-muted">{t("intro")}</p>
      <form method="get" aria-label={t("search")} className="flex flex-wrap items-end gap-space-3">
        <label className="flex flex-col gap-space-1 text-sm">
          {t("searchLabel")}
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("searchHint")}
            autoComplete="off"
            className={`${inputClass} min-h-touch-target`}
          />
        </label>
        <label className="flex flex-col gap-space-1 text-sm">
          {t("kind")}
          <select name="kind" defaultValue={filters.kind ?? ""} className={`${inputClass} min-h-touch-target`}>
            <option value="">{common("all")}</option>
            {adminUserKindSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${primaryButtonClass} min-h-touch-target`}>
          {t("apply")}
        </button>
        <Link href="/admin/utilisatrices" className={`${buttonClass} min-h-touch-target`}>
          {t("reset")}
        </Link>
      </form>
      {page.users.length === 0 ? (
        <p className="rounded-card border border-card-border bg-card-bg p-space-4">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-card-border bg-card-bg">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="bg-surface-sunken text-ink-muted">
              <tr>
                {(["who", "role", "created", "lastActive", "items", "devices"] as const).map((key) => (
                  <th key={key} scope="col" className={cell}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.users.map((user) => (
                <tr key={user.id} className="border-t border-line">
                  <td className={cell}>
                    <Link
                      href={`/admin/utilisatrices/${encodeURIComponent(user.id)}`}
                      className={`${sheetLinkClass} break-all`}
                    >
                      {user.email ?? t("noAccount")}
                    </Link>
                  </td>
                  <td className={cell}>{t(`roles.${user.role}`)}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    <time dateTime={user.createdAt}>{when(user.createdAt)}</time>
                  </td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    {user.lastActiveAt ? (
                      <time dateTime={user.lastActiveAt}>{when(user.lastActiveAt)}</time>
                    ) : (
                      t("never")
                    )}
                  </td>
                  <td className={`${cell} tabular-nums`}>{user.itemCount}</td>
                  <td className={`${cell} tabular-nums`}>{user.pushDevices}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label={t("pagination")} className="flex flex-wrap gap-space-3">
        {cursor ? (
          <Link href={withFilters(null)} className={`${buttonClass} min-h-touch-target`}>
            {t("first")}
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className={`${buttonClass} min-h-touch-target`}>
            {t("next")}
          </Link>
        ) : null}
      </nav>
    </>
  );
}
