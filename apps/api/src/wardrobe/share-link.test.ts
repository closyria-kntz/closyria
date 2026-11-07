import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptShareToken, encryptShareToken, parseShareLinkKey } from "./share-link";
import { newShareToken } from "./share-token";

const key = randomBytes(32);

describe("share link encryption", () => {
  it("decrypts what it encrypted, in the v1 format", () => {
    const { token } = newShareToken();
    const sealed = encryptShareToken(token, key);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain(token);
    expect(decryptShareToken(sealed, key)).toBe(token);
  });

  it("uses a fresh IV each time", () => {
    expect(encryptShareToken("x", key)).not.toBe(encryptShareToken("x", key));
  });

  it("returns null when a character is changed", () => {
    const sealed = encryptShareToken("abcdefghijklmnopqrstuv", key);
    const i = sealed.length - 2;
    const tampered = `${sealed.slice(0, i)}${sealed[i] === "A" ? "B" : "A"}${sealed.slice(i + 1)}`;
    expect(decryptShareToken(tampered, key)).toBeNull();
  });

  it("returns null with another key, or on garbage", () => {
    const sealed = encryptShareToken("abcdefghijklmnopqrstuv", key);
    expect(decryptShareToken(sealed, randomBytes(32))).toBeNull();
    expect(decryptShareToken("nonsense", key)).toBeNull();
    expect(decryptShareToken("v2.a.b.c", key)).toBeNull();
  });

  it("parses a key of exactly 32 bytes in base64 only", () => {
    expect(parseShareLinkKey(randomBytes(32).toString("base64")).length).toBe(32);
    expect(() => parseShareLinkKey(randomBytes(31).toString("base64"))).toThrow();
    expect(() => parseShareLinkKey(randomBytes(33).toString("base64"))).toThrow();
    expect(() => parseShareLinkKey("")).toThrow();
  });
});
