import { APIError } from "better-auth/api";

export const AUTH_METHODS = ["anonymous", "email-otp", "google", "apple", "passkey"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** The parts of a Better Auth endpoint context that tell how a session is being opened. */
export type SessionOrigin = {
  path?: string | undefined;
  params?: Record<string, unknown> | undefined;
  body?: unknown;
} | null;

const SOCIAL = new Set<unknown>(["google", "apple"] satisfies AuthMethod[]);

/**
 * The sign-in method of a session, from the endpoint creating it (`ctx.path` is the route
 * template). Any other way to create a session is refused: an unlisted path must never
 * produce a session whose method could be mistaken for another.
 */
export function authMethodFor(ctx: SessionOrigin): AuthMethod {
  switch (ctx?.path) {
    case "/sign-in/anonymous":
      return "anonymous";
    case "/sign-in/email-otp":
      return "email-otp";
    case "/passkey/verify-authentication":
      return "passkey";
    case "/callback/:id": {
      // OAuth redirect back from Google or Apple (GET, or Apple's form_post).
      const provider = ctx.params?.id;
      if (SOCIAL.has(provider)) return provider as AuthMethod;
      break;
    }
    case "/sign-in/social": {
      // Native apps sign in with the provider's ID token directly.
      const provider = (ctx.body as { provider?: unknown } | undefined)?.provider;
      if (SOCIAL.has(provider)) return provider as AuthMethod;
      break;
    }
  }
  throw new APIError("FORBIDDEN", { message: "This endpoint cannot open a session." });
}
