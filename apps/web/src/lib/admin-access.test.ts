import { describe, expect, it, vi } from "vitest";
import { adminAccess, loadAdminAccess } from "./admin-access";

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

describe("loadAdminAccess", () => {
  it("decides from the session", async () => {
    const admin = { user: { role: "admin" }, session: { authMethod: "passkey" } } as const;
    expect(await loadAdminAccess(async () => admin)).toBe("ok");
  });

  it("answers not-found when the session check fails, and logs no personal data", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("get-session answered 500 for alice@example.com");
    expect(await loadAdminAccess(async () => Promise.reject(failure))).toBe("not-found");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("alice@example.com");
    log.mockRestore();
  });
});
