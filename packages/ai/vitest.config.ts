import { defineConfig } from "vitest/config";

// One PostgreSQL server and one migrated template per package run (packages/testing/src/global-setup.ts): the
// monthly budget is kept in the database. The model is never called: the tests inject a fake client.
// Per-package module cache: the default (workspace-root node_modules/.vitest-cache) is shared by every
// concurrent vitest process, and one of them wipes it when the lockfile changed (ENOTEMPTY for the others).
export default defineConfig({
  test: {
    globalSetup: ["../../packages/testing/src/global-setup.ts"],
    fsModuleCachePath: "node_modules/.vitest-cache",
  },
});
