/**
 * Basic UI tests - adapted from old devtalk.e2e.spec.ts "basic UI" describe block.
 *
 * Changes from old plugin:
 * - threads-app replaces devtalk-app as root element
 * - "New Thread" button replaces sidebar toggle
 * - Threads are `threads-thread` components (shadow DOM) placed after their highlighted block
 */

import { test, expect } from "@playwright/test";
import { Actor, NavigateTo, inlineCards, newThreadButton } from "./screenplay.ts";
import { openPanel, panelCard, setAuthor, waitForClientProcessing, waitForHydration } from "./helpers.ts";



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
    const btn = newThreadButton(user.page);
    await expect(btn).toBeVisible({ timeout: 5_000 });
    await expect(user.page.locator(".threads-new-thread-btn").first()).toHaveText("New Thread");
  });

  test("the focus-mode title is a copy of the page title and gets no New Thread button", async () => {
    await user.perform(NavigateTo.path("/"));
    await expect(newThreadButton(user.page)).toBeVisible({ timeout: 5_000 });
    const copies = user.page.locator(".docmd-focus-title");
    expect(await copies.count()).toBeGreaterThan(0);
    await expect(user.page.locator(".docmd-focus-title .threads-new-thread-btn")).toHaveCount(0);
    await expect(user.page.locator(".docmd-focus-title.threads-heading-wrap")).toHaveCount(0);
  });

  test("threads from the markdown appear as cards with their comments", async () => {
    // The playground index.md has pre-existing threads in the ::: threads block
    await user.perform(NavigateTo.path("/"));

    // The three threads of the block each have a highlight, so each has a card in the article
    const threads = inlineCards(user.page);
    await expect(threads).toHaveCount(3);

    // Each thread should have at least one comment
    for (let i = 0; i < 3; i++) {
      await expect(threads.nth(i).locator("threads-comment").first()).toBeVisible();
    }
    // The build's own markup stays in the page for no-JS readers, hidden once the cards are there
    await waitForHydration(user.page);
    await expect(user.page.locator(".threads-sidebar .threads-thread").first()).toBeHidden();
  });

  test("highlights appear on marked text", async () => {
    await user.perform(NavigateTo.path("/"));

    // The playground has ==highlighted text=={thread-id} in the markdown
    const highlights = user.page.locator("mark.threads-highlight[data-thread-id]");
    const count = await highlights.count();
    expect(count).toBeGreaterThan(0);
  });

  test("highlights are coloured by status: published blue, resolved green", async () => {
    await user.perform(NavigateTo.path("/"));
    await waitForClientProcessing(user.page);

    const colourOf = (id: string) =>
      user.page
        .locator(`mark.threads-highlight[data-thread-id="${id}"]`)
        .first()
        .evaluate((el) => Array.from(el.classList).filter((c) => c.startsWith("threads-hl-")));
    expect(await colourOf("t-thread1")).toEqual(["threads-hl-blue"]);
    expect(await colourOf("t-thread3")).toEqual(["threads-hl-green"]);
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

    const threadCard = user.page.locator(`threads-thread[variant="inline"][data-thread-id="${threadId}"]`);
    await expect(threadCard).toBeVisible();

    // Thread card should appear after the highlight's parent block in document order. Both are light-DOM
    // elements of the article (the card's insides are in its shadow root), so document queries see them.
    const isAfterHighlight = await user.page.evaluate(
      ({ threadId }) => {
        const mark = document.querySelector(`mark.threads-highlight[data-thread-id="${threadId}"]`);
        const thread = document.querySelector(`threads-thread[variant="inline"][data-thread-id="${threadId}"]`);
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

    // The thread card carries the same colour name, inline and in the panel
    const color = hlColorClass.replace("threads-hl-", "");
    await expect(user.page.locator(`threads-thread[variant="inline"][data-thread-id="${threadId}"]`)).toHaveAttribute("color", color);
    await expect(panelCard(user.page, threadId)).toHaveAttribute("color", color);
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

    // After clicking, the panel opens and its card for the thread flashes
    const threadId = await firstHighlight.getAttribute("data-thread-id");
    await expect(panelCard(user.page, threadId!)).toHaveAttribute("flash", "", { timeout: 2_000 });
    await expect(user.page.locator("body")).toHaveClass(/tc-panel-open/);
  });

  test("popover hidden initially without text selection", async () => {
    await user.perform(NavigateTo.path("/"));

    // Without any text selection, the popover should not show
    await expect(user.page.getByRole("button", { name: "Add comment", exact: true })).not.toBeVisible();
  });

  test("reply buttons present on thread cards", async () => {
    await user.perform(NavigateTo.path("/"));

    const threads = inlineCards(user.page);
    await expect(threads).toHaveCount(3);

    // Each thread should have a Reply button
    for (let i = 0; i < 3; i++) {
      const replyBtn = threads.nth(i).getByRole("button", { name: "Reply", exact: true }).first();
      await expect(replyBtn).toBeVisible();
    }
  });

  test("the build's threads-sidebar container is hidden once the cards are shown", async () => {
    await user.perform(NavigateTo.path("/"));

    const sidebar = user.page.locator(".threads-sidebar");
    await expect(sidebar).toHaveCount(1);
    await expect(sidebar).toBeHidden();
  });

  test("every thread has a card in the panel, in the colour of its highlight", async () => {
    await user.perform(NavigateTo.path("/"));
    await openPanel(user.page);
    for (const id of ["t-thread1", "t-thread2", "t-thread3"]) {
      await expect(panelCard(user.page, id)).toBeVisible();
    }
    await expect(panelCard(user.page, "t-thread3")).toHaveAttribute("resolved", "");
    await expect(panelCard(user.page, "t-thread1")).not.toHaveAttribute("resolved", "");
  });
});
