import { defineConfig } from "vitest/config";

// Per-package module cache: the default (workspace-root node_modules/.vitest-cache) is shared by every
// concurrent vitest process, and one of them wipes it when the lockfile changed (ENOTEMPTY for the others).
export default defineConfig({
  test: { globalSetup: ["./src/global-setup.ts"], fsModuleCachePath: "node_modules/.vitest-cache" },
});
