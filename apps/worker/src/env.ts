import { appEnvObject, parseEnv } from "@closyria/shared";
import { z } from "zod";

export const env = parseEnv(
  appEnvObject({
    APP_VERSION: z.string().default("local"),
    DATABASE_URL: z.string().min(1),
  }),
);
