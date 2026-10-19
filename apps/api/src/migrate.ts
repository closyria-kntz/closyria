import { existsSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "@closyria/db";
import { parseEnv } from "@closyria/shared";
import { z } from "zod";

// Applies pending SQL migrations. Run by the deploy script before services restart.
const env = parseEnv(z.object({ DATABASE_URL: z.string().min(1), MIGRATIONS_DIR: z.string().min(1) }));

if (existsSync(join(env.MIGRATIONS_DIR, "meta", "_journal.json"))) {
  await runMigrations(env.DATABASE_URL, env.MIGRATIONS_DIR);
  console.log("migrations applied");
} else {
  console.log("no migrations to apply");
}
