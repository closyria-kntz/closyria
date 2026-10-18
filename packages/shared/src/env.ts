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

export const appEnvSchema = z.enum(["development", "dev", "prod"]);
export type AppEnv = z.infer<typeof appEnvSchema>;
