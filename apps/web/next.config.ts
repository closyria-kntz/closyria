import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const config: NextConfig = {
  // Self-contained server in .next/standalone, deployed without node_modules.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: ["@closyria/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
