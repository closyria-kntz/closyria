import { defineConfig } from "vitest/config";

// Per-package module cache: the default (workspace-root node_modules/.vitest-cache) is shared by every
// concurrent vitest process, and one of them wipes it when the lockfile changed (ENOTEMPTY for the others).
export default defineConfig({
  test: {
    fsModuleCachePath: "node_modules/.vitest-cache",
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.ts"],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
