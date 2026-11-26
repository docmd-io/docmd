/**
 * Screenshots and colour contrast of the threads UI in every look it ships with: the default template with no theme
 * and with each colour theme (retro, ruby, sky), and the summer template, each in light and dark mode.
 *
 * Not part of the default run: see playwright.config.ts (`THREADS_E2E_VISUAL=1`). The site is the fixture's three
 * seeded threads (two comments, one comment, and a resolved thread), so nothing is written and the pictures are the
 * same on every run. Fonts are not fetched, the clock is frozen and animations are off.
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { looks } from "./looks.ts";

const modes = ["light", "dark"] as const;

// Where the servers are, as the browser sees them. A browser in a container (how the Linux baselines are made, see
// README.md) reaches the host's servers as `host.docker.internal`.
const host = process.env["THREADS_E2E_VISUAL_HOST"] ?? "localhost";

async function open(page: Page, mode: (typeof modes)[number]): Promise<void> {
  // No request leaves the machine (the theme's web fonts fall back to the system's)
  await page.route(
    (url) => url.hostname !== host && url.hostname !== "localhost" && url.protocol.startsWith("http"),
    (route) => route.abort(),
  );
  await page.clock.install({ time: new Date("2026-03-10T12:00:00Z") });
  await page.addInitScript((m) => {
    try {
      localStorage.setItem("docmd-theme", m);
    } catch {
      /* private mode: the page falls back to its default */
    }
  }, mode);
  await page.goto("/");
  await expect(page.locator("threads-thread[variant='inline'][data-thread-id='t-thread1']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".threads-sidebar").first()).toBeHidden();
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }" });
  await page.evaluate(() => document.fonts.ready);
}

for (const look of looks) {
  for (const mode of modes) {
    test.describe(`${look.name} ${mode}`, () => {
      test.use({ baseURL: `http://${host}:${look.port}` });

      test("an inline card", async ({ page }) => {
        await open(page, mode);
        const card = page.locator("threads-thread[variant='inline'][data-thread-id='t-thread1']");
        await card.scrollIntoViewIfNeeded();
        await expect(card).toHaveScreenshot(`${look.name}-${mode}-card.png`);
      });

      test("the open panel", async ({ page }) => {
        await open(page, mode);
        await page.getByRole("button", { name: "Open threads panel" }).click();
        await expect(page.locator("body.tc-panel-open")).toBeAttached();
        const panel = page.locator('threads-panel [part~="panel"]');
        await expect(page.locator("threads-panel threads-thread[data-thread-id='t-thread1']")).toBeVisible();
        await expect(panel).toHaveScreenshot(`${look.name}-${mode}-panel.png`);
      });

      test("text and controls have enough contrast", async ({ page }) => {
        await open(page, mode);
        await page.getByRole("button", { name: "Open threads panel" }).click();
        await expect(page.locator("body.tc-panel-open")).toBeAttached();
        // axe looks into shadow roots; only the plugin's own elements are in scope (the theme's are not ours to fix)
        const results = await new AxeBuilder({ page })
          .include("threads-panel")
          .include("threads-thread")
          .withRules(["color-contrast"])
          .analyze();
        const report = results.violations.flatMap((v) =>
          v.nodes.map((n) => `${n.target.join(" ")}: ${n.any[0]?.message ?? v.help}`),
        );
        expect(report).toEqual([]);
      });
    });
  }
}
