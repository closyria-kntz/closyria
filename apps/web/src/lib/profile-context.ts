"use client";

import type { ProfileView, StageCounts, SummaryView } from "@closyria/shared";
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
  return profileId && !isDefault ? `${path}?${PROFILE_PARAM}=${profileId}` : path;
}

export type ProfilesState = {
  profiles: readonly ProfileView[];
  /** False until the first read of the profiles ended (a view waits for it to know which profile to ask). */
  ready: boolean;
  /** Active items per stage, per profile id (empty until the first read). */
  stageCounts: Readonly<Record<string, StageCounts>>;
  /** Who is signed in (null until the first read): her e-mail, null without an account. */
  account: SummaryView["account"] | null;
  /**
   * Re-reads the profiles and the counts; the settings pages call it after creating, renaming or deleting a profile,
   * the sheet after keeping, moving, changing the stage of or deleting an item.
   */
  refreshProfiles: () => Promise<void>;
};

/** The profiles of the signed-in (or anonymous) account; filled by the app shell. */
export const ProfilesContext = createContext<ProfilesState>({
  profiles: [],
  ready: true,
  stageCounts: {},
  account: null,
  refreshProfiles: async () => {},
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

export function useCurrentProfile(): CurrentProfile {
  const profiles = useProfiles();
  return resolveCurrentProfile(profiles, readProfileParam(useSearchParams()));
}

const NOTHING_YET: StageCounts = { spotted: 0, ordered: 0, owned: 0, for_sale: 0, sold: 0, returned: 0 };

/**
 * The current profile's counts per stage, null until they are read (no false zero). A visitor without any profile
 * yet (nothing kept, no session) has zeros everywhere.
 */
export function useStageCounts(): StageCounts | null {
  const { id } = useCurrentProfile();
  const { stageCounts, ready, profiles } = useContext(ProfilesContext);
  if (id) return stageCounts[id] ?? null;
  return ready && profiles.length === 0 ? NOTHING_YET : null;
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
