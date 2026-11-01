import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: "esm",
  platform: "node",
  target: "node26",
  // Self-contained bundle: releases on the server need no node_modules.
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: ["pg-native"],
    onlyBundle: false,
  },
  // Shared chunks (zod, better-auth's lazy adapters) otherwise import each other in a cycle
  // and run before the runtime helpers they need are defined.
  outputOptions: { strictExecutionOrder: true },
  dts: false,
  sourcemap: true,
});
