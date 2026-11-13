import { describe, expect, it, vi } from "vitest";
import { adminAccess, loadAdminAccess } from "./admin-access";
import { SessionCheckError } from "./admin-api";

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

  it("logs the status of a refused check, and only the status", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadAdminAccess(async () => Promise.reject(new SessionCheckError(403)))).toBe("not-found");
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: "admin.session_check_failed",
      error: "SessionCheckError",
      status: 403,
    });
    log.mockRestore();
  });

  it("tries once more after a 5xx, a network error or a timeout", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const admin = { user: { role: "admin" }, session: { authMethod: "passkey" } } as const;
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    for (const failure of [new SessionCheckError(502), new TypeError("fetch failed"), timeout]) {
      const load = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(admin);
      expect(await loadAdminAccess(load, 1)).toBe("ok");
      expect(load).toHaveBeenCalledTimes(2);
    }
    const down = vi.fn().mockRejectedValue(new SessionCheckError(500));
    expect(await loadAdminAccess(down, 1)).toBe("not-found");
    expect(down).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("never retries a 401 or 403, nor a non-admin session", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [401, 403]) {
      const load = vi.fn().mockRejectedValue(new SessionCheckError(status));
      expect(await loadAdminAccess(load, 1)).toBe("not-found");
      expect(load).toHaveBeenCalledTimes(1);
    }
    const load = vi.fn().mockResolvedValue({ user: { role: "user" }, session: { authMethod: "passkey" } });
    expect(await loadAdminAccess(load, 1)).toBe("not-found");
    expect(load).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
