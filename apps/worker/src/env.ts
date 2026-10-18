import { appEnvSchema, parseEnv } from "@closyria/shared";
import { z } from "zod";

export const env = parseEnv(
  z.object({
    APP_ENV: appEnvSchema.default("development"),
    APP_VERSION: z.string().default("local"),
    DATABASE_URL: z.string().min(1),
  }),
);
