import { appEnvObject, parseEnv } from "@closyria/shared";
import { z } from "zod";

const S3_VARIABLES = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

export const envSchema = appEnvObject({
  APP_VERSION: z.string().default("local"),
  DATABASE_URL: z.string().min(1),
  // Photos (OVH Object Storage, S3-compatible), same variables as the API. Without them, local development
  // keeps photos in memory.
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
}).superRefine((env, ctx) => {
  // The memory store is for development only; a partial S3 configuration is always a mistake.
  const s3Set = S3_VARIABLES.filter((name) => env[name]);
  if (env.APP_ENV !== "development" || s3Set.length > 0) {
    for (const name of S3_VARIABLES.filter((n) => !env[n])) {
      ctx.addIssue({ code: "custom", path: [name], message: "required (all S3_* variables go together)" });
    }
  }
});

export const env = parseEnv(envSchema);
