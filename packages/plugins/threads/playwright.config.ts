import * as os from "node:os";
import * as path from "node:path";
import { defineConfig } from "@playwright/test";

// The site the specs run against, outside the repo (see e2e/serve-playground.mjs). The dev server and the test
// workers inherit it.
process.env["THREADS_E2E_SITE"] = path.join(os.tmpdir(), "docmd-threads-e2e");

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:4175",
    headless: true,
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "node e2e/serve-playground.mjs 4175",
    url: "http://localhost:4175/",
    reuseExistingServer: false, // serve-playground.mjs reseeds the site on start
    timeout: 120_000,
    cwd: ".", // this package
  },
});
