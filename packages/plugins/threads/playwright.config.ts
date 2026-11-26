import * as os from "node:os";
import * as path from "node:path";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";
import { looks } from "./e2e/visual/looks.ts";

// The site the specs run against, outside the repo (see e2e/serve-playground.mjs). The dev server and the test
// workers inherit it.
const site = path.join(os.tmpdir(), "docmd-threads-e2e");
process.env["THREADS_E2E_SITE"] = site;

// The screenshot and contrast suite (e2e/visual) is not part of the default run: it needs one server per look
// (template and colour theme) and its screenshots only match on the platform that made them (Linux, in CI). Run it with
// `THREADS_E2E_VISUAL=1 pnpm exec playwright test --project visual`, and refresh the baselines with `--update-snapshots`
// inside the Playwright Docker image (see e2e/visual/README.md).
const visual = process.env["THREADS_E2E_VISUAL"] === "1";

const webServer: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: "node e2e/serve-playground.mjs 4175",
    url: "http://localhost:4175/",
    reuseExistingServer: false, // serve-playground.mjs reseeds the site on start
    timeout: 120_000,
    cwd: ".", // this package
  },
];
if (visual) {
  for (const look of looks) {
    webServer.push({
      command: `node e2e/serve-playground.mjs ${look.port}`,
      url: `http://localhost:${look.port}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: ".",
      env: {
        THREADS_E2E_SITE: `${site}-${look.name}`,
        THREADS_E2E_TEMPLATE: look.template,
        THREADS_E2E_THEME: look.theme,
      },
    });
  }
}

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
      testIgnore: "visual/**",
      use: { browserName: "chromium" },
    },
    ...(visual
      ? [
          {
            name: "visual",
            testMatch: "visual/**/*.spec.ts",
            use: { browserName: "chromium" as const, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
            expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" as const } },
            snapshotPathTemplate: "{testDir}/visual/__screenshots__/{arg}{ext}",
          },
        ]
      : []),
  ],
  webServer,
});
