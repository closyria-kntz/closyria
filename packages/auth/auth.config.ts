// Read by the Better Auth CLI to generate packages/db/src/schema/auth.ts:
//   pnpm --filter @closyria/auth auth:generate
import { type Database, schema } from "@closyria/db";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { memoryMailer } from "./src/mailer";
import { authOptions } from "./src/server";

export const auth = betterAuth(
  authOptions({
    // Schema generation never queries: a mock client stands in for the pool.
    db: drizzle.mock({ schema }) as unknown as Database,
    mailer: memoryMailer(),
    baseUrl: "http://localhost:3001",
    secret: "schema-generation-only-not-a-real-secret",
  }),
);
