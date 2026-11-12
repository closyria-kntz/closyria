"use client";

import { DEFAULT_LOVE_LEVELS, type LoveLevelView, type ProfileView, type SummaryView } from "@closyria/shared";
import { useSearchParams } from "next/navigation";
import { createContext, useContext } from "react";
import { z } from "zod";

/** The current profile lives in the address (`?profil=<id>`), so a link keeps it and the back button restores it. */
export const PROFILE_PARAM = "profil";

export type CurrentProfile = {
  id: string | null;
  profile: ProfileView | null;
  /** True when the address names no (known) profile: the first one, « Moi », is used. */
  isDefault: boolean;
};

export function readProfileParam(params: Pick<URLSearchParams, "get"> | null): string | null {
  const parsed = z.uuid().safeParse(params?.get(PROFILE_PARAM));
  return parsed.success ? parsed.data : null;
}

export function resolveCurrentProfile(profiles: readonly ProfileView[], requested: string | null): CurrentProfile {
  const named = requested ? profiles.find((profile) => profile.id === requested) : undefined;
  if (named) return { id: named.id, profile: named, isDefault: false };
  const first = profiles[0] ?? null;
  return { id: first?.id ?? null, profile: first, isDefault: true };
}

/** A link inside the shell: the chosen profile is carried along, the default one is not written. */
export function profileHref(path: string, profileId: string | null, isDefault: boolean): string {
  if (!profileId || isDefault) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${PROFILE_PARAM}=${profileId}`;
}

/** The name every account's first profile starts with (`apps/api/src/wardrobe/profiles.ts`). */
const OWN_PROFILE_NAME = "Moi";

/**
 * What the band's switcher says for a profile (navigation 2026-11-12): her first name for her own profile (the first
 * one) while it still has its starting name « Moi », the profile's name otherwise; « Moi » when there is no name.
 */
export function profileLabel(profile: ProfileView, index: number, firstName: string | null): string {
  const name = profile.name.trim();
  if (index === 0 && name === OWN_PROFILE_NAME && firstName) return firstName;
  return name || OWN_PROFILE_NAME;
}

export type ProfilesState = {
  profiles: readonly ProfileView[];
  /** False until the first read of the profiles ended (a view waits for it to know which profile to ask). */
  ready: boolean;
  /** Re-reads the profiles; the settings pages call it after creating, renaming or deleting one. */
  /** Who is signed in (null until the first read): her e-mail, null without an account. */
  account: SummaryView["account"] | null;
  refreshProfiles: () => Promise<void>;
  /** Her names and emojis for the 4 levels: the starting ones until the shell has read hers. */
  loveLevels: readonly LoveLevelView[];
  /** Re-reads her levels (after « Mes niveaux » saved them). */
  refreshLoveLevels: () => Promise<void>;
};

/** The profiles of the signed-in (or anonymous) account; filled by the app shell. */
export const ProfilesContext = createContext<ProfilesState>({
  profiles: [],
  ready: true,
  account: null,
  refreshProfiles: async () => {},
  loveLevels: DEFAULT_LOVE_LEVELS,
  refreshLoveLevels: async () => {},
});

export function useProfiles(): readonly ProfileView[] {
  return useContext(ProfilesContext).profiles;
}

export function useProfilesReady(): boolean {
  return useContext(ProfilesContext).ready;
}

export function useRefreshProfiles(): () => Promise<void> {
  return useContext(ProfilesContext).refreshProfiles;
}

/** Her 4 levels (name and emoji), as every pill and menu shows them. */
export function useLoveLevels(): readonly LoveLevelView[] {
  return useContext(ProfilesContext).loveLevels;
}

export function useRefreshLoveLevels(): () => Promise<void> {
  return useContext(ProfilesContext).refreshLoveLevels;
}

export function useCurrentProfile(): CurrentProfile {
  const profiles = useProfiles();
  return resolveCurrentProfile(profiles, readProfileParam(useSearchParams()));
}

/** Who is signed in, as the menu and « Mon compte » show it. */
export type AccountState = { email: string; createdAt: string } | { email: null };

/**
 * Who is signed in, for the menu and « Mon compte »; null until the shell has read it. A visitor with no session
 * yet (nothing kept so far) has no account either.
 */
export function useAccount(): AccountState | null {
  const { account, ready } = useContext(ProfilesContext);
  if (account?.email) return { email: account.email, createdAt: account.createdAt };
  return account || ready ? { email: null } : null;
}
