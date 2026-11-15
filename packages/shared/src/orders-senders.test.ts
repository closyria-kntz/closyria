import { describe, expect, it } from "vitest";
import {
  cleanSenderCode,
  MAX_SENDER_ADDRESSES,
  SENDER_CODE_MAX_ATTEMPTS,
  SENDER_CODE_MINUTES,
  SENDER_TARGET_SENDS_PER_DAY,
  senderAddressInputSchema,
  senderAddressListSchema,
  senderCodeInputSchema,
  senderRateLimitedSchema,
} from "./orders";
import { wardrobeErrorCodes } from "./wardrobe";

describe("« Mes adresses d'envoi » (spec §11)", () => {
  it("normalizes the address: trimmed, lowercase, a valid ASCII e-mail", () => {
    expect(senderAddressInputSchema.parse({ email: "  Marie.Test@Hotmail.FR " })).toEqual({
      email: "marie.test@hotmail.fr",
    });
    for (const bad of ["", "marie", "marie@", "marié@hotmail.fr", "marie@hötmail.fr", `${"a".repeat(250)}@b.fr`]) {
      expect(senderAddressInputSchema.safeParse({ email: bad }).success, bad).toBe(false);
    }
  });

  it("takes a code of 6 digits, spaces around allowed", () => {
    expect(senderCodeInputSchema.parse({ code: " 012345 " })).toEqual({ code: "012345" });
    for (const bad of ["12345", "1234567", "12a456", "12 456"]) {
      expect(senderCodeInputSchema.safeParse({ code: bad }).success, bad).toBe(false);
    }
  });

  it("keeps the limits of the spec", () => {
    expect(MAX_SENDER_ADDRESSES).toBe(10);
    expect(SENDER_CODE_MINUTES).toBe(15);
    expect(SENDER_CODE_MAX_ATTEMPTS).toBe(5);
  });

  it("lists the account address apart, then the added ones with their state", () => {
    const list = {
      accountEmail: "marie@gmail.com",
      max: 10,
      addresses: [
        {
          id: "7a0c3c58-7c3b-4d0e-9a5e-1f7d1b0f3c11",
          email: "marie@hotmail.fr",
          verified: false,
          createdAt: "2026-11-15T10:00:00.000Z",
        },
      ],
    };
    expect(senderAddressListSchema.parse(list)).toEqual(list);
  });

  it("has its error codes", () => {
    for (const code of [
      "sender_exists",
      "sender_limit",
      "sender_verified",
      "code_wrong",
      "code_expired",
      "code_locked",
      "mail_failed",
    ]) {
      expect(wardrobeErrorCodes).toContain(code);
    }
  });

  it("cleans a pasted code before keeping 6 digits", () => {
    expect(cleanSenderCode("123 456")).toBe("123456");
    expect(cleanSenderCode(" 123-456 ")).toBe("123456");
    expect(cleanSenderCode("1234567")).toBe("123456");
    expect(cleanSenderCode("12 34 56 78")).toBe("123456");
  });

  it("caps the codes to one address and says the wait in a 429", () => {
    expect(SENDER_TARGET_SENDS_PER_DAY).toBe(3);
    expect(senderRateLimitedSchema.parse({ error: "rate_limited", retryAfterSeconds: 42 })).toEqual({
      error: "rate_limited",
      retryAfterSeconds: 42,
    });
    expect(senderRateLimitedSchema.safeParse({ error: "rate_limited", retryAfterSeconds: 0 }).success).toBe(false);
    expect(wardrobeErrorCodes).toContain("email_unverified");
  });
});
