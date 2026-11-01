import { defineConfig } from "vitest/config";

// One PostgreSQL server and one migrated template per package run (packages/testing/src/global-setup.ts).
export default defineConfig({ test: { globalSetup: ["../../packages/testing/src/global-setup.ts"] } });
