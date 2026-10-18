import { appEnvSchema, parseEnv } from "@closyria/shared";
import { z } from "zod";

export const env = parseEnv(
  z.object({
    APP_ENV: appEnvSchema.default("development"),
    APP_VERSION: z.string().default("local"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
  }),
);
