import type { Database } from "@closyria/db";
import { schema } from "@closyria/db";
import { loadMessages } from "@closyria/i18n";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { anonymous, emailOTP } from "better-auth/plugins";
import type { Mailer, MailMessage } from "./mailer";
import { reassignUserData } from "./owned-data";

/** Spec §9: 6 digits, valid 10 minutes, 5 attempts. */
export const OTP_LENGTH = 6;
export const OTP_EXPIRES_IN_SECONDS = 600;
export const OTP_ALLOWED_ATTEMPTS = 5;

export type AuthDeps = { db: Database; mailer: Mailer; baseUrl: string; secret: string };

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
  return {
    baseURL: deps.baseUrl,
    secret: deps.secret,
    database: drizzleAdapter(deps.db, { provider: "pg", schema }),
    telemetry: { enabled: false },
    // Stored in the database so limits hold across restarts and processes.
    rateLimit: { enabled: true, storage: "database" },
    hooks: {
      // An anonymous sign-in with a valid session cookie keeps that session: no duplicate
      // anonymous user, and a signed-in account is never swapped for an anonymous one.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/anonymous") return;
        const current = await getSessionFromCtx(ctx, { disableRefresh: true });
        if (current) return ctx.json({ token: current.session.token, user: current.user });
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
        sendVerificationOTP: async ({ email, otp }) => {
          await deps.mailer.send(codeEmail(email, otp));
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
