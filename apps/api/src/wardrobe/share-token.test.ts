import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashShareToken, newShareToken, SHARE_TOKEN_PATTERN } from "./share-token";

describe("share token", () => {
  it("is 128 random bits in base64url and differs each time", () => {
    const a = newShareToken();
    const b = newShareToken();
    expect(a.token).toMatch(SHARE_TOKEN_PATTERN);
    expect(Buffer.from(a.token, "base64url")).toHaveLength(16);
    expect(a.token).not.toBe(b.token);
  });

  it("stores the SHA-256 of the token, never the token", () => {
    const { token, hash } = newShareToken();
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toBe(hashShareToken(token));
    expect(hash).not.toContain(token);
  });
});
