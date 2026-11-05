import type { ProfileView } from "@closyria/shared";
import { describe, expect, it } from "vitest";
import { profileHref, readProfileParam, resolveCurrentProfile } from "./profile-context";

const profile = (id: string, name: string, position: number): ProfileView => ({
  id,
  name,
  audience: "women",
  childDetail: null,
  color: "plum",
  position,
});
const moi = profile("00000000-0000-4000-8000-000000000001", "Moi", 0);
const lea = profile("00000000-0000-4000-8000-000000000002", "Léa", 1);

describe("readProfileParam", () => {
  it("reads ?profil=<id>", () => {
    expect(readProfileParam(new URLSearchParams(`profil=${lea.id}`))).toBe(lea.id);
  });

  it("ignores a missing, empty or malformed value", () => {
    expect(readProfileParam(new URLSearchParams())).toBeNull();
    expect(readProfileParam(new URLSearchParams("profil="))).toBeNull();
    expect(readProfileParam(new URLSearchParams("profil=nope"))).toBeNull();
    expect(readProfileParam(null)).toBeNull();
  });
});

describe("resolveCurrentProfile", () => {
  it("picks the profile named in the address", () => {
    expect(resolveCurrentProfile([moi, lea], lea.id)).toEqual({ id: lea.id, profile: lea, isDefault: false });
  });

  it("falls back to the first profile (« Moi ») when the address names none or an unknown one", () => {
    expect(resolveCurrentProfile([moi, lea], null)).toEqual({ id: moi.id, profile: moi, isDefault: true });
    expect(resolveCurrentProfile([moi, lea], "00000000-0000-4000-8000-0000000000ff").profile).toBe(moi);
  });

  it("has no profile yet while the list is not loaded", () => {
    expect(resolveCurrentProfile([], null)).toEqual({ id: null, profile: null, isDefault: true });
  });
});

describe("profileHref", () => {
  it("keeps the chosen profile on a link, and nothing for the default one", () => {
    expect(profileHref("/envies", lea.id, false)).toBe(`/envies?profil=${lea.id}`);
    expect(profileHref("/envies", moi.id, true)).toBe("/envies");
    expect(profileHref("/envies", null, true)).toBe("/envies");
  });
});
