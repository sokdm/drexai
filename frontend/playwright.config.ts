import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173", channel: "chrome", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  reporter: "list"
});
