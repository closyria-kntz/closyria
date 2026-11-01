import { z } from "zod";

/**
 * Validates environment variables against a schema at startup.
 * Exits with a readable message instead of failing later with an obscure error.
 */
export function parseEnv<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv = process.env): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    console.error(`Invalid configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

/** `test`: the browser tests (e2e), on a disposable database with codes kept in memory. */
export const appEnvSchema = z.enum(["development", "test", "dev", "prod"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

/**
 * An environment schema with APP_ENV. `development` is only a default outside production builds: with
 * NODE_ENV=production (every systemd unit), APP_ENV must be set explicitly, so a forgotten variable never
 * runs prod as development (memory mailer, no S3…).
 */
export function appEnvObject<S extends z.ZodRawShape>(shape: S) {
  return z
    .object({ ...shape, APP_ENV: appEnvSchema.optional(), NODE_ENV: z.string().optional() })
    .superRefine((env, ctx) => {
      const { APP_ENV, NODE_ENV } = env as { APP_ENV?: AppEnv; NODE_ENV?: string };
      if (NODE_ENV === "production" && !APP_ENV) {
        ctx.addIssue({ code: "custom", path: ["APP_ENV"], message: "required when NODE_ENV=production" });
      }
    })
    .transform((env) => ({ ...env, APP_ENV: ((env as { APP_ENV?: AppEnv }).APP_ENV ?? "development") as AppEnv }));
}
