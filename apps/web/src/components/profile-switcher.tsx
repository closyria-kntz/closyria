"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { PROFILE_PARAM, useCurrentProfile, useProfiles } from "@/lib/profile-context";
import { focusRing } from "./ui";

/** Header control: who the wardrobe is for. The choice goes into the address (`?profil=`), so it can be shared and kept. */
export function ProfileSwitcher() {
  const t = useTranslations("Shell.profile");
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const profiles = useProfiles();
  const current = useCurrentProfile();

  if (profiles.length === 0) {
    return (
      <p className="inline-flex min-h-touch-target items-center rounded-button border border-line px-space-3 text-sm text-ink-muted">
        <span className="sr-only">{t("label")} : </span>
        {t("me")}
      </p>
    );
  }

  const choose = (profileId: string) => {
    const params = new URLSearchParams(search.toString());
    if (profileId === profiles[0]?.id) params.delete(PROFILE_PARAM);
    else params.set(PROFILE_PARAM, profileId);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex items-center">
      <label htmlFor={id} className="sr-only">
        {t("label")}
      </label>
      <select
        id={id}
        value={current.id ?? ""}
        onChange={(event) => choose(event.target.value)}
        className={`min-h-touch-target max-w-narrow truncate rounded-button border border-line bg-surface-raised px-space-3 text-sm text-ink ${focusRing}`}
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </div>
  );
}
