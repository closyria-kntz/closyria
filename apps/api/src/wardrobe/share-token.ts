import { createHash, randomBytes } from "node:crypto";

/** 16 random bytes in base64url: always 22 characters. */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** SHA-256 of the token, hex: the only thing stored. Lookup is by hash, so no constant-time comparison is needed. */
export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A new unguessable share token (128 random bits) and the hash to store. */
export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(16).toString("base64url");
  return { token, hash: hashShareToken(token) };
}
