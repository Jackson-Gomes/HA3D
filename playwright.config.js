import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", timeout: 30000, workers: 1,
  use: { baseURL: "http://127.0.0.1:8137", headless: true },
  projects: [{ name: "chromium", use: { browserName: "chromium", channel: "msedge" } }],
  webServer: { command: "node tests/server.mjs", url: "http://127.0.0.1:8137/tests/fixture.html", reuseExistingServer: false },
});
