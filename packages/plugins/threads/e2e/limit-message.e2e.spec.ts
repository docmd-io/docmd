/**
 * A write rejected for length shows a message in the comment box that holds the text.
 * One test walks the three boxes: New Thread under a heading, a selection's popover, New Comment on a thread.
 */

import { test, expect, type Page } from "@playwright/test";
import { cleanThreads, emptyOpenReview, setAuthor, waitForReload } from "./helpers.ts";

const identity = { author: "TestUser", authorKey: "testuser" };
const TOO_LONG = "This comment is too long. Shorten it and try again.";
const contentSelector = "[data-docmd-content] p, .docmd-content p, article p, main p";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await waitForReload(page);
  await emptyOpenReview(page);
});

test.afterEach(async ({ page }) => {
  await cleanThreads(page);
  await emptyOpenReview(page);
});

const journalOps = (page: Page) =>
  page.evaluate(async (id) => (await docmd.call("threads:whoami", id)).journal?.ops ?? [], identity);

/** Submit `text` in the open box and expect the limit message, the text kept and Submit usable again. */
async function expectRejected(page: Page, text: string, opsBefore: unknown[]): Promise<void> {
  const editor = page.locator("threads-inline-editor");
  await editor.waitFor({ state: "attached", timeout: 5_000 });
  const textarea = editor.locator("sl-textarea").locator("textarea");
  await textarea.waitFor({ timeout: 5_000 });
  await textarea.fill(text);
  const submit = editor.locator("sl-button[variant='primary']");
  await submit.click();

  await expect(editor.getByTestId("editor-message")).toHaveText(TOO_LONG, { timeout: 10_000 });
  await expect(editor).toHaveCount(1);
  await expect(textarea).toHaveValue(text);
  await expect(submit).not.toHaveAttribute("disabled", /.*/);
  await expect(submit).toHaveText("Submit");
  expect(await journalOps(page)).toEqual(opsBefore);
}

test("a body over the character limit leaves each box open with a message and the text", async ({ page }) => {
  const long = "x".repeat(5001);
  const opsBefore = await journalOps(page);

  // New Thread under a heading
  await page.locator(".threads-new-thread-btn").first().click();
  await expectRejected(page, long, opsBefore);
  await page.locator("threads-inline-editor").locator("sl-button[variant='neutral']").click();
  await expect(page.locator("threads-inline-editor")).toHaveCount(0);

  // A selection's add-comment popover
  await page.waitForSelector(contentSelector, { timeout: 5_000 });
  const paragraph = ((await page.locator(contentSelector).first().textContent()) ?? "").trim();
  expect(paragraph.length).toBeGreaterThan(5);
  const quote = paragraph.slice(0, 20);
  await page.locator(contentSelector).first().evaluate((el, q) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? "").indexOf(q);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(n, i);
      range.setEnd(n, i + q.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
  }, quote);
  const addComment = page.locator("threads-popover").getByText("Add comment");
  await addComment.waitFor({ state: "visible", timeout: 5_000 });
  await addComment.click();
  await expectRejected(page, long, opsBefore);

  // A shorter text in the same box succeeds and the box closes
  const editor = page.locator("threads-inline-editor");
  await editor.locator("sl-textarea").locator("textarea").fill("A short comment");
  await editor.locator("sl-button[variant='primary']").click();
  await editor.waitFor({ state: "detached", timeout: 10_000 });
  const thread = page.locator(".threads-thread[data-thread-id]").first();
  await expect(thread.getByText("A short comment")).toBeVisible({ timeout: 10_000 });

  // New Comment on that thread
  const opsWithThread = await journalOps(page);
  await thread.locator(".threads-new-comment-btn").first().click();
  await expectRejected(page, long, opsWithThread);

  await page.locator("threads-inline-editor").locator("sl-button[variant='neutral']").click();
  await expect(page.locator("threads-inline-editor")).toHaveCount(0);
});
