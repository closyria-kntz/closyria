import { z } from "zod";

export const healthSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  env: z.string(),
  version: z.string(),
  database: z.enum(["ok", "error"]),
});

export type Health = z.infer<typeof healthSchema>;
