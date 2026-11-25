/**
 * Discarding the open review: draft a comment, Discard asks first (Cancel keeps it), Confirm drops
 * the draft from the widget and the page without touching the markdown or writing a manifest.
 */

import * as fs from "node:fs";
import { test, expect } from "@playwright/test";
import { safePath } from "@docmd/utils";
import { cleanThreads, setAuthor } from "./helpers.ts";
import type { Page } from "@playwright/test";

const site = process.env["THREADS_E2E_SITE"]!;
const index = safePath(site, "docs/index.md");
const manifests = safePath(site, "docs/.threads/reviews");
const identity = { author: "TestUser", authorKey: "testuser" };

/** Empty the caller's open review, so the spec starts from (and leaves behind) a journal with no ops. */
async function emptyOpenReview(page: Page): Promise<number> {
  return page.evaluate(async (id) => {
    const { journal } = await docmd.call("threads:whoami", id);
    if (journal && journal.ops.length > 0) await docmd.call("threads:discard-review", { ...id, reviewId: journal.review.id });
    return (await docmd.call("threads:whoami", id)).journal?.ops.length ?? 0;
  }, identity);
}

const manifestNames = (): string[] => (fs.existsSync(manifests) ? fs.readdirSync(manifests).sort() : []);

test.afterEach(async ({ page }) => {
  expect(await emptyOpenReview(page)).toBe(0);
});

test("Discard asks first, then drops the drafts and leaves the markdown and manifests alone", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  expect(await emptyOpenReview(page)).toBe(0);
  await page.reload();
  await page.waitForSelector("threads-publish-widget", { timeout: 10_000 });
  const before = fs.readFileSync(index);
  const manifestsBefore = manifestNames();
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
  await expect(page.getByTestId("discard-dialog")).toContainText("(1)");
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
  expect(manifestNames()).toEqual(manifestsBefore);
});
