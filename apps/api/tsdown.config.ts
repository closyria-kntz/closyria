import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/migrate.ts"],
  format: "esm",
  platform: "node",
  target: "node26",
  // Self-contained bundle, except sharp: it loads a native libvips build that cannot be bundled.
  // deploy/build.sh ships sharp and its linux-x64 binaries in the release's api/node_modules.
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: ["pg-native", "sharp"],
    onlyBundle: false,
  },
  // Shared chunks (zod, better-auth's lazy adapters) otherwise import each other in a cycle
  // and run before the runtime helpers they need are defined.
  outputOptions: { strictExecutionOrder: true },
  dts: false,
  sourcemap: true,
});
