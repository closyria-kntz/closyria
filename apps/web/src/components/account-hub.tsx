"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useContext, useId } from "react";
import { ProfilesContext, profileHref, profileLabel, useAccount, useCurrentProfile } from "@/lib/profile-context";
import { AppearanceSettings } from "./appearance-settings";
import { sectionTitleClass } from "./home-news";
import { focusRing } from "./ui";

const rowClass = `flex min-h-touch-target items-center justify-between gap-space-3 rounded-card bg-surface-raised px-space-4 py-space-3 hover:bg-surface-strong ${focusRing}`;

/** One written row of « Compte »: its name, a line under it when there is something to say, and a chevron. */
function Row({ href, label, hint }: { href: string; label: string; hint?: string | undefined }) {
  return (
    <li className="flex flex-col">
      <Link href={href} className={rowClass}>
        <span className="flex min-w-space-0 flex-col gap-space-0-5">
          <span className="font-strong">{label}</span>
          {hint && <span className="truncate text-sm text-ink-muted">{hint}</span>}
        </span>
        <span aria-hidden="true" className="shrink-0 text-ink-muted">
          ›
        </span>
      </Link>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-space-2-5">
      <h2 id={titleId} className={sectionTitleClass}>
        {title}
      </h2>
      <ul className="flex flex-col gap-space-2">{children}</ul>
    </section>
  );
}

/**
 * « Compte » (navigation 2026-11-12, decision 2): her profile, the family's profiles, light or dark, the other
 * settings, adding from her phone and help. No article here: they all live in « Mes articles ». Each link keeps the
 * chosen profile, as the old « Moi » did.
 */
export function AccountHub() {
  const t = useTranslations("AccountHub");
  const tSettings = useTranslations("Settings.nav");
  const tShell = useTranslations("Shell.account");
  const account = useAccount();
  const { account: summary, profiles } = useContext(ProfilesContext);
  const { id, isDefault } = useCurrentProfile();
  const href = (path: string) => profileHref(path, id, isDefault);
  const firstName = summary?.firstName ?? null;

  const who = account ? (account.email ?? tShell("anonymous")) : undefined;
  const profileHint = who && firstName ? `${firstName} · ${who}` : who;
  const family = profiles.map((profile, index) => profileLabel(profile, index, firstName)).join(", ");

  return (
    <div className="flex flex-col gap-space-5 pb-space-6">
      <h1 className="font-title text-page-title leading-none font-regular">{t("title")}</h1>

      <Section title={t("profile.title")}>
        <Row href="/reglages/compte" label={t("profile.row")} hint={profileHint} />
      </Section>

      <Section title={t("family.title")}>
        <Row href={href("/reglages/profils")} label={t("family.row")} hint={family || undefined} />
      </Section>

      <div id="apparence" className="scroll-mt-space-4">
        <AppearanceSettings headingClassName={sectionTitleClass} />
      </div>

      <Section title={t("settings.title")}>
        <Row href={href("/reglages/niveaux")} label={tSettings("levels")} />
        <Row href={href("/reglages/tailles")} label={tSettings("sizes")} />
        <Row href={href("/reglages/etiquettes")} label={tSettings("tags")} />
        <Row href={href("/reglages/corbeille")} label={tSettings("trash")} />
      </Section>

      <Section title={t("help.title")}>
        <Row href={href("/aide/telephone")} label={t("help.phone")} hint={t("help.phoneHint")} />
      </Section>
    </div>
  );
}
