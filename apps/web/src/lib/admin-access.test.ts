import { describe, expect, it } from "vitest";
import { adminAccess } from "./admin-access";

const session = (role: string, authMethod: string) => ({ user: { role }, session: { authMethod } });

describe("adminAccess", () => {
  it("hides the area (404) without a session", () => {
    expect(adminAccess(null)).toBe("not-found");
  });

  it("hides the area (404) from a non-admin, whatever the sign-in method", () => {
    for (const method of ["anonymous", "email-otp", "google", "apple", "passkey"]) {
      expect(adminAccess(session("user", method))).toBe("not-found");
    }
  });

  it("asks an admin signed in without a passkey to use one", () => {
    for (const method of ["anonymous", "email-otp", "google", "apple"]) {
      expect(adminAccess(session("admin", method))).toBe("passkey-required");
    }
  });

  it("lets an admin with a passkey session in", () => {
    expect(adminAccess(session("admin", "passkey"))).toBe("ok");
  });
});
