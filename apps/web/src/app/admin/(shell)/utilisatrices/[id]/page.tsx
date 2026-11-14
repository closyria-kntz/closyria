import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { fetchAdminUser } from "@/lib/admin-api";
import { adminCall, requireAdminPage } from "../../../server";
import { buttonClass } from "../../../ui";
import { DeleteUser } from "./delete-user";

type Props = { params: Promise<{ id: string }> };

/**
 * One person (spec §8, comptes visibles 2026-11-14): her account's facts and counts, never the contents of her
 * wardrobe, and « Supprimer ce compte » on her request. Plans and consumption (abonnements) get a block of their own
 * next to « Usage » when they exist.
 */
export default async function AdminUserPage({ params }: Props) {
  await requireAdminPage();
  const { id } = await params;
  const t = await getTranslations("Admin.users");
  const format = await getFormatter();
  const read = await adminCall((api) => fetchAdminUser(api, decodeURIComponent(id)));
  // Only an unknown person is a 404; any other refusal is an error page, never a missing person.
  if (!read.ok && read.status === 404) notFound();
  if (!read.ok) throw new Error(`The admin person answered ${read.status}`);
  const user = read.data;
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }) : t("never");

  const section = "flex flex-col gap-space-3 rounded-card border border-card-border bg-card-bg p-space-4";
  const rows = (items: [string, ReactNode][]) => (
    <dl className="flex flex-col gap-space-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col sm:flex-row sm:gap-space-4">
          <dt className="text-ink-muted sm:w-2/5 sm:shrink-0">{label}</dt>
          <dd className="break-words tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-space-3">
        <h1 className="font-display text-title font-strong break-all">{user.email ?? t("noAccount")}</h1>
        <Link href="/admin/utilisatrices" className={`${buttonClass} min-h-touch-target`}>
          {t("back")}
        </Link>
      </div>
      <p className="text-sm text-ink-muted break-all">{user.id}</p>

      <div className="grid gap-space-5 lg:grid-cols-2">
        <section aria-labelledby="user-facts" className={section}>
          <h2 id="user-facts" className="font-display text-lead font-strong">
            {t("facts")}
          </h2>
          {rows([
            [t("role"), t(`roles.${user.role}`)],
            [
              t("created"),
              <time key="c" dateTime={user.createdAt}>
                {when(user.createdAt)}
              </time>,
            ],
            [
              t("lastActive"),
              user.lastActiveAt ? (
                <time key="l" dateTime={user.lastActiveAt}>
                  {when(user.lastActiveAt)}
                </time>
              ) : (
                t("never")
              ),
            ],
            [
              t("methods"),
              user.signInMethods.length === 0
                ? t("noMethod")
                : user.signInMethods.map((method) => t(`methodNames.${method}`)).join(", "),
            ],
            [t("sessions"), user.sessions],
            [t("devices"), user.pushDevices],
          ])}
        </section>

        <section aria-labelledby="user-usage" className={section}>
          <h2 id="user-usage" className="font-display text-lead font-strong">
            {t("usage")}
          </h2>
          {rows([
            [t("items"), user.itemCount],
            [t("spotted"), user.spottedItems],
            [t("owned"), user.ownedItems],
            [t("wishlists"), user.wishlists],
            [t("profiles"), user.profiles],
          ])}
        </section>
      </div>

      <section aria-labelledby="user-delete" className={section}>
        <h2 id="user-delete" className="font-display text-lead font-strong">
          {t("delete.title")}
        </h2>
        {user.role === "admin" ? (
          <p className="text-sm text-ink-muted">{t("delete.protectedAdmin")}</p>
        ) : (
          <>
            <p className="text-sm">{t("delete.intro")}</p>
            <DeleteUser userId={user.id} email={user.email} />
          </>
        )}
      </section>
    </>
  );
}
