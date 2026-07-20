import { defineConfig } from "@playwright/test";

const staticExport = process.env.E2E_STATIC_EXPORT === "1";
const baseURL =
  process.env.E2E_BASE_URL ??
  (staticExport ? "http://127.0.0.1:3006" : "http://127.0.0.1:3005");

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: "test-results",
  retries: process.env.CI ? 2 : 0,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  testDir: "./e2e",
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop-1440", use: { viewport: { height: 900, width: 1440 } } },
    { name: "tablet-768", use: { viewport: { height: 1024, width: 768 } } },
    {
      name: "mobile-320",
      use: {
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
        viewport: { height: 720, width: 320 },
      },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  ...(staticExport
    ? {
        webServer: {
          command:
            "STATIC_EXPORT_ROOT=out node ../../scripts/serve-static-export.mjs",
          reuseExistingServer: !process.env.CI,
          url: "http://127.0.0.1:3006",
        },
      }
    : {}),
});
