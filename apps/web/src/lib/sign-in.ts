/** Where to go after signing in: a same-origin relative path only (no open redirect), else the home page. */
export function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  // Backslashes and control characters are normalised away by browsers (`/\evil.example`): refuse them.
  if (value.includes("\\") || [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return "/";
  const base = "https://closyria.invalid";
  const url = new URL(value, base);
  if (url.origin !== base) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

export const isSixDigitCode = (value: string): boolean => /^\d{6}$/.test(value);

/** The parts of a Better Auth client error the page reads. */
export type AuthError = { status?: number; code?: string | undefined } | null | undefined;

export type SendErrorKey = "tooManyRequests" | "sendFailed";
export type CodeErrorKey = "invalidCode" | "expiredCode" | "tooManyAttempts" | "tooManyRequests" | "signInFailed";

/** Message key for a refused code request (`SignIn.errors.*`). */
export function sendErrorKey(error: AuthError): SendErrorKey {
  return error?.status === 429 ? "tooManyRequests" : "sendFailed";
}

/** Message key for a refused code (`SignIn.errors.*`). */
export function codeErrorKey(error: AuthError): CodeErrorKey {
  if (error?.status === 429) return "tooManyRequests";
  switch (error?.code) {
    case "INVALID_OTP":
      return "invalidCode";
    case "OTP_EXPIRED":
      return "expiredCode";
    case "TOO_MANY_ATTEMPTS":
      return "tooManyAttempts";
    default:
      return "signInFailed";
  }
}
