import { describe, expect, it } from "vitest";
import { authMethodFor } from "./auth-method";

describe("authMethodFor", () => {
  it("names the method of each sign-in endpoint", () => {
    expect(authMethodFor({ path: "/sign-in/anonymous" })).toBe("anonymous");
    expect(authMethodFor({ path: "/sign-in/email-otp" })).toBe("email-otp");
    expect(authMethodFor({ path: "/passkey/verify-authentication" })).toBe("passkey");
  });

  it("takes the provider of an OAuth callback or an ID token sign-in", () => {
    expect(authMethodFor({ path: "/callback/:id", params: { id: "google" } })).toBe("google");
    expect(authMethodFor({ path: "/callback/:id", params: { id: "apple" } })).toBe("apple");
    expect(authMethodFor({ path: "/sign-in/social", body: { provider: "apple", idToken: {} } })).toBe("apple");
  });

  it("refuses any other way to open a session", () => {
    expect(() => authMethodFor(null)).toThrow();
    expect(() => authMethodFor({ path: "/passkey/verify-registration" })).toThrow();
    expect(() => authMethodFor({ path: "/sign-in/email" })).toThrow();
    expect(() => authMethodFor({ path: "/callback/:id", params: { id: "github" } })).toThrow();
    expect(() => authMethodFor({ path: "/sign-in/social", body: { provider: "passkey" } })).toThrow();
  });
});
