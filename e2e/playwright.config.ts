import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys of chantier 0. The global setup starts the whole stack (disposable database, built API
 * and web app, same-origin proxy) on free ports; `pnpm e2e` builds first. Chromium only, also for the
 * iPhone 15 and iPad (gen 7) profiles (viewport, touch, user agent): CI installs a single browser.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./fixtures/global-setup.ts",
  outputDir: "./reports/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [[process.env.CI ? "github" : "list"], ["html", { outputFolder: "./reports/html", open: "never" }]],
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "iPhone 15", use: { ...devices["iPhone 15"], browserName: "chromium" } },
    { name: "iPad (gen 7)", use: { ...devices["iPad (gen 7)"], browserName: "chromium" } },
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
  ],
});
