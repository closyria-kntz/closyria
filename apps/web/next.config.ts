import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const config: NextConfig = {
  // Self-contained server in .next/standalone, deployed without node_modules.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: ["@closyria/shared", "@closyria/i18n"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withNextIntl(config);
