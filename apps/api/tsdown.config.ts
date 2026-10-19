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
  dts: false,
  sourcemap: true,
});
