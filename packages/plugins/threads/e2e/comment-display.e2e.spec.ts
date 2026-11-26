/**
 * Comment display tests - adapted from old comment-display.e2e.spec.ts.
 *
 * Comments are `threads-comment` elements (shadow DOM) inside the thread's card. The seeded threads carry an
 * anchor, so each has a card in the article. A comment's parts: `meta` (author, date, "edited"), `body`.
 * Published comments show the build's rendered HTML (markdown-it); the date reads in the page language and keeps the stored `YYYY-MM-DD` as its title.
 */

import { test, expect } from "@playwright/test";
import { Actor } from "./screenplay.ts";
import { cleanThreads, inlineCard, openPanel, panelCard, setAuthor, seedAndReload, waitForReload } from "./helpers.ts";

const ANCHOR = { quote: "verify core engine" };

let user: Actor;

test.beforeEach(async ({ page }) => {
  user = new Actor("TestUser", page);
  await page.goto("/");
  await page.waitForSelector("threads-app", { state: "attached", timeout: 10_000 });
  await setAuthor(page, "TestUser");
  await cleanThreads(page);
  await waitForReload(page);
});

test.describe("comment display", () => {
  test("author name is displayed on the comment", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "Alice",
      body: "Hello from Alice",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    await expect(thread).toBeVisible({ timeout: 5_000 });

    // Server-rendered comment should show the author
    const meta = thread.locator('[part~="meta"]').first();
    await expect(meta).toContainText("Alice");
  });

  test("comment body is displayed", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "TestUser",
      body: "This is the comment body text",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    await expect(thread).toBeVisible({ timeout: 5_000 });

    const body = thread.locator('[part~="body"]').first();
    await expect(body).toContainText("This is the comment body text");
  });

  test("the date reads in the page language and its title holds the stored date", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "TestUser",
      body: "Date display test",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    await expect(thread).toBeVisible({ timeout: 5_000 });

    const date = thread.locator('[part~="date"]').first();
    // The text is a readable date ("Mar 9, 2026"), not the stored YYYY-MM-DD, which is the tooltip
    await expect(date).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    await expect(date).toHaveAttribute("title", /^\d{4}-\d{2}-\d{2}$/);
    await expect(date).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
  });

  test("a comment in the panel has its name on one line and its date below", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "TestUser",
      body: "Meta layout test",
      anchor: ANCHOR,
    });
    await openPanel(user.page);
    const card = panelCard(user.page, threadId);
    await expect(card).toBeVisible({ timeout: 10_000 });
    const author = card.locator('[part~="author"]').first().boundingBox();
    const date = card.locator('[part~="date"]').first().boundingBox();
    const [a, d] = [await author, await date];
    expect(a && d && d.y >= a.y + a.height - 1, "the date sits below the name").toBe(true);
  });

  test("the author is a named part of the comment", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "Bob",
      body: "Attribute test",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    await expect(thread.locator('[part~="author"]').first()).toHaveText("Bob");
  });

  test("multiple comments displayed in order", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      author: "Alice",
      body: "First comment",
      replies: [
        { author: "Bob", body: "Second comment" },
        { author: "Charlie", body: "Third comment" },
      ],
      anchor: ANCHOR,
    });

    let thread = inlineCard(user.page, threadId);
    await expect(thread).toBeVisible({ timeout: 5_000 });

    // The dev server may need an additional reload to pick up the last reply
    let comments = thread.locator("threads-comment");
    if ((await comments.count()) < 3) {
      await waitForReload(user.page);
      thread = inlineCard(user.page, threadId);
      comments = thread.locator("threads-comment");
    }
    await expect(comments).toHaveCount(3);

    // The first comment is the root; the replies are rendered flat under it, in date order.
    await expect(comments.nth(0).locator('[part~="body"]').first()).toContainText("First comment");
    await expect(comments.nth(1).locator('[part~="body"]').first()).toContainText("Second comment");
    await expect(comments.nth(2).locator('[part~="body"]').first()).toContainText("Third comment");
  });
});

test.describe("markdown rendering in comments", () => {
  test("comment body renders inline markdown from markdown-it", async () => {
    // Server-rendered comments go through markdown-it, which handles bold/italic/code
    const { id: threadId } = await seedAndReload(user.page, {
      body: "Use `console.log()` for debugging",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    const body = thread.locator('[part~="body"]').first();
    await expect(body).toBeAttached({ timeout: 5_000 });

    // markdown-it should render backtick as <code>
    const codeEl = body.locator("code");
    await expect(codeEl).toHaveText("console.log()");
  });

  test("HTML special characters are escaped", async () => {
    const { id: threadId } = await seedAndReload(user.page, {
      body: "<script>alert('xss')</script>",
      anchor: ANCHOR,
    });

    const thread = inlineCard(user.page, threadId);
    const body = thread.locator('[part~="body"]').first();
    await expect(body).toBeAttached({ timeout: 5_000 });

    // No live <script> element must exist inside the comment body, and the text is shown as text (the renderer curls the quotes)
    await expect(body.locator("script")).toHaveCount(0);
    await expect(body).toContainText(/<script>alert\(.xss.\)<\/script>/);
  });
});
