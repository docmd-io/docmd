/**
 * Basic UI tests - adapted from old devtalk.e2e.spec.ts "basic UI" describe block.
 *
 * Changes from old plugin:
 * - threads-app replaces devtalk-app as root element
 * - "New Thread" button replaces sidebar toggle
 * - Threads rendered server-side with .threads-* classes
 */

import { test, expect } from "@playwright/test";
import { Actor, NavigateTo } from "./screenplay.ts";
import { setAuthor, waitForClientProcessing } from "./helpers.ts";



let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  // NOTE: Do NOT clean threads here - these tests verify the pre-existing
  // threads from the playground markdown (index.md ::: threads block)
  // Wait for client-side JS to finish processing highlights
  await waitForClientProcessing(page);
});

test.describe("threads plugin - basic UI", () => {
  test("loads on the page with threads-app element", async () => {
    await user.perform(NavigateTo.path("/"));
    const app = user.page.locator("threads-app");
    await expect(app).toBeAttached();
  });

  test("New Thread button is injected into the content area", async () => {
    await user.perform(NavigateTo.path("/"));
    const btn = user.page.locator(".threads-new-thread-btn").first();
    await expect(btn).toBeVisible({ timeout: 5_000 });
    await expect(btn).toContainText("New Thread");
  });

  test("server-rendered threads appear with correct class structure", async () => {
    // The playground index.md has pre-existing threads in the ::: threads block
    await user.perform(NavigateTo.path("/"));

    // There should be thread cards rendered from the markdown
    const threads = user.page.locator(".threads-thread[data-thread-id]");
    const count = await threads.count();
    expect(count).toBeGreaterThan(0);

    // Each thread should have at least one comment
    const firstThread = threads.first();
    const comments = firstThread.locator(".threads-comment");
    await expect(comments.first()).toBeAttached();
  });

  test("highlights appear on marked text", async () => {
    await user.perform(NavigateTo.path("/"));

    // The playground has ==highlighted text=={thread-id} in the markdown
    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const count = await highlights.count();
    expect(count).toBeGreaterThan(0);
  });

  test("highlights have cycling colors (not all the same)", async () => {
    await user.perform(NavigateTo.path("/"));
    await waitForClientProcessing(user.page);

    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const count = await highlights.count();

    if (count < 2) {
      test.skip(true, "Need at least 2 highlights to test color cycling");
      return;
    }

    // Collect all highlight color classes
    const colorClasses: string[] = [];
    for (let i = 0; i < count; i++) {
      const classList = await highlights.nth(i).evaluate((el) =>
        Array.from(el.classList).filter((c) => c.startsWith("threads-hl-")),
      );
      colorClasses.push(...classList);
    }

    // With 2+ highlights, we should see at least 2 different colors
    const uniqueColors = new Set(colorClasses);
    expect(uniqueColors.size).toBeGreaterThanOrEqual(2);
  });

  test("thread cards are placed inline after their highlighted block", async () => {
    await user.perform(NavigateTo.path("/"));
    await waitForClientProcessing(user.page);

    // Find a highlight mark that has a corresponding thread card
    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const firstHighlight = highlights.first();

    if ((await firstHighlight.count()) === 0) {
      test.skip(true, "No highlights found on the page");
      return;
    }

    const threadId = await firstHighlight.getAttribute("data-thread-id");
    if (!threadId) return;

    const threadCard = user.page.locator(`.threads-thread[data-thread-id="${threadId}"]`);
    await expect(threadCard).toBeAttached();

    // Thread card should appear after the highlight's parent block in document order
    const isAfterHighlight = await user.page.evaluate(
      ({ threadId }) => {
        const mark = document.querySelector(`mark.threads-highlight[data-thread-id="${threadId}"]`);
        const thread = document.querySelector(`.threads-thread[data-thread-id="${threadId}"]`);
        if (!mark || !thread) return false;
        return mark.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING;
      },
      { threadId },
    );
    expect(isAfterHighlight).toBeTruthy();
  });

  test("thread cards have matching border colors to their highlights", async () => {
    await user.perform(NavigateTo.path("/"));
    await waitForClientProcessing(user.page);

    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const firstHighlight = highlights.first();

    if ((await firstHighlight.count()) === 0) {
      test.skip(true, "No highlights found");
      return;
    }

    const threadId = await firstHighlight.getAttribute("data-thread-id");
    if (!threadId) return;

    // Get the highlight's color class
    const hlColorClass = await firstHighlight.evaluate((el) =>
      Array.from(el.classList).find((c) => c.startsWith("threads-hl-")),
    );

    if (!hlColorClass) return;

    // The thread card should have the matching border class
    const expectedBorderClass = hlColorClass.replace("threads-hl-", "threads-border-");
    const threadCard = user.page.locator(`.threads-thread[data-thread-id="${threadId}"]`);
    const hasBorderClass = await threadCard.evaluate(
      (el, cls) => el.classList.contains(cls),
      expectedBorderClass,
    );
    expect(hasBorderClass).toBe(true);
  });

  test("clicking a highlight scrolls to and flashes its thread", async () => {
    await user.perform(NavigateTo.path("/"));
    await waitForClientProcessing(user.page);

    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const firstHighlight = highlights.first();

    if ((await firstHighlight.count()) === 0) {
      test.skip(true, "No highlights found");
      return;
    }

    await firstHighlight.click();

    // After clicking, the thread card should receive the flash class
    const threadId = await firstHighlight.getAttribute("data-thread-id");
    const threadCard = user.page.locator(`.tc-panel__body .threads-thread[data-thread-id="${threadId}"]`);
    await expect(threadCard).toHaveClass(/threads-thread--flash/, { timeout: 2_000 });
  });

  test("popover hidden initially without text selection", async () => {
    await user.perform(NavigateTo.path("/"));

    // Without any text selection, the popover should not show
    await expect(
      user.page.locator("threads-popover").getByText("Add comment"),
    ).not.toBeVisible();
  });

  test("reply buttons present on thread cards", async () => {
    await user.perform(NavigateTo.path("/"));

    const threads = user.page.locator(".threads-thread[data-thread-id]");
    const count = await threads.count();

    if (count === 0) {
      test.skip(true, "No threads on page");
      return;
    }

    // Each thread should have a Reply button
    for (let i = 0; i < count; i++) {
      const thread = threads.nth(i);
      const replyBtn = thread.locator(".threads-comment-reply-btn").first();
      await expect(replyBtn).toBeAttached();
      await expect(replyBtn).toContainText("Reply");
    }
  });

  test("threads-sidebar container is hidden", async () => {
    await user.perform(NavigateTo.path("/"));

    const sidebar = user.page.locator(".threads-sidebar");
    if ((await sidebar.count()) > 0) {
      // The sidebar wrapper should be hidden (display: none)
      await expect(sidebar).toBeHidden();
    }
  });
});
