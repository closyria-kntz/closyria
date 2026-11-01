import { passkey } from "@better-auth/passkey";
import type { Database } from "@closyria/db";
import { schema } from "@closyria/db";
import { loadMessages } from "@closyria/i18n";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { anonymous, emailOTP } from "better-auth/plugins";
import { count, eq } from "drizzle-orm";
import { type AuthMethod, authMethodFor } from "./auth-method";
import { consumeEmailSend } from "./email-limit";
import type { Mailer, MailMessage } from "./mailer";
import { reassignUserData } from "./owned-data";

/** Spec §9: 6 digits, valid 10 minutes, 5 attempts. */
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 600;
export const OTP_ALLOWED_ATTEMPTS = 5;

export type OAuthClient = { clientId: string; clientSecret: string };

export type AuthDeps = {
  db: Database;
  mailer: Mailer;
  baseUrl: string;
  secret: string;
  /** A provider is enabled only when its credentials are given. */
  social?: { google?: OAuthClient; apple?: OAuthClient };
};

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Passkey routes that add, rename or remove a passkey. */
const PASSKEY_MANAGEMENT_PATHS = new Set([
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/update-passkey",
  "/passkey/delete-passkey",
]);

/** Audit line for the admin's passkeys: the user id only, no other personal data. */
function logAdminPasskeyEvent(event: "admin.passkey.registered" | "admin.passkey.deleted", userId: string) {
  console.info(JSON.stringify({ event, userId }));
}

