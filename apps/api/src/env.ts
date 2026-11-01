import { appEnvSchema } from "@closyria/shared";
import { z } from "zod";

/** "Name <address>" → { name, email }. */
const mailSender = z
  .string()
  .regex(/^[^<>]+<[^<>\s]+>$/, "expected “Name <address>”")
  .transform((value) => {
    const [name = "", email = ""] = value.slice(0, -1).split("<");
    return { name: name.trim(), email: email.trim() };
  })
  .pipe(z.object({ name: z.string().min(1), email: z.email() }));

export const envSchema = z
  .object({
    APP_ENV: appEnvSchema.default("development"),
    APP_VERSION: z.string().default("local"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    MAIL_TRANSPORT: z.enum(["brevo", "memory"]).optional(),
    BREVO_API_KEY: z.string().min(1).optional(),
    MAIL_FROM: mailSender.prefault("Closyria <bonjour@closyria.com>"),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === "prod" && env.MAIL_TRANSPORT !== "brevo") {
      ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "must be brevo in prod" });
    }
    if (env.MAIL_TRANSPORT === "brevo" && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["BREVO_API_KEY"], message: "required when MAIL_TRANSPORT is brevo" });
    }
    // Better Auth marks cookies secure for https URLs: required everywhere but local development.
    if (env.APP_ENV !== "development" && !env.BETTER_AUTH_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be https outside development" });
    }
  })
  .transform((env) => ({ ...env, MAIL_TRANSPORT: env.MAIL_TRANSPORT ?? "memory" }));

export type Env = z.infer<typeof envSchema>;
