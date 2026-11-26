/**
 * Thread creation tests - adapted from old devtalk.e2e.spec.ts "discussions" block
 * and filters-general.e2e.spec.ts "general comments" block.
 *
 * Changes from old plugin:
 * - "Add comment" popover opens inline editor (not a panel compose form)
 * - "New Thread" button replaces "Add general comment" panel button
 * - WebSocket actions instead of HTTP API for verification
 */

import { test, expect } from "@playwright/test";
import {
  Actor,
  NavigateTo,
  StartThreadOn,
  AddNewThread,
  SelectText,
  TheHighlightCount,
} from "./screenplay.ts";
import { clientKey, cleanThreads, publishReview, setAuthor, waitForReload } from "./helpers.ts";

const contentSelector = "[data-docmd-content] p, .docmd-content p, article p, main p";

let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  // Reload to reflect the clean state
  await waitForReload(page);
});

test.describe("creating threads via text selection", () => {
  test("start a thread by selecting text", async () => {
    await user.perform(NavigateTo.path("/"));
    await user.page.waitForSelector(contentSelector, { timeout: 5_000 });

    const firstParagraph = user.page.locator(contentSelector).first();
    const paragraphText = await firstParagraph.textContent();

    if (!paragraphText || paragraphText.trim().length < 5) {
      test.skip(true, "No suitable text content found to select");
      return;
    }

    const textToSelect = paragraphText.trim().slice(0, 20);

    await user.perform(
      StartThreadOn.on(contentSelector, textToSelect, "This needs clarification"),
    );

    // Wait for page to reload with the new thread
    await waitForReload(user.page);

    // Thread should appear in the content area
    const threads = user.page.locator(".threads-thread[data-thread-id]");
    // Count may include pre-existing threads from markdown, so just check we have at least 1
    const count = await threads.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("highlights appear after creating a thread", async () => {
    await user.perform(NavigateTo.path("/"));
    await user.page.waitForSelector(contentSelector, { timeout: 5_000 });

    const firstParagraph = user.page.locator(contentSelector).first();
    const paragraphText = await firstParagraph.textContent();

    if (!paragraphText || paragraphText.trim().length < 5) {
      test.skip(true, "No suitable text content found");
      return;
    }

    const highlightsBefore = await user.ask(TheHighlightCount.count());

    const textToSelect = paragraphText.trim().slice(0, 15);
    await user.perform(
      StartThreadOn.on(contentSelector, textToSelect, "Highlight test"),
    );

    // The thread is a draft until published; the server renders the highlight once it is
    await publishReview(user.page, "TestUser", await clientKey(user.page));
    await waitForReload(user.page);

    // At least one new highlight should have appeared
    const highlightsAfter = await user.ask(TheHighlightCount.count());
    expect(highlightsAfter).toBeGreaterThan(highlightsBefore);
  });

  test("popover shows 'Add comment' after text selection", async () => {
    await user.perform(NavigateTo.path("/"));
    await user.page.waitForSelector(contentSelector, { timeout: 5_000 });

    const firstParagraph = user.page.locator(contentSelector).first();
    const paragraphText = await firstParagraph.textContent();

    if (!paragraphText || paragraphText.trim().length < 5) {
      test.skip(true, "No suitable text content found");
      return;
    }

    const textToSelect = paragraphText.trim().slice(0, 15);
    await user.perform(SelectText.within(contentSelector, textToSelect));

    const popoverBtn = user.page.locator("threads-popover").getByText("Add comment");
    await expect(popoverBtn).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("creating general (unanchored) threads", () => {
  test("clicking New Thread opens inline editor", async () => {
    await user.perform(NavigateTo.path("/"));

    const newThreadBtn = user.page.locator(".threads-new-thread-btn").first();
    await newThreadBtn.click();

    const editor = user.page.locator("threads-inline-editor");
    await expect(editor).toBeAttached({ timeout: 5_000 });
  });

  test("submitting New Thread creates unanchored thread", async () => {
    await user.perform(NavigateTo.path("/"));

    await user.perform(AddNewThread.withBody("A general observation"));

    // After submission, the page should reload and show the new thread
    await waitForReload(user.page);

    // Verify the drafted thread is in the caller's view (the client drafts under its stored key)
    const authorKey = await clientKey(user.page);
    const threads = await user.page.evaluate(async (authorKey) => {
      const file = document.body.dataset["sourceFile"];
      return docmd.call("threads:get-threads", { file, author: "TestUser", authorKey });
    }, authorKey);

    const generalThread = threads.find(
      (t: any) => t.comments[0]?.body === "A general observation",
    );
    expect(generalThread).toBeTruthy();

    // Unanchored threads have no ==highlight== markup on the page
    const highlightForThread = await user.page.locator(
      `mark.threads-highlight[data-thread-id="${generalThread.id}"]`,
    ).count();
    expect(highlightForThread).toBe(0);
  });

  test("general thread has no highlight on page", async () => {
    await user.perform(NavigateTo.path("/"));

    const highlightsBefore = await user.ask(TheHighlightCount.count());

    await user.perform(AddNewThread.withBody("No highlight expected"));
    await waitForReload(user.page);

    // No new highlights should have appeared
    const highlightsAfter = await user.ask(TheHighlightCount.count());
    expect(highlightsAfter).toBe(highlightsBefore);
  });
});

test.describe("popover behavior", () => {
  test("mousedown outside popover dismisses it", async () => {
    await user.perform(NavigateTo.path("/"));
    await user.page.waitForSelector(contentSelector, { timeout: 5_000 });

    const firstParagraph = user.page.locator(contentSelector).first();
    const paragraphText = await firstParagraph.textContent();
    if (!paragraphText || paragraphText.trim().length < 5) {
      test.skip(true, "No suitable text content");
      return;
    }

    const textToSelect = paragraphText.trim().slice(0, 15);
    await user.perform(SelectText.within(contentSelector, textToSelect));

    await expect(
      user.page.locator("threads-popover").getByText("Add comment"),
    ).toBeVisible({ timeout: 5_000 });

    // Click outside
    await user.page.locator("h1, body").first().click();

    await expect(
      user.page.locator("threads-popover").getByText("Add comment"),
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("collapsing text selection hides popover", async () => {
    await user.perform(NavigateTo.path("/"));
    await user.page.waitForSelector(contentSelector, { timeout: 5_000 });

    const firstParagraph = user.page.locator(contentSelector).first();
    const paragraphText = await firstParagraph.textContent();
    if (!paragraphText || paragraphText.trim().length < 5) {
      test.skip(true, "No suitable text content");
      return;
    }

    const textToSelect = paragraphText.trim().slice(0, 15);
    await user.perform(SelectText.within(contentSelector, textToSelect));

    await expect(
      user.page.locator("threads-popover").getByText("Add comment"),
    ).toBeVisible({ timeout: 5_000 });

    // Click to collapse selection
    await user.page.mouse.click(10, 10);

    await expect(
      user.page.locator("threads-popover").getByText("Add comment"),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
