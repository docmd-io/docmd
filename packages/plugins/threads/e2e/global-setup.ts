/**
 * Record the clean page's `<main>` for cleanThreads. Playwright starts the webServer before
 * global setup, so this is the page serve-playground.mjs just seeded from the fixture.
 */

import type { FullConfig } from "@playwright/test";
import { mainOf } from "./helpers.ts";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("e2e: playwright.config.ts sets no baseURL");
  const res = await fetch(new URL("/", baseURL));
  if (!res.ok) throw new Error(`e2e: GET / returned ${res.status}`);
  process.env["THREADS_E2E_CLEAN_MAIN"] = mainOf(await res.text());
}
