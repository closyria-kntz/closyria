import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node26",
  // Self-contained bundle, except sharp (photos): it loads a native libvips build that cannot be bundled.
  // deploy/build.sh ships sharp and its linux-x64 binaries in the release's worker/node_modules.
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: ["pg-native", "sharp"],
    onlyBundle: false,
  },
  dts: false,
  sourcemap: true,
});
