import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** SHARE_LINK_KEY: base64 of exactly 32 bytes (AES-256). */
export function parseShareLinkKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value.trim()) {
    throw new Error("SHARE_LINK_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

/** AES-256-GCM: `v1.<iv>.<tag>.<data>`, each part base64url. Lets the owner see her link again. */
export function encryptShareToken(token: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

/** The token, or null when the value was altered, comes from another key, or is not in this format. */
export function decryptShareToken(value: string, key: Buffer): string | null {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined || extra !== undefined) return null;
  try {
    const ivBytes = Buffer.from(iv, "base64url");
    const tagBytes = Buffer.from(tag, "base64url");
    if (ivBytes.length !== IV_BYTES || tagBytes.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, ivBytes);
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
