import { defineConfig } from "vitest/config";

// No database here: the capture tests use the fake shop and an injected DNS lookup, never the Internet.
export default defineConfig({ test: {} });
