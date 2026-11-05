import { defineConfig } from "vitest/config";

// One PostgreSQL server and one migrated template per package run (packages/testing/src/global-setup.ts).
// The capture tests use the fake shop and an injected DNS lookup, never the Internet.
export default defineConfig({ test: { globalSetup: ["../../packages/testing/src/global-setup.ts"] } });