/** Apple posts its sign-in callback (form_post) from this origin. */
const APPLE_ORIGIN = "https://appleid.apple.com";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The sign-in code e-mail, in French (the only enabled locale). */
export function codeEmail(to: string, code: string): MailMessage {
  const t = loadMessages("fr").Auth.email;
  const lines = [t.greeting, t.codeIntro, code, t.validity, t.ignore];
  return {
    to,
    subject: t.subject,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${line === code ? `<strong>${code}</strong>` : escapeHtml(line)}</p>`).join("\n"),
  };
}

/** Better Auth options; also read by the Better Auth CLI to generate the Drizzle schema. */
export function authOptions(deps: AuthDeps) {
  const { google, apple } = deps.social ?? {};
  const origin = new URL(deps.baseUrl);
  return {
    appName: "Closyria",
    baseURL: deps.baseUrl,
    secret: deps.secret,
    database: drizzleAdapter(deps.db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    trustedOrigins: apple ? [APPLE_ORIGIN] : [],
    socialProviders: {
      ...(google ? { google: { clientId: google.clientId, clientSecret: google.clientSecret } } : {}),
      ...(apple ? { apple: { clientId: apple.clientId, clientSecret: apple.clientSecret } } : {}),
    },
    user: {
      additionalFields: {
        // Promotion to admin is a one-off SQL statement (deploy/README.md): never settable through the API.
        role: { type: [...USER_ROLES], required: true, defaultValue: "user", input: false },
      },
    },
    session: {
      additionalFields: {
        // How the session was opened. The admin area requires "passkey" (spec §8).
        authMethod: { type: "string", required: true, input: false },
      },
    },
    // Closyria has no password: close the emailOTP routes that reset one or change the e-mail.
    disabledPaths: [
      "/email-otp/request-password-reset",
      "/forget-password/email-otp",
      "/email-otp/reset-password",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    // Stored in the database so limits hold across restarts and processes.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      // Explicit in tests too, where Better Auth would otherwise skip the Origin/CSRF check.
      disableOriginCheck: false,
      // The API sits behind Caddy on the same machine: trust its X-Forwarded-For only.
      ipAddress: { trustedProxies: ["127.0.0.1/32", "::1/128"] },
    },
    databaseHooks: {
      session: {
        // No IP address stored on sessions (spec §9). The user agent is kept for the session list.
        // The sign-in method comes from the endpoint that creates the session; unknown ones are refused.
        create: {
          before: async (session, ctx) => ({
            data: { ...session, ipAddress: null, authMethod: authMethodFor(ctx) satisfies AuthMethod },
          }),
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // An anonymous sign-in with a valid session cookie keeps that session: no duplicate
        // anonymous user, and a signed-in account is never swapped for an anonymous one.
        if (ctx.path === "/sign-in/anonymous") {
          const current = await getSessionFromCtx(ctx, { disableRefresh: true });
          if (current) return ctx.json({ token: current.session.token, user: current.user });
        }
        if (PASSKEY_MANAGEMENT_PATHS.has(ctx.path)) {
          const current = await getSessionFromCtx(ctx, { disableRefresh: true });
          // A passkey belongs to an account: an anonymous user has nothing to protect with it yet.
          if (current?.user.isAnonymous) {
            throw new APIError("FORBIDDEN", { message: "Sign in with your e-mail before adding a passkey." });
          }
          // R12: once an admin has a passkey, only a passkey session may manage passkeys, so that
          // access to the admin's mailbox is not enough to reach the admin area. The first passkey
          // (bootstrap) may be registered from any fresh session.
          const role: unknown = (current?.user as { role?: unknown } | undefined)?.role;
          const method: unknown = (current?.session as { authMethod?: unknown } | undefined)?.authMethod;
          if (current && role === "admin" && method !== "passkey") {
            const [row] = await deps.db
              .select({ n: count() })
              .from(schema.passkey)
              .where(eq(schema.passkey.userId, current.user.id));
            if ((row?.n ?? 0) > 0) {
              throw new APIError("FORBIDDEN", { message: "Sign in with a passkey to manage passkeys." });
            }
          }
          // Registering proves a session, not possession of the passkey: it must not open a passkey session.
          if (ctx.body?.createSession) {
            throw new APIError("BAD_REQUEST", { message: "Registering a passkey does not open a session." });
          }
        }
        if (ctx.path === "/email-otp/send-verification-otp") {
          // Codes only ever serve to sign in: no password, no separate e-mail verification.
          if (ctx.body?.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Only sign-in codes are available." });
          }
          // Per e-mail limit, on top of Better Auth's per-IP limit (spec §9).
          const email: unknown = ctx.body?.email;
          if (typeof email === "string" && !(await consumeEmailSend(deps.db, email, deps.secret))) {
            throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes requested for this address." });
          }
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/passkey/verify-registration" && ctx.path !== "/passkey/delete-passkey") return;
        const returned: unknown = ctx.context.returned;
        if (isAPIError(returned)) {
          // The plugin answers 500 for any registration that fails verification (wrong origin,
          // forged response): that is a bad request, not a server fault. Only a Response object
          // replaces the status: a thrown error or ctx.json() would keep the original 500.
          if (ctx.path === "/passkey/verify-registration" && returned.statusCode === 500) {
            return new Response(JSON.stringify(returned.body ?? { message: "The passkey could not be verified." }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          return;
        }
        const current = await getSessionFromCtx(ctx, { disableRefresh: true });
        if ((current?.user as { role?: unknown } | undefined)?.role !== "admin" || !current) return;
        const event =
          ctx.path === "/passkey/verify-registration" ? "admin.passkey.registered" : "admin.passkey.deleted";
        logAdminPasskeyEvent(event, current.user.id);
      }),
    },
    plugins: [
      anonymous({
        // Runs on the first sign-in that replaces an anonymous session, before the anonymous
        // user is deleted. `newUser` is the existing account when the e-mail already had one.
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await deps.db.transaction((tx) => reassignUserData(anonymousUser.user.id, newUser.user.id, tx));
        },
      }),
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Second barrier behind disabledPaths and the before hook: only sign-in codes are mailed.
          if (type !== "sign-in") return;
          await deps.mailer.send(codeEmail(email, otp));
        },
      }),
      passkey({
        rpID: origin.hostname,
        rpName: "Closyria",
        // Fixed from BETTER_AUTH_URL rather than read from the request's Origin header.
        origin: origin.origin,
        // User verification (PIN, biometrics) is asked for, then checked on the server below:
        // a passkey is a second factor in itself, not just a touch on a key.
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        registration: {
          afterVerification: ({ verification }) => {
            if (!verification.registrationInfo?.userVerified) {
              throw new APIError("BAD_REQUEST", { message: "The passkey must verify the user." });
            }
          },
        },
        authentication: {
          afterVerification: ({ verification }) => {
            if (!verification.authenticationInfo.userVerified) {
              throw new APIError("UNAUTHORIZED", { message: "The passkey must verify the user." });
            }
          },
        },
      }),
    ],
  } satisfies Parameters<typeof betterAuth>[0];
}

export function createAuth(deps: AuthDeps) {
  const auth = betterAuth(authOptions(deps));
  return {
    handler: auth.handler,
    api: auth.api,
    /** The session for the request's cookies, or null. For API routes. */
    getSession: async (headers: Headers) => (await auth.api.getSession({ headers })) ?? null,
  };
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = NonNullable<Awaited<ReturnType<Auth["getSession"]>>>;
