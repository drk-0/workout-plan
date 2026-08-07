import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "allow",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "iPhone",
      grepInvert: /@offline/,
      use: { ...devices["iPhone 13"] }
    },
    {
      name: "iPad",
      grepInvert: /@offline/,
      use: { ...devices["iPad (gen 7)"] }
    },
    {
      name: "offline",
      grep: /@offline/,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium"
      }
    }
  ],
  webServer: {
    command: "node scripts/test-server.js",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false
  }
});
