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

const S3_VARIABLES = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

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
    // Social sign-in: each provider is enabled only when both its variables are set.
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    APPLE_CLIENT_ID: z.string().min(1).optional(),
    APPLE_CLIENT_SECRET: z.string().min(1).optional(),
    // Photos (OVH Object Storage, S3-compatible). Without them, local development keeps photos in memory.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    // Only local development may keep codes in memory; dev.closyria.com and prod send real e-mails.
    // (appEnvSchema has no "test" value: tests build their mailer directly.)
    if (env.APP_ENV !== "development" && env.MAIL_TRANSPORT !== "brevo") {
      ctx.addIssue({ code: "custom", path: ["MAIL_TRANSPORT"], message: "must be brevo outside development" });
    }
    if (env.MAIL_TRANSPORT === "brevo" && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["BREVO_API_KEY"], message: "required when MAIL_TRANSPORT is brevo" });
    }
    for (const [id, secret] of [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["APPLE_CLIENT_ID", "APPLE_CLIENT_SECRET"],
    ] as const) {
      if (Boolean(env[id]) !== Boolean(env[secret])) {
        const missing = env[id] ? secret : id;
        ctx.addIssue({ code: "custom", path: [missing], message: `${id} and ${secret} go together` });
      }
    }
    // Photos must survive restarts outside local development; a partial S3 configuration is always a mistake.
    const s3Set = S3_VARIABLES.filter((name) => env[name]);
    if (env.APP_ENV !== "development" || s3Set.length > 0) {
      for (const name of S3_VARIABLES.filter((n) => !env[n])) {
        ctx.addIssue({ code: "custom", path: [name], message: "required (all S3_* variables go together)" });
      }
    }
    // Better Auth marks cookies secure for https URLs: required everywhere but local development.
    if (env.APP_ENV !== "development" && !env.BETTER_AUTH_URL.startsWith("https://")) {
      ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_URL"], message: "must be https outside development" });
    }
  })
  .transform((env) => ({ ...env, MAIL_TRANSPORT: env.MAIL_TRANSPORT ?? "memory" }));

export type Env = z.infer<typeof envSchema>;
