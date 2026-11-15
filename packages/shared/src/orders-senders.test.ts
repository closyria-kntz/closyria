import { describe, expect, it } from "vitest";
import {
  MAX_SENDER_ADDRESSES,
  SENDER_CODE_MAX_ATTEMPTS,
  SENDER_CODE_MINUTES,
  senderAddressInputSchema,
  senderAddressListSchema,
  senderCodeInputSchema,
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
});
