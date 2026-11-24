/**
 * Discarding the open review: draft a comment, Discard asks first (Cancel keeps it), Confirm drops
 * the draft from the widget and the page without touching the markdown or writing a manifest.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { cleanThreads, setAuthor } from "./helpers.ts";

const site = process.env["THREADS_E2E_SITE"]!;
const index = safePath(site, "docs/index.md");
const manifests = safePath(site, "docs/.threads/reviews");

test("Discard asks first, then drops the drafts and leaves the markdown and manifests alone", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { timeout: 10_000 });
  const before = fs.readFileSync(index);
  const drafted = page.getByText("to be discarded");

  const quote = await page.evaluate(() =>
    (document.querySelector("main p, .content p, article p") as HTMLElement).textContent!.trim().split(" ").slice(0, 3).join(" "));
  await page.evaluate(
    ({ quote }) =>
      docmd.call("threads:add-thread", {
        file: document.body.dataset["sourceFile"],
        anchor: { quote, prefix: null, suffix: null, selector: null, offset: null, blockText: null },
        author: "TestUser",
        authorKey: "testuser",
        body: "to be discarded",
      }),
    { quote },
  );
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { timeout: 10_000 });

  const count = page.getByTestId("tpw-count");
  const open = page.getByTestId("discard-open");
  await expect(count).toHaveText("1 unpublished comment");
  // A draft has no highlight in the served markdown: it shows as a card in the sidebar panel.
  await page.locator(".threads-fab").click();
  await expect(drafted.first()).toBeVisible();

  // Cancel closes the dialog and changes nothing.
  await open.click();
  await expect(page.getByTestId("discard-dialog")).toBeVisible();
  await page.getByTestId("discard-cancel").click();
  await expect(page.getByTestId("discard-dialog")).toBeHidden();
  await expect(count).toHaveText("1 unpublished comment");

  // Confirm empties the review and the page.
  await open.click();
  await page.getByTestId("discard-confirm").click();
  await expect(count).toHaveText("0 unpublished comments");
  await expect(drafted).toHaveCount(0);
  await expect(open).toHaveCount(0);

  expect(fs.readFileSync(index).equals(before)).toBe(true);
  expect(fs.existsSync(manifests)).toBe(false);
});
