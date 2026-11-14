import { describe, expect, it } from "vitest";
import { hasSessionCookie, initialGuest } from "./session-cookie";

describe("hasSessionCookie", () => {
  it("sees Better Auth's session cookie, over http and https", () => {
    expect(hasSessionCookie((name) => name === "better-auth.session_token")).toBe(true);
    expect(hasSessionCookie((name) => name === "__Secure-better-auth.session_token")).toBe(true);
  });

  it("ignores other cookies", () => {
    expect(hasSessionCookie((name) => name === "closyria-dev-access")).toBe(false);
    expect(hasSessionCookie(() => false)).toBe(false);
  });
});

describe("initialGuest", () => {
  it("is a guest at once without a session cookie, unknown with one", () => {
    expect(initialGuest(false)).toBe(true);
    expect(initialGuest(true)).toBeNull();
  });
});
