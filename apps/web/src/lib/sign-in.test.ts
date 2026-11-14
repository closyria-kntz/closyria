import { describe, expect, it } from "vitest";
import { codeErrorKey, isSixDigitCode, safeNext, sendErrorKey, signInHref } from "./sign-in";

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/admin/passkey-required")).toBe("/admin/passkey-required");
    expect(safeNext("/items?tri=prix#haut")).toBe("/items?tri=prix#haut");
    expect(safeNext("/admin?x=1#y")).toBe("/admin?x=1#y");
  });

  it("falls back to / for anything else", () => {
    for (const value of [
      undefined,
      "",
      ["/a", "/b"],
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "admin",
      "/\nfoo",
      // Dot segments that normalise into a protocol-relative URL.
      "/.//evil.example",
      "/a/..//evil.example",
      "/./\\evil.example",
    ]) {
      expect(safeNext(value), JSON.stringify(value)).toBe("/");
    }
  });
});

describe("isSixDigitCode", () => {
  it("accepts exactly six digits", () => {
    expect(isSixDigitCode("012345")).toBe(true);
    for (const value of ["12345", "1234567", "12a456", " 123456"]) expect(isSixDigitCode(value)).toBe(false);
  });
});

describe("error messages", () => {
  it("maps a refused code request", () => {
    expect(sendErrorKey({ status: 429 })).toBe("tooManyRequests");
    expect(sendErrorKey({ status: 400 })).toBe("sendFailed");
    expect(sendErrorKey(null)).toBe("sendFailed");
  });

  it("maps a refused code", () => {
    expect(codeErrorKey({ status: 400, code: "INVALID_OTP" })).toBe("invalidCode");
    expect(codeErrorKey({ status: 400, code: "OTP_EXPIRED" })).toBe("expiredCode");
    expect(codeErrorKey({ status: 403, code: "TOO_MANY_ATTEMPTS" })).toBe("tooManyAttempts");
    expect(codeErrorKey({ status: 429 })).toBe("tooManyRequests");
    expect(codeErrorKey({ status: 500 })).toBe("signInFailed");
  });
});

describe("signInHref", () => {
  it("comes back to the page asked for, encoded", () => {
    expect(signInHref("/admin/utilisatrices?q=a&kind=guests")).toBe(
      "/connexion?next=%2Fadmin%2Futilisatrices%3Fq%3Da%26kind%3Dguests",
    );
  });

  it("never sends her to another site, and drops a useless return to the home page", () => {
    expect(signInHref("//evil.example")).toBe("/connexion");
    expect(signInHref(null)).toBe("/connexion");
    expect(signInHref("/")).toBe("/connexion");
  });
});
